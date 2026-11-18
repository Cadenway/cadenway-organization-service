import { eventSchemas as identityEvents } from '@cadenway/contracts/events/identity-service';
import {
  ChangeMemberRoleInternalResponse,
  GetMemberInternalResponse,
  ListMembersInternalResponse,
} from '@cadenway/contracts/validators/internal/organization-service';
import type {
  InvitationBatchResult,
  Member,
  MemberPage,
  OrganizationCreated,
} from '@cadenway/contracts/types/internal/organization-service';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { newId, ServiceStack } from './support/service-stack.js';

// The two-step verification of the accounts (P2c-2) end to end, on real PostgreSQL and NATS:
// `user.two-step-verification-changed.v1` of identity-service sets the flag of the user directory
// by the version of the account, whatever the order of arrival and however often it arrives, and
// the member list and the member reads answer it to the owner and the admins only. The people of
// the mockup: Camille Martin owns Atelier Nord, Inès Robert is an admin, Hugo Dubois a member and
// Nadia Garnier a guest.

/** An account of identity-service, as its events describe it. */
interface Account {
  readonly id: string;
  readonly name: string;
  readonly email: string;
}

const camille: Account = {
  id: '019a5f3c-8d2e-7c4a-9b1f-3e5d7a9c1b30',
  name: 'Camille Martin',
  email: 'camille.martin@ateliernord.fr',
};
const ines: Account = { id: newId(), name: 'Inès Robert', email: 'ines.robert@ateliernord.fr' };
const hugo: Account = { id: newId(), name: 'Hugo Dubois', email: 'hugo.dubois@ateliernord.fr' };
const nadia: Account = { id: newId(), name: 'Nadia Garnier', email: 'nadia@cabinet-garnier.fr' };

/** The name of the handler of the event, as cadenway-ops grants its consumer. */
const HANDLER = 'project-user-two-step';

/** The IP address the browser of the change had, in the example of the contract. */
const IP_ADDRESS = '192.0.2.14';

/** The payload envelope every event of identity-service carries. */
function envelope(account: Account, version: number): Record<string, unknown> {
  return {
    id: newId(),
    occurredAt: new Date().toISOString(),
    organizationId: null,
    actor: { type: 'user', id: account.id },
    version,
    userId: account.id,
  };
}

/** `user.signed-up.v1` of an account, validated against the contract. */
function signedUp(account: Account) {
  return identityEvents['user.signed-up.v1'].parse({
    ...envelope(account, 1),
    email: account.email,
    name: account.name,
    language: 'fr',
  });
}

/** `user.email-verified.v1` of an account, validated against the contract. */
function emailVerified(account: Account) {
  return identityEvents['user.email-verified.v1'].parse({
    ...envelope(account, 2),
    email: account.email,
  });
}

/**
 * `user.two-step-verification-changed.v1` of an account, validated against the contract, with the
 * device, the IP address and the recipient the email of notification-service needs.
 *
 * @param account - The account.
 * @param version - Version of the account after the change.
 * @param change - What changed.
 * @param enabled - Whether two-step verification is on after the change.
 * @returns The payload.
 */
function twoStepChanged(account: Account, version: number, change: string, enabled: boolean) {
  return identityEvents['user.two-step-verification-changed.v1'].parse({
    ...envelope(account, version),
    change,
    enabled,
    methods: enabled ? ['authenticator-app'] : [],
    backupCodesRemaining: enabled ? 10 : 0,
    securityKey: null,
    client: {
      device: {
        type: 'desktop',
        browser: 'Firefox',
        browserVersion: '132',
        os: 'Windows',
        osVersion: null,
      },
      ipAddress: IP_ADDRESS,
    },
    recipient: { email: account.email, name: account.name },
    language: 'fr',
    timeZone: 'Europe/Paris',
  });
}

/**
 * Checks a body against the validator of the contract: parsing it must keep it whole.
 *
 * @param schema - The generated validator of the response.
 * @param response - The response.
 */
function conforms(schema: { parse(value: unknown): unknown }, response: Response): void {
  expect(schema.parse(response.body)).toEqual(response.body);
}

/** The two-step part of a row of the user directory. */
interface TwoStepRow {
  readonly two_step_verification_enabled: boolean;
  readonly two_step_verification_version: number;
}

describe('two-step verification of the accounts', () => {
  let stack: ServiceStack;
  let app: NestExpressApplication;

  let atelierNordId = '';
  let camilleEnabled: ReturnType<typeof twoStepChanged>;
  const memberIds = new Map<string, string>();

  /**
   * Sends a request as the gateway would, for a user and the organization of their session.
   *
   * @param method - HTTP method.
   * @param path - Path of the route.
   * @param account - The user.
   * @param organizationId - The organization of the token, or `null`.
   * @param body - JSON body, when there is one.
   * @returns The response.
   */
  async function call(
    method: 'get' | 'post' | 'patch',
    path: string,
    account: Account,
    organizationId: string | null,
    body?: object,
  ): Promise<Response> {
    const pending = request(app.getHttpServer())
      [method](path)
      .set('Authorization', await stack.bearer(account.id, organizationId));
    return body === undefined ? pending : pending.send(body);
  }

  /**
   * Reads the two-step part of the directory entry of an account.
   *
   * @param account - The account.
   * @returns The row, or `undefined`.
   */
  async function twoStepOf(account: Account): Promise<TwoStepRow | undefined> {
    const result = await stack.migrator.query<TwoStepRow>(
      `select two_step_verification_enabled, two_step_verification_version
         from directory_users where user_id = $1`,
      [account.id],
    );
    return result.rows[0];
  }

  /**
   * Counts the deliveries the deduplicator recorded for an event of the consumer.
   *
   * @param eventId - The id of the event.
   * @returns The count, 1 once applied.
   */
  async function processed(eventId: string): Promise<number> {
    const result = await stack.migrator.query<{ count: number }>(
      `select count(*)::int as count from processed_events where consumer = $1 and event_id = $2`,
      [`organization-service__${HANDLER}`, eventId],
    );
    return result.rows[0]?.count ?? 0;
  }

  /**
   * Waits until the consumer has handled everything the stream holds for it.
   *
   * @param delivered - The deliveries it must have reached at least.
   */
  async function drained(delivered: number): Promise<void> {
    await vi.waitFor(
      () => {
        const state = stack.consumer(`organization-service__${HANDLER}`);
        expect(state.num_pending).toBe(0);
        expect(state.num_ack_pending).toBe(0);
        expect(state.delivered.consumer_seq).toBeGreaterThanOrEqual(delivered);
      },
      { timeout: 20_000, interval: 500 },
    );
  }

  /** The deliveries of the consumer so far. */
  function deliveries(): number {
    return stack.consumer(`organization-service__${HANDLER}`).delivered.consumer_seq;
  }

  /**
   * Invites an address and lets its account accept, as the gateway would.
   *
   * @param invitee - The account invited.
   * @param role - The role of the invitation.
   */
  async function join(invitee: Account, role: 'admin' | 'member' | 'guest'): Promise<void> {
    const invited = await call('post', '/internal/v1/invitations', camille, atelierNordId, {
      emails: [invitee.email],
      role,
    });
    expect(invited.status).toBe(200);
    const invitationId: string =
      (invited.body as InvitationBatchResult).invitations[0]?.invitationId ?? '';
    const accepted = await call(
      'post',
      `/internal/v1/users/${invitee.id}/invitations/${invitationId}/accept`,
      invitee,
      null,
      {},
    );
    expect(accepted.status).toBe(200);
  }

  /**
   * Lists the members of Atelier Nord as an account.
   *
   * @param account - The reader.
   * @returns The response.
   */
  async function listAs(account: Account): Promise<Response> {
    return call('get', '/internal/v1/members', account, atelierNordId);
  }

  /**
   * The flags of the member list by account, `undefined` where the answer leaves it out.
   *
   * @param response - A member list.
   * @returns The flag of each account.
   */
  function flagsOf(response: Response): Record<string, boolean | undefined> {
    return Object.fromEntries(
      (response.body as MemberPage).items.map((member: Member) => [
        member.userId,
        member.twoStepVerificationEnabled,
      ]),
    );
  }

  beforeAll(async () => {
    stack = await ServiceStack.start('two-step');
    for (const account of [camille, ines, hugo, nadia]) {
      stack.publish('user.signed-up.v1', signedUp(account));
      stack.publish('user.email-verified.v1', emailVerified(account));
    }
    // Published before the service starts: its new consumer reads what the stream holds.
    camilleEnabled = twoStepChanged(camille, 3, 'enabled', true);
    stack.publish('user.two-step-verification-changed.v1', camilleEnabled);
    app = await stack.startApplication();
    await vi.waitFor(
      async () => {
        for (const account of [camille, ines, hugo, nadia]) {
          const verified = await stack.migrator.query<{ email_verified: boolean }>(
            'select email_verified from directory_users where user_id = $1',
            [account.id],
          );
          expect(verified.rows[0]?.email_verified).toBe(true);
        }
        expect(await twoStepOf(camille)).toEqual({
          two_step_verification_enabled: true,
          two_step_verification_version: 3,
        });
      },
      { timeout: 30_000, interval: 250 },
    );

    const created = await call('post', '/internal/v1/organizations', camille, null, {
      name: 'Atelier Nord',
      teamSize: '6-20',
      primaryUse: 'product-engineering',
      inviteEmails: [],
    });
    expect(created.status).toBe(201);
    atelierNordId = (created.body as OrganizationCreated).organization.id;
    await join(ines, 'admin');
    await join(hugo, 'member');
    await join(nadia, 'guest');
    const listed = await listAs(camille);
    for (const member of (listed.body as MemberPage).items) {
      memberIds.set(member.userId, member.id);
    }
  });

  afterAll(async () => {
    await stack.stop();
  });

  describe('the projection', () => {
    it('keeps the flag of the newest version of the account, whatever the order of arrival', async () => {
      const before: number = deliveries();

      // Hugo Dubois turns it on (5), off (7), and the event of a key added (6) arrives last.
      stack.publish(
        'user.two-step-verification-changed.v1',
        twoStepChanged(hugo, 5, 'enabled', true),
      );
      stack.publish(
        'user.two-step-verification-changed.v1',
        twoStepChanged(hugo, 7, 'disabled', false),
      );
      stack.publish(
        'user.two-step-verification-changed.v1',
        twoStepChanged(hugo, 6, 'security-key-added', true),
      );
      await drained(before + 3);

      expect(await twoStepOf(hugo)).toEqual({
        two_step_verification_enabled: false,
        two_step_verification_version: 7,
      });
      expect(flagsOf(await listAs(camille))[hugo.id]).toBe(false);

      // A change this service does not know still applies its `enabled`.
      stack.publish(
        'user.two-step-verification-changed.v1',
        twoStepChanged(hugo, 8, 'administrator-reset', true),
      );
      await drained(before + 4);

      expect(await twoStepOf(hugo)).toEqual({
        two_step_verification_enabled: true,
        two_step_verification_version: 8,
      });
      expect(flagsOf(await listAs(camille))[hugo.id]).toBe(true);
    });

    it('changes nothing on a redelivery or a re-emission of an applied version', async () => {
      const before: number = deliveries();
      const disabled = twoStepChanged(ines, 4, 'disabled', false);
      stack.publish(
        'user.two-step-verification-changed.v1',
        twoStepChanged(ines, 3, 'enabled', true),
      );
      stack.publish('user.two-step-verification-changed.v1', disabled);
      await drained(before + 2);

      // The same event stored again, as a requeue past the duplicate window of the stream would,
      // then the earlier version emitted again under another id.
      stack.publish('user.two-step-verification-changed.v1', disabled, newId());
      stack.publish(
        'user.two-step-verification-changed.v1',
        twoStepChanged(ines, 3, 'enabled', true),
      );
      await drained(before + 4);

      expect(await processed(disabled.id)).toBe(1);
      expect(await processed(camilleEnabled.id)).toBe(1);
      expect(await twoStepOf(ines)).toEqual({
        two_step_verification_enabled: false,
        two_step_verification_version: 4,
      });
      expect(flagsOf(await listAs(camille))[ines.id]).toBe(false);
    });

    it('keeps trying a failing event on the schedule of the directory', () => {
      expect(stack.consumer(`organization-service__${HANDLER}`).config).toMatchObject({
        max_deliver: 32,
        ack_wait: 30_000_000_000,
      });
    });

    it('keeps only the flag: neither the device nor the IP address nor the recipient', async () => {
      const stored = await stack.migrator.query<{ row: string }>(
        `select row_to_json(entry)::text as row from directory_users entry where user_id = $1`,
        [camille.id],
      );
      const row: string = stored.rows[0]?.row ?? '';

      expect(row).toContain('"two_step_verification_enabled":true');
      for (const carried of [
        IP_ADDRESS,
        'Firefox',
        'Windows',
        'Europe/Paris',
        'authenticator-app',
      ]) {
        expect(row).not.toContain(carried);
      }
      const columns = await stack.migrator.query<{ column_name: string }>(
        `select column_name from information_schema.columns
          where table_name = 'directory_users' and column_name like 'two_step%'
          order by column_name`,
      );
      expect(columns.rows.map((column) => column.column_name)).toEqual([
        'two_step_verification_enabled',
        'two_step_verification_version',
      ]);
    });
  });

  describe('the member list and the member reads', () => {
    it('tell the owner and the admins which members have two-step verification', async () => {
      for (const reader of [camille, ines]) {
        const listed = await listAs(reader);

        expect(listed.status).toBe(200);
        conforms(ListMembersInternalResponse, listed);
        expect(flagsOf(listed)).toEqual({
          [camille.id]: true,
          [ines.id]: false,
          [hugo.id]: true,
          [nadia.id]: false,
        });
      }

      const read = await call(
        'get',
        `/internal/v1/members/${memberIds.get(camille.id) ?? ''}`,
        ines,
        atelierNordId,
      );
      expect(read.status).toBe(200);
      conforms(GetMemberInternalResponse, read);
      expect(read.body).toMatchObject({ userId: camille.id, twoStepVerificationEnabled: true });

      // The answer of a change of role, which only the owner and the admins make, carries it too.
      const changed = await call(
        'patch',
        `/internal/v1/members/${memberIds.get(hugo.id) ?? ''}`,
        ines,
        atelierNordId,
        { role: 'member' },
      );
      expect(changed.status).toBe(200);
      conforms(ChangeMemberRoleInternalResponse, changed);
      expect(changed.body).toMatchObject({ userId: hugo.id, twoStepVerificationEnabled: true });
    });

    it('leave it out for a member, and a guest reads no member at all', async () => {
      const listed = await listAs(hugo);
      expect(listed.status).toBe(200);
      conforms(ListMembersInternalResponse, listed);
      const items: Member[] = (listed.body as MemberPage).items;
      expect(items).toHaveLength(4);
      for (const member of items) {
        expect(member).not.toHaveProperty('twoStepVerificationEnabled');
      }

      const read = await call(
        'get',
        `/internal/v1/members/${memberIds.get(camille.id) ?? ''}`,
        hugo,
        atelierNordId,
      );
      expect(read.status).toBe(200);
      conforms(GetMemberInternalResponse, read);
      expect(read.body).not.toHaveProperty('twoStepVerificationEnabled');

      const guestList = await listAs(nadia);
      expect(guestList.status).toBe(403);
      expect(guestList.body).toMatchObject({ code: 'organization.role-forbidden' });
      expect(guestList.body).not.toHaveProperty('items');
      const guestRead = await call(
        'get',
        `/internal/v1/members/${memberIds.get(camille.id) ?? ''}`,
        nadia,
        atelierNordId,
      );
      expect(guestRead.status).toBe(403);
      expect(guestRead.body).toMatchObject({ code: 'organization.role-forbidden' });
      expect(JSON.stringify(guestRead.body)).not.toContain('twoStepVerificationEnabled');
    });
  });
});
