import { eventSchemas as identityEvents } from '@cadenway/contracts/events/identity-service';
import { eventSchemas as organizationEvents } from '@cadenway/contracts/events/organization-service';
import {
  ListInvitationsInternalResponse,
  ListMembersInternalResponse,
  ListReceivedInvitationsInternalResponse,
  ResendInvitationInternalResponse,
} from '@cadenway/contracts/validators/internal/organization-service';
import type {
  Invitation,
  InvitationBatchResult,
  InvitationPage,
  MemberPage,
  OrganizationCreated,
  ReceivedInvitationPage,
} from '@cadenway/contracts/types/internal/organization-service';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { newId, ServiceStack } from './support/service-stack.js';

// The account changes of identity-service (P2c) end to end, on real PostgreSQL and NATS: a change
// of address reaches the member list, and a deleted account loses its memberships, each with its
// `member.removed.v1` from the system, while the invitations it sent stay pending, from « Ancien
// membre ». The people of the mockup: Camille Martin owns Atelier Nord, Inès Robert owns
// Coopérative Lumen, Hugo Dubois is an admin of Atelier Nord and a member of Coopérative Lumen,
// Léa Petit a member of Atelier Nord, Marc Roux is invited by Hugo and Nadia Garnier by Camille.

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
const ines: Account = { id: newId(), name: 'Inès Robert', email: 'ines.robert@lumen.coop' };
const hugo: Account = { id: newId(), name: 'Hugo Dubois', email: 'hugo.dubois@ateliernord.fr' };
const lea: Account = { id: newId(), name: 'Léa Petit', email: 'lea.petit@ateliernord.fr' };
const marc: Account = { id: newId(), name: 'Marc Roux', email: 'marc.roux@ateliernord.fr' };
const nadia: Account = { id: newId(), name: 'Nadia Garnier', email: 'nadia@cabinet-garnier.fr' };

/** The address Léa Petit moves to. */
const LEA_NEW_EMAIL = 'lea@ateliernord.fr';

/** The actor of the events organization-service emits for a deleted account. */
const SYSTEM = { type: 'system', id: 'organization-service' };

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
function emailVerified(account: Account, version: number, email: string = account.email) {
  return identityEvents['user.email-verified.v1'].parse({ ...envelope(account, version), email });
}

/** `user.profile-updated.v1` of an account, validated against the contract. */
function profileUpdated(account: Account, version: number) {
  return identityEvents['user.profile-updated.v1'].parse({
    ...envelope(account, version),
    name: account.name,
    displayName: null,
    jobTitle: null,
    timeZone: 'Europe/Paris',
    language: 'fr',
    changed: ['name'],
  });
}

/** `user.email-changed.v1` of an account, validated against the contract. */
function emailChanged(account: Account, version: number, email: string) {
  return identityEvents['user.email-changed.v1'].parse({
    ...envelope(account, version),
    email,
    previousEmail: account.email,
    name: account.name,
    client: {
      device: {
        type: 'desktop',
        browser: 'Firefox',
        browserVersion: '132',
        os: 'Windows',
        osVersion: null,
      },
      ipAddress: '192.0.2.14',
    },
    language: 'fr',
    timeZone: 'Europe/Paris',
  });
}

/** `user.deleted.v1` of an account, validated against the contract: ids only, actor system. */
function deleted(account: Account, version: number) {
  return identityEvents['user.deleted.v1'].parse({
    ...envelope(account, version),
    actor: { type: 'system', id: 'identity-service' },
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

/** A row of the user directory. */
interface DirectoryRow {
  readonly name: string | null;
  readonly name_key: string | null;
  readonly email: string | null;
  readonly email_verified: boolean;
  readonly name_version: number;
  readonly email_version: number;
  readonly deleted: boolean;
}

/** An outbox row of `member.removed.v1`. */
interface RemovalRow {
  readonly status: string;
  readonly payload: Record<string, unknown>;
}

describe('account changes of identity-service', () => {
  let stack: ServiceStack;
  let app: NestExpressApplication;

  let atelierNordId = '';
  let lumenId = '';
  let marcInvitationId = '';
  let nadiaInvitationId = '';

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
    method: 'get' | 'post',
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
   * Reads the directory entry of an account.
   *
   * @param account - The account.
   * @returns The row, or `undefined`.
   */
  async function directoryOf(account: Account): Promise<DirectoryRow | undefined> {
    const result = await stack.migrator.query<DirectoryRow>(
      `select name, name_key, email, email_verified, name_version, email_version, deleted
         from directory_users where user_id = $1`,
      [account.id],
    );
    return result.rows[0];
  }

  /**
   * Reads the outbox rows of `member.removed.v1` of an account, by organization.
   *
   * @param account - The account.
   * @returns The rows.
   */
  async function removalsOf(account: Account): Promise<RemovalRow[]> {
    return stack.system<RemovalRow>(
      `select status, payload from outbox_events
        where event_name = 'member.removed.v1' and payload ->> 'userId' = $1
        order by organization_id`,
      [account.id],
    );
  }

  /**
   * Reads the active memberships of an account, in every organization.
   *
   * @param account - The account.
   * @returns The organizations and roles.
   */
  async function activeMembershipsOf(
    account: Account,
  ): Promise<{ readonly organization_id: string; readonly role: string }[]> {
    return stack.system(
      `select organization_id, role from members
        where user_id = $1 and removed_at is null order by organization_id`,
      [account.id],
    );
  }

  /**
   * Counts the deliveries the deduplicator recorded for an event and a consumer.
   *
   * @param handler - The name of the handler.
   * @param eventId - The id of the event.
   * @returns The count, 1 once applied.
   */
  async function processed(handler: string, eventId: string): Promise<number> {
    const result = await stack.migrator.query<{ count: number }>(
      `select count(*)::int as count from processed_events where consumer = $1 and event_id = $2`,
      [`organization-service__${handler}`, eventId],
    );
    return result.rows[0]?.count ?? 0;
  }

  /**
   * Waits until a consumer has handled everything the stream holds for it.
   *
   * @param handler - The name of the handler.
   * @param delivered - The deliveries it must have reached at least.
   */
  async function drained(handler: string, delivered: number): Promise<void> {
    await vi.waitFor(
      () => {
        const state = stack.consumer(`organization-service__${handler}`);
        expect(state.num_pending).toBe(0);
        expect(state.num_ack_pending).toBe(0);
        expect(state.delivered.consumer_seq).toBeGreaterThanOrEqual(delivered);
      },
      { timeout: 20_000, interval: 500 },
    );
  }

  /**
   * Invites an address and lets its account accept, as the gateway would.
   *
   * @param inviter - The owner or the admin who invites.
   * @param organizationId - The organization.
   * @param invitee - The account invited.
   * @param role - The role of the invitation.
   */
  async function join(
    inviter: Account,
    organizationId: string,
    invitee: Account,
    role: 'admin' | 'member',
  ): Promise<void> {
    const invited = await call('post', '/internal/v1/invitations', inviter, organizationId, {
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
   * Creates an organization owned by an account.
   *
   * @param owner - The creator.
   * @param name - The name of the organization.
   * @returns Its id.
   */
  async function create(owner: Account, name: string): Promise<string> {
    const created = await call('post', '/internal/v1/organizations', owner, null, {
      name,
      teamSize: '6-20',
      primaryUse: 'product-engineering',
      inviteEmails: [],
    });
    expect(created.status).toBe(201);
    return (created.body as OrganizationCreated).organization.id;
  }

  beforeAll(async () => {
    stack = await ServiceStack.start('accounts');
    for (const account of [camille, ines, hugo, lea, marc, nadia]) {
      stack.publish('user.signed-up.v1', signedUp(account));
      stack.publish('user.email-verified.v1', emailVerified(account, 2));
    }
    app = await stack.startApplication();
    await vi.waitFor(
      async () => {
        for (const account of [camille, ines, hugo, lea, marc, nadia]) {
          expect(await directoryOf(account)).toMatchObject({ email_verified: true });
        }
      },
      { timeout: 30_000, interval: 250 },
    );

    atelierNordId = await create(camille, 'Atelier Nord');
    lumenId = await create(ines, 'Coopérative Lumen');
    await join(camille, atelierNordId, hugo, 'admin');
    await join(camille, atelierNordId, lea, 'member');
    await join(ines, lumenId, hugo, 'member');
    const invited = await call('post', '/internal/v1/invitations', hugo, atelierNordId, {
      emails: [marc.email],
      role: 'member',
    });
    expect(invited.status).toBe(200);
    marcInvitationId = (invited.body as InvitationBatchResult).invitations[0]?.invitationId ?? '';
    const guest = await call('post', '/internal/v1/invitations', camille, atelierNordId, {
      emails: [nadia.email],
      role: 'guest',
    });
    expect(guest.status).toBe(200);
    nadiaInvitationId = (guest.body as InvitationBatchResult).invitations[0]?.invitationId ?? '';
  });

  afterAll(async () => {
    await stack.stop();
  });

  describe('a change of address', () => {
    it('shows the new address, verified, in the member list', async () => {
      const change = emailChanged(lea, 3, LEA_NEW_EMAIL);
      stack.publish('user.email-changed.v1', change);

      await vi.waitFor(
        async () => {
          expect(await directoryOf(lea)).toMatchObject({
            name: 'Léa Petit',
            email: LEA_NEW_EMAIL,
            email_verified: true,
            email_version: 3,
          });
        },
        { timeout: 15_000, interval: 250 },
      );
      const listed = await call('get', '/internal/v1/members', camille, atelierNordId);
      expect(listed.status).toBe(200);
      conforms(ListMembersInternalResponse, listed);
      expect((listed.body as MemberPage).items).toContainEqual(
        expect.objectContaining({ userId: lea.id, name: 'Léa Petit', email: LEA_NEW_EMAIL }),
      );
      // The verified address now names a member: inviting it sends nothing.
      const invited = await call('post', '/internal/v1/invitations', camille, atelierNordId, {
        emails: [LEA_NEW_EMAIL],
      });
      expect((invited.body as InvitationBatchResult).invitations).toEqual([
        { email: LEA_NEW_EMAIL, outcome: 'already-member', invitationId: null },
      ]);
      expect(await processed('project-user-email-changed', change.id)).toBe(1);
    });

    it('keeps the new address over a redelivery and a late verification of the previous one', async () => {
      const again = emailChanged(lea, 3, LEA_NEW_EMAIL);
      const before = stack.consumer('organization-service__project-user-email-verified');

      stack.publish('user.email-changed.v1', again);
      stack.publish('user.email-verified.v1', emailVerified(lea, 2, lea.email));
      await drained('project-user-email-changed', 2);
      await drained('project-user-email-verified', before.delivered.consumer_seq + 1);

      expect(await directoryOf(lea)).toMatchObject({
        email: LEA_NEW_EMAIL,
        email_verified: true,
        email_version: 3,
      });
      expect(
        stack.consumer('organization-service__project-user-email-changed').config,
      ).toMatchObject({ max_deliver: 32, ack_wait: 30_000_000_000 });
    });
  });

  describe('a deleted account', () => {
    let deletion: ReturnType<typeof deleted>;

    it('loses every membership, each with member.removed.v1 from the system', async () => {
      deletion = deleted(hugo, 4);
      stack.publish('user.deleted.v1', deletion);

      await vi.waitFor(
        async () => {
          expect((await directoryOf(hugo))?.deleted).toBe(true);
        },
        { timeout: 15_000, interval: 250 },
      );
      expect(await activeMembershipsOf(hugo)).toEqual([]);
      const removals: RemovalRow[] = await vi.waitFor(
        async () => {
          const rows: RemovalRow[] = await removalsOf(hugo);
          expect(rows.map((row: RemovalRow) => row.status)).toEqual(['sent', 'sent']);
          return rows;
        },
        { timeout: 15_000, interval: 250 },
      );
      expect(
        removals
          .map((row: RemovalRow) => organizationEvents['member.removed.v1'].parse(row.payload))
          .map(({ organizationId, actor, userId, role, version }) => ({
            organizationId,
            actor,
            userId,
            role,
            version,
          }))
          .sort((left, right) => left.organizationId.localeCompare(right.organizationId)),
      ).toEqual(
        [
          {
            organizationId: atelierNordId,
            actor: SYSTEM,
            userId: hugo.id,
            role: 'admin',
            version: 2,
          },
          { organizationId: lumenId, actor: SYSTEM, userId: hugo.id, role: 'member', version: 2 },
        ].sort((left, right) => left.organizationId.localeCompare(right.organizationId)),
      );
      expect(stack.lastEvent('member.removed.v1')).toMatchObject({
        actor: SYSTEM,
        userId: hugo.id,
      });

      const listed = await call('get', '/internal/v1/members', camille, atelierNordId);
      expect((listed.body as MemberPage).items.map((member) => member.userId)).not.toContain(
        hugo.id,
      );
      expect((listed.body as MemberPage).counts).toMatchObject({ owner: 1, admin: 0, member: 1 });
      const lumen = await call('get', '/internal/v1/members', ines, lumenId);
      expect((lumen.body as MemberPage).total).toBe(1);
      const organization = await call('get', '/internal/v1/organization', hugo, atelierNordId);
      expect(organization.status).toBe(404);
      expect(organization.body).toMatchObject({ code: 'organization.not-found' });
    });

    it('forgets the name and the address of the account and keeps it as a former member', async () => {
      expect(await directoryOf(hugo)).toEqual({
        name: null,
        name_key: null,
        email: null,
        email_verified: false,
        name_version: 4,
        email_version: 4,
        deleted: true,
      });
    });

    it('keeps the invitations the account sent pending, from « Ancien membre »', async () => {
      const pending = await call('get', '/internal/v1/invitations', camille, atelierNordId);
      expect(pending.status).toBe(200);
      conforms(ListInvitationsInternalResponse, pending);
      expect((pending.body as InvitationPage).items).toContainEqual(
        expect.objectContaining({
          id: marcInvitationId,
          status: 'pending',
          invitedBy: { userId: hugo.id, name: 'Ancien membre' },
        }),
      );

      const received = await call('get', `/internal/v1/users/${marc.id}/invitations`, marc, null);
      expect(received.status).toBe(200);
      conforms(ListReceivedInvitationsInternalResponse, received);
      expect((received.body as ReceivedInvitationPage).items).toEqual([
        expect.objectContaining({
          id: marcInvitationId,
          invitedBy: { userId: hugo.id, name: 'Ancien membre' },
        }),
      ]);

      // An owner resends it in their own name; the invitation keeps its first sender.
      await stack.system(
        `update invitations set sent_at = sent_at - interval '2 hours' where id = $1`,
        [marcInvitationId],
      );
      const resent = await call(
        'post',
        `/internal/v1/invitations/${marcInvitationId}/resend`,
        camille,
        atelierNordId,
        {},
      );
      expect(resent.status).toBe(200);
      conforms(ResendInvitationInternalResponse, resent);
      expect(resent.body as Invitation).toMatchObject({
        version: 2,
        invitedBy: { userId: hugo.id, name: 'Ancien membre' },
      });
      const issued = await vi.waitFor(
        () => {
          const event = stack.lastEvent('invitation.issued.v1');
          expect(event).toMatchObject({ invitationId: marcInvitationId, version: 2 });
          return event;
        },
        { timeout: 15_000, interval: 250 },
      );
      expect(issued).toMatchObject({
        actor: { type: 'user', id: camille.id },
        inviter: { userId: camille.id, name: 'Camille Martin' },
      });

      const accepted = await call(
        'post',
        `/internal/v1/users/${marc.id}/invitations/${marcInvitationId}/accept`,
        marc,
        null,
        {},
      );
      expect(accepted.status).toBe(200);
    });

    it('applies the deletion once, however often it arrives, and no later event of the account', async () => {
      const before = stack.consumer('organization-service__remove-deleted-user');
      const profile = stack.consumer('organization-service__project-user-profile-updated');

      // The same event stored again, then the deletion emitted again under another id.
      stack.publish('user.deleted.v1', deletion, newId());
      stack.publish('user.deleted.v1', deleted(hugo, 4));
      stack.publish('user.profile-updated.v1', profileUpdated(hugo, 3));
      await drained('remove-deleted-user', before.delivered.consumer_seq + 2);
      await drained('project-user-profile-updated', profile.delivered.consumer_seq + 1);

      expect(await processed('remove-deleted-user', deletion.id)).toBe(1);
      expect(await removalsOf(hugo)).toHaveLength(2);
      expect(await directoryOf(hugo)).toMatchObject({ name: null, email: null, deleted: true });
      expect(stack.consumer('organization-service__remove-deleted-user').config).toMatchObject({
        max_deliver: 32,
        ack_wait: 30_000_000_000,
      });
    });
  });

  describe('a deletion under way', () => {
    it('makes an acceptance wait for it, then find no verified address to accept with', async () => {
      // A deletion of Nadia's account holds her directory entry, as `RemoveDeletedUser` does.
      const deletion = await stack.migrator.connect();
      try {
        await deletion.query('begin');
        await deletion.query('select 1 from directory_users where user_id = $1 for update', [
          nadia.id,
        ]);
        const acceptance: Promise<Response> = call(
          'post',
          `/internal/v1/users/${nadia.id}/invitations/${nadiaInvitationId}/accept`,
          nadia,
          null,
          {},
        );
        // Under the 5 s `lock_timeout` of the application role.
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 1_500);
        });
        await deletion.query(
          `update directory_users
              set name = null, name_key = null, email = null, email_verified = false,
                  deleted = true
            where user_id = $1`,
          [nadia.id],
        );
        await deletion.query('commit');

        const accepted: Response = await acceptance;
        expect(accepted.status).toBe(404);
        expect(accepted.body).toMatchObject({ code: 'invitation.not-found' });
      } finally {
        deletion.release();
      }
      expect(await activeMembershipsOf(nadia)).toEqual([]);
    });
  });

  describe('a deleted owner, which the contract excludes', () => {
    it('is refused as a whole: the organization keeps its owner and nothing is forgotten', async () => {
      const before = stack.consumer('organization-service__remove-deleted-user');
      const refused = deleted(ines, 5);

      stack.publish('user.deleted.v1', refused);

      // Delivered, refused, and delivered again after the first delay of the schedule (1 s).
      await vi.waitFor(
        () => {
          const state = stack.consumer('organization-service__remove-deleted-user');
          expect(state.delivered.consumer_seq).toBeGreaterThanOrEqual(
            before.delivered.consumer_seq + 2,
          );
        },
        { timeout: 15_000, interval: 250 },
      );
      expect(stack.consumer('organization-service__remove-deleted-user').num_ack_pending).toBe(1);
      expect(await processed('remove-deleted-user', refused.id)).toBe(0);
      expect(await activeMembershipsOf(ines)).toEqual([
        { organization_id: lumenId, role: 'owner' },
      ]);
      expect(await removalsOf(ines)).toEqual([]);
      expect(await directoryOf(ines)).toMatchObject({
        name: 'Inès Robert',
        email: ines.email,
        deleted: false,
      });
    });
  });
});
