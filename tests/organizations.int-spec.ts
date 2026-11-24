import { eventSchemas as identityEvents } from '@cadenway/contracts/events/identity-service';
import { eventSchemas as organizationEvents } from '@cadenway/contracts/events/organization-service';
import {
  AcceptInvitationInternalResponse,
  ChangeMemberRoleInternalResponse,
  CreateOrganizationInternalResponse,
  GetMemberInternalResponse,
  GetOrganizationInternalResponse,
  GetOrganizationLogoUploadStateInternalResponse,
  InviteMembersInternalResponse,
  ListInvitationsInternalResponse,
  ListMembersInternalResponse,
  ListMyOrganizationsInternalResponse,
  ListReceivedInvitationsInternalResponse,
  ResendInvitationInternalResponse,
  ReserveOrganizationLogoUploadInternalResponse,
  UpdateOrganizationInternalResponse,
} from '@cadenway/contracts/validators/internal/organization-service';
import type {
  Invitation,
  InvitationBatchResult,
  InvitationPage,
  Member,
  MemberPage,
  MyOrganization,
  MyOrganizationPage,
  Organization,
  OrganizationCreated,
  ReceivedInvitationPage,
} from '@cadenway/contracts/types/internal/organization-service';
import { runWithOrganizationContext } from '@cadenway/nest-common';
import type { OrganizationContext } from '@cadenway/nest-common';
import { TenantTransactionRunner } from '@cadenway/nest-common/database';
import { OutboxWriter } from '@cadenway/nest-messaging/outbox';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { Response, Test } from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { DeclaredErrors } from './support/declared-errors.js';
import type { SeenError } from './support/declared-errors.js';
import { newId, ServiceStack } from './support/service-stack.js';

// Organizations, members, invitations and the user directory end to end: the internal routes as
// the gateway calls them, on real PostgreSQL and NATS, with the people of the mockup
// (`Organisation.dc.html`): Camille Martin owns Atelier Nord, Inès Robert owns Coopérative Lumen
// and joins Atelier Nord as an admin, Hugo Dubois and Marc Roux are members, Nadia Garnier a guest.

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
const ines: Account = {
  id: '019a5f3c-9e1f-7b2a-8c3d-4e5f6a7b8c31',
  name: 'Inès Robert',
  email: 'ines.robert@ateliernord.fr',
};
const hugo: Account = {
  id: '019a5f3c-a0b1-7c2d-9e3f-5a6b7c8d9e32',
  name: 'Hugo Dubois',
  email: 'hugo.dubois@ateliernord.fr',
};
const nadia: Account = { id: newId(), name: 'Nadia Garnier', email: 'nadia@cabinet-garnier.fr' };
const marc: Account = { id: newId(), name: 'Marc Roux', email: 'marc.roux@ateliernord.fr' };
const lea: Account = { id: newId(), name: 'Léa Petit', email: 'lea.petit@ateliernord.fr' };

/** Seven days, in milliseconds. */
const WEEK = 7 * 24 * 60 * 60_000;

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
function signedUp(account: Account, version: number, name: string = account.name) {
  return identityEvents['user.signed-up.v1'].parse({
    ...envelope(account, version),
    email: account.email,
    name,
    language: 'fr',
  });
}

/** `user.email-verified.v1` of an account, validated against the contract. */
function emailVerified(account: Account, version: number) {
  return identityEvents['user.email-verified.v1'].parse({
    ...envelope(account, version),
    email: account.email,
  });
}

/** `user.profile-updated.v1` of an account, validated against the contract. */
function profileUpdated(account: Account, version: number, name: string) {
  return identityEvents['user.profile-updated.v1'].parse({
    ...envelope(account, version),
    name,
    displayName: null,
    jobTitle: null,
    timeZone: 'Europe/Paris',
    language: 'fr',
    changed: ['name'],
  });
}

/**
 * Checks a body against the validator of the contract: parsing it must keep it whole, so a missing,
 * malformed or undeclared member fails.
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
  readonly email: string | null;
  readonly email_verified: boolean;
  readonly name_version: number;
  readonly email_version: number;
}

describe('organizations, members and invitations', () => {
  let stack: ServiceStack;
  let app: NestExpressApplication;

  let atelierNordId = '';
  let lumenId = '';
  let inesInvitationId = '';
  let hugoInvitationId = '';
  let marcInvitationId = '';
  let nadiaInvitationId = '';
  let strayInvitationId = '';
  let camilleMemberId = '';
  let inesMemberId = '';
  let hugoMemberId = '';

  /** Every client error a route answered, checked against the contract at the end. */
  const errors: SeenError[] = [];

  /**
   * Sends a request as the gateway would, for a user and the organization of their session.
   *
   * @param method - HTTP method.
   * @param path - Path of the route.
   * @param account - The user, or `null` for no token.
   * @param organizationId - The organization of the token, or `null`.
   * @param body - JSON body, when there is one.
   * @param headers - Extra headers.
   * @returns The response.
   */
  async function call(
    method: 'get' | 'query' | 'post' | 'put' | 'patch' | 'delete',
    path: string,
    account: Account | null,
    organizationId: string | null,
    body?: object | string,
    headers: Readonly<Record<string, string>> = {},
  ): Promise<Response> {
    let pending = request(app.getHttpServer())[method](path) as Test;
    if (account !== null) {
      pending = pending.set('Authorization', await stack.bearer(account.id, organizationId));
    }
    for (const [name, value] of Object.entries(headers)) {
      pending = pending.set(name, value);
    }
    const response: Response = await (body === undefined ? pending : pending.send(body));
    const code: unknown = (response.body as { code?: unknown } | undefined)?.code;
    if (response.status >= 400 && response.status < 500 && typeof code === 'string') {
      errors.push({ method, path: path.split('?')[0] ?? path, status: response.status, code });
    }
    return response;
  }

  /**
   * Reads the directory entry of an account.
   *
   * @param account - The account.
   * @returns The row, or `undefined`.
   */
  async function directoryOf(account: Account): Promise<DirectoryRow | undefined> {
    const result = await stack.migrator.query<DirectoryRow>(
      `select name, email, email_verified, name_version, email_version
         from directory_users where user_id = $1`,
      [account.id],
    );
    return result.rows[0];
  }

  /**
   * Waits until the relay published an event matching a predicate, and returns its payload
   * validated against the contract.
   *
   * @param name - Name of the event.
   * @param matches - What the last event of that name must show.
   * @returns The payload.
   */
  async function published(
    name: keyof typeof organizationEvents,
    matches: (payload: Record<string, unknown>) => boolean,
  ): Promise<Record<string, unknown>> {
    const found: Record<string, unknown> = await vi.waitFor(
      () => {
        const event: Record<string, unknown> | null = stack.lastEvent(name);
        if (event === null || !matches(event)) {
          throw new Error(`The expected ${name} is not published yet.`);
        }
        return event;
      },
      { timeout: 15_000, interval: 250 },
    );
    organizationEvents[name].parse(found);
    return found;
  }

  /**
   * Counts the outbox rows of an event about an aggregate.
   *
   * @param name - Name of the event.
   * @param key - Member of the payload naming the aggregate.
   * @param id - Id of the aggregate.
   * @returns The count.
   */
  async function outboxCount(name: string, key: string, id: string): Promise<number> {
    const rows = await stack.system<{ count: number }>(
      `select count(*)::int as count from outbox_events
        where event_name = $1 and payload ->> $2 = $3`,
      [name, key, id],
    );
    return rows[0]?.count ?? 0;
  }

  /**
   * Reads the ledger of invitation emails of an organization, by invitation.
   *
   * @param organizationId - The organization.
   * @returns One row per email, sorted by invitation.
   */
  async function ledgerOf(organizationId: string): Promise<{ readonly invitation_id: string }[]> {
    return stack.system<{ readonly invitation_id: string }>(
      `select invitation_id from invitation_emails where organization_id = $1
        order by invitation_id, sent_at`,
      [organizationId],
    );
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

  beforeAll(async () => {
    stack = await ServiceStack.start('p2b');
    // Published before the service exists: its consumers must read the history of the stream.
    for (const account of [camille, ines, hugo, nadia]) {
      stack.publish('user.email-verified.v1', emailVerified(account, 2));
      stack.publish('user.signed-up.v1', signedUp(account, 1));
    }
    app = await stack.startApplication();
  });

  afterAll(async () => {
    await stack.stop();
  });

  describe('user directory', () => {
    it('projects the accounts signed up and verified before the service started', async () => {
      await vi.waitFor(
        async () => {
          for (const account of [camille, ines, hugo, nadia]) {
            expect(await directoryOf(account)).toEqual({
              name: account.name,
              email: account.email,
              email_verified: true,
              name_version: 1,
              email_version: 2,
            });
          }
        },
        { timeout: 30_000, interval: 250 },
      );
    });

    it('keeps the newest name when a late sign-up arrives after a profile change', async () => {
      stack.publish('user.signed-up.v1', signedUp(lea, 1));
      await vi.waitFor(async () => {
        expect((await directoryOf(lea))?.name).toBe('Léa Petit');
      });
      stack.publish('user.profile-updated.v1', profileUpdated(lea, 3, 'Léa Petit-Roux'));
      await vi.waitFor(async () => {
        expect((await directoryOf(lea))?.name).toBe('Léa Petit-Roux');
      });
      const before = stack.consumer('organization-service__project-user-signed-up');

      stack.publish('user.signed-up.v1', signedUp(lea, 2, 'Léa P.'));
      await drained('project-user-signed-up', before.delivered.consumer_seq + 1);

      expect(await directoryOf(lea)).toMatchObject({
        name: 'Léa Petit-Roux',
        name_version: 3,
        email: lea.email,
        email_verified: false,
        email_version: 2,
      });
    });

    it('skips a redelivered event without applying it twice', async () => {
      const first = signedUp(marc, 1);
      stack.publish('user.signed-up.v1', first);
      await vi.waitFor(async () => {
        expect((await directoryOf(marc))?.name).toBe('Marc Roux');
      });
      stack.publish('user.profile-updated.v1', profileUpdated(marc, 2, 'Marc Roux'));
      const before = stack.consumer('organization-service__project-user-signed-up');

      // The same event stored again, as a requeue past the duplicate window of the stream would.
      stack.publish('user.signed-up.v1', first, newId());
      await drained('project-user-signed-up', before.delivered.consumer_seq + 1);

      const processed = await stack.migrator.query<{ count: number }>(
        `select count(*)::int as count from processed_events
          where consumer = 'organization-service__project-user-signed-up' and event_id = $1`,
        [first.id],
      );
      expect(processed.rows).toEqual([{ count: 1 }]);
      expect(await directoryOf(marc)).toMatchObject({
        name: 'Marc Roux',
        email_verified: false,
        email_version: 1,
      });
    });

    it('keeps trying a failing directory event for 32 deliveries, the schedule of decision 3', () => {
      for (const handler of [
        'project-user-signed-up',
        'project-user-email-verified',
        'project-user-profile-updated',
        'project-user-email-changed',
        'project-user-two-step',
        'remove-deleted-user',
      ]) {
        expect(stack.consumer(`organization-service__${handler}`).config).toMatchObject({
          max_deliver: 32,
          ack_wait: 30_000_000_000,
        });
      }
    });
  });

  describe('organizations', () => {
    it('answers user.not-synchronized to an account it does not know yet', async () => {
      const stranger: Account = { id: newId(), name: 'Inconnu', email: 'inconnu@exemple.fr' };

      const response = await call('post', '/internal/v1/organizations', stranger, null, {
        name: 'Studio Nord',
      });

      expect(response.status).toBe(404);
      expect(response.body).toMatchObject({ code: 'user.not-synchronized' });
      const created = await stack.system<{ count: number }>(
        `select count(*)::int as count from organizations where slug = 'studio-nord'`,
      );
      expect(created).toEqual([{ count: 0 }]);
    });

    it('creates Atelier Nord with its owner and its invitations in one go', async () => {
      const response = await call('post', '/internal/v1/organizations', camille, null, {
        name: 'Atelier Nord',
        teamSize: '6-20',
        primaryUse: 'product-engineering',
        inviteEmails: [ines.email, 'Hugo.Dubois@ateliernord.fr', ines.email, camille.email],
      });

      expect(response.status).toBe(201);
      conforms(CreateOrganizationInternalResponse, response);
      expect(response.headers.location).toBe('/internal/v1/organization');
      expect(response.headers.etag).toBe('"1"');
      const body = response.body as OrganizationCreated;
      expect(body.organization).toMatchObject({
        name: 'Atelier Nord',
        slug: 'atelier-nord',
        description: null,
        website: null,
        defaultLanguage: 'fr',
        plan: 'free',
        memberCount: 1,
        role: 'owner',
        version: 1,
      });
      expect(body.invitations).toEqual([
        { email: ines.email, outcome: 'invited', invitationId: expect.any(String) as string },
        { email: hugo.email, outcome: 'invited', invitationId: expect.any(String) as string },
        { email: camille.email, outcome: 'already-member', invitationId: null },
      ]);
      atelierNordId = body.organization.id;
      inesInvitationId = body.invitations[0]?.invitationId ?? '';
      hugoInvitationId = body.invitations[1]?.invitationId ?? '';

      const created = await published(
        'organization.created.v1',
        (event) => event.organizationId === atelierNordId,
      );
      expect(created).toMatchObject({
        actor: { type: 'user', id: camille.id },
        version: 1,
        name: 'Atelier Nord',
        slug: 'atelier-nord',
        defaultLanguage: 'fr',
        plan: 'free',
        ownerUserId: camille.id,
        teamSize: '6-20',
        primaryUse: 'product-engineering',
      });
      const joined = await published(
        'member.joined.v1',
        (event) => event.organizationId === atelierNordId && event.userId === camille.id,
      );
      expect(joined).toMatchObject({ role: 'owner', version: 1, invitationId: null });
      camilleMemberId = String(joined.memberId);
      const issued = await published(
        'invitation.issued.v1',
        (event) => event.invitationId === hugoInvitationId,
      );
      expect(issued).toMatchObject({
        organizationId: atelierNordId,
        actor: { type: 'user', id: camille.id },
        version: 1,
        email: hugo.email,
        role: 'member',
        inviter: { userId: camille.id, name: 'Camille Martin' },
        organization: { name: 'Atelier Nord', memberCount: 1 },
        language: 'fr',
      });
      const expiresIn = Date.parse(String(issued.expiresAt)) - Date.now();
      expect(expiresIn).toBeGreaterThan(WEEK - 60_000);
      expect(expiresIn).toBeLessThanOrEqual(WEEK);
      expect(await outboxCount('invitation.issued.v1', 'organizationId', atelierNordId)).toBe(2);
      expect(await ledgerOf(atelierNordId)).toEqual(
        [inesInvitationId, hugoInvitationId].sort().map((invitationId: string) => ({
          invitation_id: invitationId,
        })),
      );
    });

    it('refuses an address taken, too short, reserved or not valid, and a blank name', async () => {
      const taken = await call('post', '/internal/v1/organizations', ines, null, {
        name: 'Atelier  Nord !',
      });
      const short = await call('post', '/internal/v1/organizations', ines, null, { name: 'é' });
      const derivedReserved = await call('post', '/internal/v1/organizations', ines, null, {
        name: 'Home',
      });
      const givenReserved = await call('post', '/internal/v1/organizations', ines, null, {
        name: 'Atelier Sud',
        slug: 'login',
      });
      const blank = await call('post', '/internal/v1/organizations', ines, null, { name: '   ' });
      const malformed = await call('post', '/internal/v1/organizations', ines, null, {
        name: 'Lumen',
        slug: 'Coopérative Lumen',
      });

      expect(taken.status).toBe(409);
      expect(taken.body).toMatchObject({
        code: 'organization.slug-taken',
        details: { slug: 'atelier-nord' },
      });
      expect(short.status).toBe(422);
      expect(short.body).toMatchObject({
        code: 'organization.slug-invalid',
        details: { slug: 'e' },
      });
      expect(derivedReserved.status).toBe(422);
      expect(derivedReserved.body).toMatchObject({
        code: 'organization.slug-reserved',
        details: { slug: 'home' },
      });
      expect(givenReserved.status).toBe(422);
      expect(givenReserved.body).toMatchObject({
        code: 'organization.slug-reserved',
        details: { slug: 'login' },
      });
      expect(blank.status).toBe(400);
      expect(blank.body).toMatchObject({ code: 'request.invalid' });
      expect(malformed.status).toBe(400);
      expect(malformed.body).toMatchObject({ code: 'request.invalid' });
    });

    it('creates Coopérative Lumen with the address given', async () => {
      const response = await call('post', '/internal/v1/organizations', ines, atelierNordId, {
        name: 'Coopérative Lumen',
        slug: 'lumen',
        teamSize: '21-100',
        primaryUse: 'other',
      });

      expect(response.status).toBe(201);
      const body = response.body as OrganizationCreated;
      expect(body.organization).toMatchObject({ slug: 'lumen', role: 'owner', memberCount: 1 });
      expect(body.invitations).toEqual([]);
      lumenId = body.organization.id;
    });

    it('reads the organization of the token for its members only', async () => {
      const read = await call('get', '/internal/v1/organization', camille, atelierNordId);
      const elsewhere = await call('get', '/internal/v1/organization', camille, lumenId);
      const without = await call('get', '/internal/v1/organization', camille, null);
      const anonymous = await call('get', '/internal/v1/organization', null, null);

      expect(read.status).toBe(200);
      conforms(GetOrganizationInternalResponse, read);
      expect(read.headers.etag).toBe('"1"');
      expect(read.body).toMatchObject({ id: atelierNordId, role: 'owner', memberCount: 1 });
      expect(elsewhere.status).toBe(404);
      expect(elsewhere.body).toMatchObject({ code: 'organization.not-found' });
      expect(without.status).toBe(403);
      expect(without.body).toMatchObject({ code: 'auth.organization-required' });
      expect(anonymous.status).toBe(401);
    });

    it('applies a merge patch with its version, and refuses stale or invalid ones', async () => {
      const patched = await call(
        'patch',
        '/internal/v1/organization',
        camille,
        atelierNordId,
        {
          description:
            'Studio de conception de mobilier et d’aménagement, 18 personnes entre Lille et Lyon.',
          website: 'https://ateliernord.fr',
        },
        { 'If-Match': '"1"' },
      );
      expect(patched.status).toBe(200);
      conforms(UpdateOrganizationInternalResponse, patched);
      expect(patched.headers.etag).toBe('"2"');
      expect(patched.body).toMatchObject({
        name: 'Atelier Nord',
        website: 'https://ateliernord.fr',
        version: 2,
        role: 'owner',
      });
      const updated = await published(
        'organization.updated.v1',
        (event) => event.organizationId === atelierNordId && event.version === 2,
      );
      expect(updated).toMatchObject({
        actor: { type: 'user', id: camille.id },
        changed: ['description', 'website'],
        slug: 'atelier-nord',
      });

      const stale = await call(
        'patch',
        '/internal/v1/organization',
        camille,
        atelierNordId,
        { name: 'Atelier Nord' },
        { 'If-Match': '"1"' },
      );
      const unchanged = await call(
        'patch',
        '/internal/v1/organization',
        camille,
        atelierNordId,
        {},
      );
      const script = await call('patch', '/internal/v1/organization', camille, atelierNordId, {
        website: 'javascript:alert(1)',
      });
      const taken = await call('patch', '/internal/v1/organization', camille, atelierNordId, {
        slug: 'lumen',
      });
      const reserved = await call('patch', '/internal/v1/organization', camille, atelierNordId, {
        slug: 'account',
      });
      const blank = await call('patch', '/internal/v1/organization', camille, atelierNordId, {
        name: '  ',
      });
      const malformed = await call(
        'patch',
        '/internal/v1/organization',
        camille,
        atelierNordId,
        {},
        { 'If-Match': 'version-2' },
      );

      expect(stale.status).toBe(412);
      expect(stale.body).toMatchObject({
        code: 'request.version-mismatch',
        details: { version: 2 },
      });
      expect(unchanged.status).toBe(200);
      expect(unchanged.body).toMatchObject({ version: 2 });
      expect(script.status).toBe(400);
      expect(script.body).toMatchObject({ code: 'request.invalid' });
      expect(taken.status).toBe(409);
      expect(taken.body).toMatchObject({ code: 'organization.slug-taken' });
      expect(reserved.status).toBe(422);
      expect(reserved.body).toMatchObject({
        code: 'organization.slug-reserved',
        details: { slug: 'account' },
      });
      expect(blank.status).toBe(400);
      expect(malformed.status).toBe(400);
      expect(malformed.body).toMatchObject({
        code: 'request.invalid',
        details: { issues: [{ in: 'header', path: 'If-Match', code: 'invalid_format' }] },
      });
      expect(await outboxCount('organization.updated.v1', 'organizationId', atelierNordId)).toBe(1);

      const cleared = await call('patch', '/internal/v1/organization', camille, atelierNordId, {
        website: null,
      });
      expect(cleared.status).toBe(200);
      expect(cleared.body).toMatchObject({ website: null, version: 3 });
    });
  });

  describe('invitations', () => {
    it('withholds a pending invitation after Identity confirms a new address', async () => {
      stack.verifiedEmails.set(ines.id, 3, 'current-address@example.test');
      try {
        const response = await call('get', `/internal/v1/users/${ines.id}/invitations`, ines, null);
        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({ items: [] });
      } finally {
        stack.verifiedEmails.set(ines.id, 4, ines.email);
      }
    });

    it('lists the invitations addressed to the verified address of the invitee', async () => {
      const response = await call('get', `/internal/v1/users/${ines.id}/invitations`, ines, null);
      const other = await call('get', `/internal/v1/users/${camille.id}/invitations`, ines, null);

      expect(response.status).toBe(200);
      conforms(ListReceivedInvitationsInternalResponse, response);
      expect(response.body).toEqual({
        items: [
          {
            id: inesInvitationId,
            organization: {
              id: atelierNordId,
              name: 'Atelier Nord',
              slug: 'atelier-nord',
              description:
                'Studio de conception de mobilier et d’aménagement, 18 personnes entre Lille et Lyon.',
              memberCount: 1,
            },
            role: 'member',
            invitedBy: { userId: camille.id, name: 'Camille Martin' },
            expiresAt: expect.any(String) as string,
          },
        ],
        nextCursor: null,
      });
      expect(other.status).toBe(404);
      expect(other.body).toMatchObject({ code: 'user.not-found' });
    });

    it('lets only the invited address accept, once', async () => {
      const mismatch = await call(
        'post',
        `/internal/v1/users/${hugo.id}/invitations/${inesInvitationId}/accept`,
        hugo,
        null,
        {},
      );
      const unknown = await call(
        'post',
        `/internal/v1/users/${ines.id}/invitations/${newId()}/accept`,
        ines,
        null,
        {},
      );
      const someoneElse = await call(
        'post',
        `/internal/v1/users/${hugo.id}/invitations/${inesInvitationId}/accept`,
        ines,
        null,
        {},
      );
      expect(mismatch.status).toBe(403);
      expect(mismatch.body).toMatchObject({ code: 'invitation.email-mismatch' });
      expect(unknown.status).toBe(404);
      expect(unknown.body).toMatchObject({ code: 'invitation.not-found' });
      expect(someoneElse.status).toBe(404);
      expect(someoneElse.body).toMatchObject({ code: 'user.not-found' });

      const accepted = await call(
        'post',
        `/internal/v1/users/${ines.id}/invitations/${inesInvitationId}/accept`,
        ines,
        lumenId,
        {},
      );
      expect(accepted.status).toBe(200);
      conforms(AcceptInvitationInternalResponse, accepted);
      expect(accepted.body).toEqual({
        id: atelierNordId,
        name: 'Atelier Nord',
        slug: 'atelier-nord',
        role: 'member',
        memberCount: 2,
        plan: 'free',
        joinedAt: expect.any(String) as string,
      });
      const joined = await published(
        'member.joined.v1',
        (event) => event.organizationId === atelierNordId && event.userId === ines.id,
      );
      expect(joined).toMatchObject({
        actor: { type: 'user', id: ines.id },
        role: 'member',
        version: 1,
        invitationId: inesInvitationId,
      });
      inesMemberId = String(joined.memberId);

      const again = await call(
        'post',
        `/internal/v1/users/${ines.id}/invitations/${inesInvitationId}/accept`,
        ines,
        null,
        {},
      );
      expect(again.status).toBe(409);
      expect(again.body).toMatchObject({
        code: 'invitation.answered',
        details: { status: 'accepted' },
      });
    });

    it('lists the organizations of the actor by name, page by page', async () => {
      const all = await call('get', '/internal/v1/organizations', ines, null);
      const first = await call('get', '/internal/v1/organizations?limit=1', ines, null);
      const cursor = (first.body as MyOrganizationPage).nextCursor ?? '';
      const second = await call(
        'get',
        `/internal/v1/organizations?limit=1&cursor=${encodeURIComponent(cursor)}`,
        ines,
        null,
      );

      expect(all.status).toBe(200);
      conforms(ListMyOrganizationsInternalResponse, all);
      expect((all.body as MyOrganizationPage).items).toEqual([
        {
          id: atelierNordId,
          name: 'Atelier Nord',
          slug: 'atelier-nord',
          role: 'member',
          memberCount: 2,
          plan: 'free',
          joinedAt: expect.any(String) as string,
        },
        {
          id: lumenId,
          name: 'Coopérative Lumen',
          slug: 'lumen',
          role: 'owner',
          memberCount: 1,
          plan: 'free',
          joinedAt: expect.any(String) as string,
        },
      ]);
      expect(
        (first.body as MyOrganizationPage).items.map((item: MyOrganization) => item.id),
      ).toEqual([atelierNordId]);
      expect(second.body).toMatchObject({ items: [{ id: lumenId }], nextCursor: null });
    });

    it('lets the owner make Inès an admin, with the version of the membership', async () => {
      const changed = await call(
        'patch',
        `/internal/v1/members/${inesMemberId}`,
        camille,
        atelierNordId,
        { role: 'admin' },
        { 'If-Match': '"1"' },
      );
      expect(changed.status).toBe(200);
      conforms(ChangeMemberRoleInternalResponse, changed);
      expect(changed.headers.etag).toBe('"2"');
      expect(changed.body).toEqual({
        id: inesMemberId,
        userId: ines.id,
        name: 'Inès Robert',
        email: ines.email,
        role: 'admin',
        joinedAt: expect.any(String) as string,
        version: 2,
        twoStepVerificationEnabled: false,
      });
      const event = await published(
        'member.role-changed.v1',
        (payload) => payload.memberId === inesMemberId,
      );
      expect(event).toMatchObject({
        organizationId: atelierNordId,
        actor: { type: 'user', id: camille.id },
        version: 2,
        userId: ines.id,
        role: 'admin',
        previousRole: 'member',
      });

      const same = await call(
        'patch',
        `/internal/v1/members/${inesMemberId}`,
        camille,
        atelierNordId,
        {
          role: 'admin',
        },
      );
      const stale = await call(
        'patch',
        `/internal/v1/members/${inesMemberId}`,
        camille,
        atelierNordId,
        { role: 'member' },
        { 'If-Match': '"1"' },
      );
      const owner = await call(
        'patch',
        `/internal/v1/members/${inesMemberId}`,
        camille,
        atelierNordId,
        {
          role: 'owner',
        },
      );
      expect(same.status).toBe(200);
      expect(same.body).toMatchObject({ role: 'admin', version: 2 });
      expect(stale.status).toBe(412);
      expect(stale.body).toMatchObject({
        code: 'request.version-mismatch',
        details: { version: 2 },
      });
      expect(owner.status).toBe(400);
      expect(await outboxCount('member.role-changed.v1', 'memberId', inesMemberId)).toBe(1);
    });

    it('answers each address of a batch, without failing the whole batch', async () => {
      const batch = await call('post', '/internal/v1/invitations', ines, atelierNordId, {
        emails: [marc.email, 'Ines.Robert@ateliernord.fr', hugo.email, marc.email],
        role: 'member',
      });

      expect(batch.status).toBe(200);
      conforms(InviteMembersInternalResponse, batch);
      const outcomes = (batch.body as InvitationBatchResult).invitations;
      expect(outcomes).toEqual([
        { email: marc.email, outcome: 'invited', invitationId: expect.any(String) as string },
        { email: ines.email, outcome: 'already-member', invitationId: null },
        { email: hugo.email, outcome: 'already-invited', invitationId: hugoInvitationId },
      ]);
      marcInvitationId = outcomes[0]?.invitationId ?? '';
      const issued = await published(
        'invitation.issued.v1',
        (event) => event.invitationId === marcInvitationId,
      );
      expect(issued).toMatchObject({
        actor: { type: 'user', id: ines.id },
        inviter: { userId: ines.id, name: 'Inès Robert' },
        organization: { name: 'Atelier Nord', memberCount: 2 },
        role: 'member',
        email: marc.email,
      });
      expect(await outboxCount('invitation.issued.v1', 'invitationId', hugoInvitationId)).toBe(1);

      const guests = await call('post', '/internal/v1/invitations', camille, atelierNordId, {
        emails: [nadia.email],
        role: 'guest',
      });
      const stray = await call('post', '/internal/v1/invitations', camille, atelierNordId, {
        emails: ['atelier@nordstudio.fr'],
      });
      expect(guests.body).toMatchObject({ invitations: [{ outcome: 'invited' }] });
      expect(stray.body).toMatchObject({ invitations: [{ outcome: 'invited' }] });
      nadiaInvitationId = (guests.body as InvitationBatchResult).invitations[0]?.invitationId ?? '';
      strayInvitationId = (stray.body as InvitationBatchResult).invitations[0]?.invitationId ?? '';
    });

    it('lists the pending invitations, the most recently sent first, page by page', async () => {
      const all = await call('get', '/internal/v1/invitations', camille, atelierNordId);
      const first = await call('get', '/internal/v1/invitations?limit=2', camille, atelierNordId);
      const cursor = (first.body as InvitationPage).nextCursor ?? '';
      const second = await call(
        'get',
        `/internal/v1/invitations?limit=2&cursor=${encodeURIComponent(cursor)}`,
        camille,
        atelierNordId,
      );

      expect(all.status).toBe(200);
      conforms(ListInvitationsInternalResponse, all);
      const page = all.body as InvitationPage;
      expect(page.total).toBe(4);
      expect(page.items.map((item: Invitation) => item.id)).toEqual([
        strayInvitationId,
        nadiaInvitationId,
        marcInvitationId,
        hugoInvitationId,
      ]);
      expect(page.items[2]).toMatchObject({
        email: marc.email,
        role: 'member',
        invitedBy: { userId: ines.id, name: 'Inès Robert' },
        status: 'pending',
        version: 1,
      });
      expect((first.body as InvitationPage).items).toHaveLength(2);
      expect((second.body as InvitationPage).items.map((item: Invitation) => item.id)).toEqual([
        marcInvitationId,
        hugoInvitationId,
      ]);
      expect((second.body as InvitationPage).nextCursor).toBeNull();
    });

    it('lets Hugo refuse once, then join with a new invitation', async () => {
      const refused = await call(
        'post',
        `/internal/v1/users/${hugo.id}/invitations/${hugoInvitationId}/refuse`,
        hugo,
        null,
        {},
      );
      const again = await call(
        'post',
        `/internal/v1/users/${hugo.id}/invitations/${hugoInvitationId}/refuse`,
        hugo,
        null,
        {},
      );
      const received = await call('get', `/internal/v1/users/${hugo.id}/invitations`, hugo, null);
      expect(refused.status).toBe(204);
      expect(again.status).toBe(409);
      expect(again.body).toMatchObject({
        code: 'invitation.answered',
        details: { status: 'refused' },
      });
      expect(received.body).toEqual({ items: [], nextCursor: null });

      const reinvited = await call('post', '/internal/v1/invitations', camille, atelierNordId, {
        emails: [hugo.email],
      });
      const invitation = (reinvited.body as InvitationBatchResult).invitations[0];
      expect(invitation).toMatchObject({ outcome: 'invited' });
      expect(invitation?.invitationId).not.toBe(hugoInvitationId);
      const accepted = await call(
        'post',
        `/internal/v1/users/${hugo.id}/invitations/${invitation?.invitationId ?? ''}/accept`,
        hugo,
        null,
        {},
      );
      expect(accepted.status).toBe(200);
      expect(accepted.body).toMatchObject({ role: 'member', memberCount: 3 });
      const joined = await published(
        'member.joined.v1',
        (event) => event.organizationId === atelierNordId && event.userId === hugo.id,
      );
      hugoMemberId = String(joined.memberId);
    });

    it('refuses an expired invitation until it is resent for 7 more days', async () => {
      await stack.system(
        `update invitations
            set sent_at = now() - interval '8 days', expires_at = now() - interval '1 day'
          where id = $1`,
        [nadiaInvitationId],
      );
      const listed = await call('get', '/internal/v1/invitations', camille, atelierNordId);
      const received = await call('get', `/internal/v1/users/${nadia.id}/invitations`, nadia, null);
      const expired = await call(
        'post',
        `/internal/v1/users/${nadia.id}/invitations/${nadiaInvitationId}/accept`,
        nadia,
        null,
        {},
      );
      expect(
        (listed.body as InvitationPage).items.find(
          (item: Invitation) => item.id === nadiaInvitationId,
        ),
      ).toMatchObject({ status: 'expired' });
      expect(received.body).toEqual({ items: [], nextCursor: null });
      expect(expired.status).toBe(409);
      expect(expired.body).toMatchObject({
        code: 'invitation.expired',
        details: { expiresAt: expect.any(String) as string },
      });

      const resent = await call(
        'post',
        `/internal/v1/invitations/${nadiaInvitationId}/resend`,
        camille,
        atelierNordId,
        {},
      );
      expect(resent.status).toBe(200);
      conforms(ResendInvitationInternalResponse, resent);
      expect(resent.headers.etag).toBe('"2"');
      const invitation = resent.body as Invitation;
      expect(invitation).toMatchObject({
        id: nadiaInvitationId,
        email: nadia.email,
        role: 'guest',
        invitedBy: { userId: camille.id, name: 'Camille Martin' },
        status: 'pending',
        version: 2,
      });
      expect(Date.parse(invitation.expiresAt) - Date.parse(invitation.sentAt)).toBe(WEEK);
      const issued = await published(
        'invitation.issued.v1',
        (event) => event.invitationId === nadiaInvitationId && event.version === 2,
      );
      expect(issued).toMatchObject({ email: nadia.email, organization: { memberCount: 3 } });

      const accepted = await call(
        'post',
        `/internal/v1/users/${nadia.id}/invitations/${nadiaInvitationId}/accept`,
        nadia,
        null,
        {},
      );
      expect(accepted.status).toBe(200);
      expect(accepted.body).toMatchObject({ role: 'guest', memberCount: 3 });
    });

    it('revokes a pending invitation once and for all', async () => {
      const revoked = await call(
        'delete',
        `/internal/v1/invitations/${strayInvitationId}`,
        camille,
        atelierNordId,
      );
      const again = await call(
        'delete',
        `/internal/v1/invitations/${strayInvitationId}`,
        camille,
        atelierNordId,
      );
      const resent = await call(
        'post',
        `/internal/v1/invitations/${strayInvitationId}/resend`,
        camille,
        atelierNordId,
        {},
      );
      const answered = await call(
        'delete',
        `/internal/v1/invitations/${hugoInvitationId}`,
        camille,
        atelierNordId,
      );
      const extra = await call(
        'post',
        `/internal/v1/invitations/${strayInvitationId}/resend`,
        camille,
        atelierNordId,
        { message: 'Bienvenue' },
      );
      const resendAnswered = await call(
        'post',
        `/internal/v1/invitations/${hugoInvitationId}/resend`,
        camille,
        atelierNordId,
        {},
      );

      expect(revoked.status).toBe(204);
      expect(again.status).toBe(204);
      expect(resent.status).toBe(409);
      expect(resent.body).toMatchObject({ code: 'invitation.revoked' });
      expect(answered.status).toBe(409);
      expect(answered.body).toMatchObject({
        code: 'invitation.answered',
        details: { status: 'refused' },
      });
      expect(resendAnswered.status).toBe(409);
      expect(extra.status).toBe(400);
      expect(extra.body).toMatchObject({ code: 'request.invalid' });
      const listed = await call('get', '/internal/v1/invitations', camille, atelierNordId);
      expect((listed.body as InvitationPage).items.map((item: Invitation) => item.id)).toEqual([
        marcInvitationId,
      ]);
    });

    it('lets Marc answer only once identity-service has verified his address', async () => {
      const unverified = await call('get', `/internal/v1/users/${marc.id}/invitations`, marc, null);
      const early = await call(
        'post',
        `/internal/v1/users/${marc.id}/invitations/${marcInvitationId}/accept`,
        marc,
        null,
        {},
      );
      expect(unverified.body).toEqual({ items: [], nextCursor: null });
      expect(early.status).toBe(404);
      expect(early.body).toMatchObject({ code: 'invitation.not-found' });

      expect((await directoryOf(marc))?.email_verified).toBe(false);
      stack.verifiedEmails.set(marc.id, 3, marc.email);
      const received = await call('get', `/internal/v1/users/${marc.id}/invitations`, marc, null);
      expect((received.body as ReceivedInvitationPage).items).toEqual([
        expect.objectContaining({
          id: marcInvitationId,
          invitedBy: { userId: ines.id, name: 'Inès Robert' },
        }),
      ]);
      const accepted = await call(
        'post',
        `/internal/v1/users/${marc.id}/invitations/${marcInvitationId}/accept`,
        marc,
        null,
        {},
      );
      expect(accepted.status).toBe(200);
      expect(accepted.body).toMatchObject({ role: 'member', memberCount: 4 });
      expect((await directoryOf(marc))?.email_verified).toBe(false);

      stack.publish('user.email-verified.v1', emailVerified(marc, 3));
      await vi.waitFor(async () => {
        expect((await directoryOf(marc))?.email_verified).toBe(true);
      });
    });
  });

  describe('members', () => {
    it('returns the same filtered pages through GET and QUERY', async () => {
      const getFirst = await call(
        'get',
        '/internal/v1/members?role=owner,admin&limit=1',
        camille,
        atelierNordId,
      );
      const queryFirst = await call('query', '/internal/v1/members', camille, atelierNordId, {
        role: ['owner', 'admin'],
        limit: 1,
      });
      expect(queryFirst.status).toBe(200);
      conforms(ListMembersInternalResponse, queryFirst);
      expect(queryFirst.body).toEqual(getFirst.body);
      const cursor = (getFirst.body as MemberPage).nextCursor ?? '';
      const getSecond = await call(
        'get',
        `/internal/v1/members?role=owner,admin&limit=1&cursor=${encodeURIComponent(cursor)}`,
        camille,
        atelierNordId,
      );
      const querySecond = await call('query', '/internal/v1/members', camille, atelierNordId, {
        role: ['owner', 'admin'],
        limit: 1,
        cursor,
      });
      expect(querySecond.status).toBe(200);
      expect(querySecond.body).toEqual(getSecond.body);

      const getSearch = await call(
        'get',
        '/internal/v1/members?search=INES',
        camille,
        atelierNordId,
      );
      const querySearch = await call('query', '/internal/v1/members', camille, atelierNordId, {
        search: 'INES',
      });
      expect(querySearch.status).toBe(200);
      expect(querySearch.body).toEqual(getSearch.body);
    });

    it('enforces member access, organization isolation and body validation for QUERY', async () => {
      const guest = await call('query', '/internal/v1/members', nadia, atelierNordId, {});
      const guestGet = await call('get', '/internal/v1/members', nadia, atelierNordId);
      const outsider = await call('query', '/internal/v1/members', camille, lumenId, {});
      const outsiderGet = await call('get', '/internal/v1/members', camille, lumenId);
      const invalid = await call('query', '/internal/v1/members', camille, atelierNordId, {
        role: ['invalid'],
        limit: 0,
      });
      const missing = await call('query', '/internal/v1/members', camille, atelierNordId);
      const emptyJson = await call(
        'query',
        '/internal/v1/members',
        camille,
        atelierNordId,
        undefined,
        { 'Content-Type': 'application/json', 'Content-Length': '0' },
      );
      const emptyObject = await call('query', '/internal/v1/members', camille, atelierNordId, {});
      const wrongContentType = await call(
        'query',
        '/internal/v1/members',
        camille,
        atelierNordId,
        '{}',
        { 'Content-Type': 'text/plain' },
      );
      const form = await call(
        'query',
        '/internal/v1/members',
        camille,
        atelierNordId,
        'search=INES',
        { 'Content-Type': 'application/x-www-form-urlencoded' },
      );
      expect(guest.status).toBe(guestGet.status);
      expect(guest.status).toBe(403);
      expect(outsider.status).toBe(outsiderGet.status);
      expect(outsider.status).toBe(404);
      expect(invalid.status).toBe(400);
      expect(invalid.body).toMatchObject({ code: 'request.invalid' });
      expect(missing.status).toBe(400);
      expect(emptyJson.status).toBe(400);
      expect(emptyJson.body).toMatchObject({ code: 'request.invalid' });
      expect(emptyObject.status).toBe(200);
      expect(wrongContentType.status).toBe(400);
      expect(form.status).toBe(400);
      expect(form.body).toMatchObject({ code: 'request.invalid' });
    });

    it('lists the members by name with the counts of every role', async () => {
      const response = await call('get', '/internal/v1/members', camille, atelierNordId);

      expect(response.status).toBe(200);
      conforms(ListMembersInternalResponse, response);
      const page = response.body as MemberPage;
      expect(page.items.map((member: Member) => [member.name, member.role])).toEqual([
        ['Camille Martin', 'owner'],
        ['Hugo Dubois', 'member'],
        ['Inès Robert', 'admin'],
        ['Marc Roux', 'member'],
        ['Nadia Garnier', 'guest'],
      ]);
      expect(page.items[0]).toEqual({
        id: camilleMemberId,
        userId: camille.id,
        name: 'Camille Martin',
        email: camille.email,
        role: 'owner',
        joinedAt: expect.any(String) as string,
        version: 1,
        twoStepVerificationEnabled: false,
      });
      expect(page.total).toBe(5);
      expect(page.counts).toEqual({ owner: 1, admin: 1, member: 2, guest: 1 });
      expect(page.nextCursor).toBeNull();
    });

    it('searches names and addresses without regard to case or accents, and filters roles', async () => {
      const accented = await call(
        'get',
        '/internal/v1/members?search=INES',
        camille,
        atelierNordId,
      );
      const address = await call(
        'get',
        '/internal/v1/members?search=cabinet-garnier',
        camille,
        atelierNordId,
      );
      const wildcard = await call('get', '/internal/v1/members?search=%25', camille, atelierNordId);
      const admins = await call(
        'get',
        '/internal/v1/members?role=owner,admin',
        camille,
        atelierNordId,
      );

      expect((accented.body as MemberPage).items.map((member: Member) => member.name)).toEqual([
        'Inès Robert',
      ]);
      expect(accented.body).toMatchObject({ total: 1, counts: { member: 2 } });
      expect((address.body as MemberPage).items.map((member: Member) => member.name)).toEqual([
        'Nadia Garnier',
      ]);
      expect(wildcard.body).toMatchObject({ items: [], total: 0 });
      expect((admins.body as MemberPage).items.map((member: Member) => member.name)).toEqual([
        'Camille Martin',
        'Inès Robert',
      ]);
      expect(admins.body).toMatchObject({
        total: 2,
        counts: { owner: 1, admin: 1, member: 2, guest: 1 },
      });
    });

    it('pages the members with cursors bound to their filters', async () => {
      const first = await call('get', '/internal/v1/members?limit=2', camille, atelierNordId);
      const cursor = encodeURIComponent((first.body as MemberPage).nextCursor ?? '');
      const second = await call(
        'get',
        `/internal/v1/members?limit=2&cursor=${cursor}`,
        camille,
        atelierNordId,
      );
      const third = await call(
        'get',
        `/internal/v1/members?limit=2&cursor=${encodeURIComponent((second.body as MemberPage).nextCursor ?? '')}`,
        camille,
        atelierNordId,
      );
      const otherFilters = await call(
        'get',
        `/internal/v1/members?limit=2&role=guest&cursor=${cursor}`,
        camille,
        atelierNordId,
      );
      const unknown = await call('get', '/internal/v1/members?sort=name', camille, atelierNordId);
      const tooSmall = await call('get', '/internal/v1/members?limit=0', camille, atelierNordId);
      const garbage = await call('get', '/internal/v1/members?cursor=abc', camille, atelierNordId);
      const asText = await call('get', '/internal/v1/members?limit=1e1', camille, atelierNordId);

      const names = (response: Response): string[] =>
        (response.body as MemberPage).items.map((member: Member) => member.name);
      expect(names(first)).toEqual(['Camille Martin', 'Hugo Dubois']);
      expect(names(second)).toEqual(['Inès Robert', 'Marc Roux']);
      expect(names(third)).toEqual(['Nadia Garnier']);
      expect((third.body as MemberPage).nextCursor).toBeNull();
      expect((second.body as MemberPage).total).toBe(5);
      expect(otherFilters.status).toBe(400);
      expect(otherFilters.body).toMatchObject({
        code: 'request.invalid',
        details: { issues: [{ in: 'query', path: 'cursor' }] },
      });
      expect(unknown.status).toBe(400);
      expect(unknown.body).toMatchObject({ code: 'request.invalid' });
      expect(tooSmall.status).toBe(400);
      expect(tooSmall.body).toMatchObject({
        code: 'request.invalid',
        details: { issues: [{ in: 'query', path: 'limit' }] },
      });
      expect(garbage.status).toBe(400);
      expect(garbage.body).toMatchObject({
        code: 'request.invalid',
        details: { issues: [{ in: 'query', path: 'cursor', code: 'invalid_cursor' }] },
      });
      // The validator of the contract reads limit with Number(), so 1e1 is 10.
      expect(names(asText)).toHaveLength(5);
    });

    it('applies the role rules from its own members', async () => {
      const guestList = await call('get', '/internal/v1/members', nadia, atelierNordId);
      const guestRead = await call(
        'get',
        `/internal/v1/members/${camilleMemberId}`,
        nadia,
        atelierNordId,
      );
      const guestOrganization = await call(
        'get',
        '/internal/v1/organization',
        nadia,
        atelierNordId,
      );
      const memberList = await call('get', '/internal/v1/members', hugo, atelierNordId);
      const memberRead = await call(
        'get',
        `/internal/v1/members/${inesMemberId}`,
        hugo,
        atelierNordId,
      );
      const memberChange = await call(
        'patch',
        `/internal/v1/members/${inesMemberId}`,
        hugo,
        atelierNordId,
        { role: 'member' },
      );
      const memberRemove = await call(
        'delete',
        `/internal/v1/members/${inesMemberId}`,
        hugo,
        atelierNordId,
      );
      const memberInvite = await call('post', '/internal/v1/invitations', hugo, atelierNordId, {
        emails: ['lucie@exemple.fr'],
      });
      const memberPending = await call('get', '/internal/v1/invitations', hugo, atelierNordId);
      const memberPatch = await call('patch', '/internal/v1/organization', hugo, atelierNordId, {
        name: 'Atelier Hugo',
      });
      const adminOnOwner = await call(
        'patch',
        `/internal/v1/members/${camilleMemberId}`,
        ines,
        atelierNordId,
        { role: 'admin' },
      );
      const adminRemovesOwner = await call(
        'delete',
        `/internal/v1/members/${camilleMemberId}`,
        ines,
        atelierNordId,
      );

      for (const refused of [
        guestList,
        guestRead,
        memberChange,
        memberRemove,
        memberInvite,
        memberPending,
        memberPatch,
      ]) {
        expect(refused.status).toBe(403);
        expect(refused.body).toMatchObject({ code: 'organization.role-forbidden' });
      }
      expect(guestOrganization.status).toBe(200);
      expect(guestOrganization.body).toMatchObject({ role: 'guest', memberCount: 4 });
      expect(memberList.status).toBe(200);
      expect(memberRead.status).toBe(200);
      conforms(GetMemberInternalResponse, memberRead);
      expect(memberRead.headers.etag).toBe('"2"');
      expect(adminOnOwner.status).toBe(422);
      expect(adminOnOwner.body).toMatchObject({ code: 'member.owner-protected' });
      expect(adminRemovesOwner.status).toBe(422);
      expect(adminRemovesOwner.body).toMatchObject({ code: 'member.owner-protected' });
    });

    it('removes Hugo, who then reads nothing of Atelier Nord and rejoins as a new member', async () => {
      const removed = await call(
        'delete',
        `/internal/v1/members/${hugoMemberId}`,
        camille,
        atelierNordId,
      );
      expect(removed.status).toBe(204);
      const event = await published(
        'member.removed.v1',
        (payload) => payload.memberId === hugoMemberId,
      );
      expect(event).toMatchObject({
        organizationId: atelierNordId,
        actor: { type: 'user', id: camille.id },
        version: 2,
        userId: hugo.id,
        role: 'member',
      });

      const again = await call(
        'delete',
        `/internal/v1/members/${hugoMemberId}`,
        camille,
        atelierNordId,
      );
      const read = await call(
        'get',
        `/internal/v1/members/${hugoMemberId}`,
        camille,
        atelierNordId,
      );
      const ownList = await call('get', '/internal/v1/members', hugo, atelierNordId);
      const mine = await call('get', '/internal/v1/organizations', hugo, null);
      expect(again.status).toBe(404);
      expect(again.body).toMatchObject({ code: 'member.not-found' });
      expect(read.status).toBe(404);
      expect(ownList.status).toBe(404);
      expect(ownList.body).toMatchObject({ code: 'organization.not-found' });
      expect(mine.body).toEqual({ items: [], nextCursor: null });

      const invited = await call('post', '/internal/v1/invitations', camille, atelierNordId, {
        emails: [hugo.email],
      });
      const invitationId =
        (invited.body as InvitationBatchResult).invitations[0]?.invitationId ?? '';
      await call(
        'post',
        `/internal/v1/users/${hugo.id}/invitations/${invitationId}/accept`,
        hugo,
        null,
        {},
      );
      const rejoined = await published(
        'member.joined.v1',
        (payload) => payload.userId === hugo.id && payload.invitationId === invitationId,
      );
      expect(rejoined.memberId).not.toBe(hugoMemberId);
      expect(rejoined.version).toBe(1);
    });

    it('answers 400 for an id that is not a UUID', async () => {
      const response = await call('get', '/internal/v1/members/cm', camille, atelierNordId);

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ code: 'request.invalid' });
    });
  });

  describe('isolation', () => {
    it('answers 404 for a member or an invitation of another organization', async () => {
      const read = await call('get', `/internal/v1/members/${camilleMemberId}`, ines, lumenId);
      const change = await call('patch', `/internal/v1/members/${camilleMemberId}`, ines, lumenId, {
        role: 'guest',
      });
      const remove = await call('delete', `/internal/v1/members/${inesMemberId}`, ines, lumenId);
      const revoke = await call(
        'delete',
        `/internal/v1/invitations/${marcInvitationId}`,
        ines,
        lumenId,
      );
      const resend = await call(
        'post',
        `/internal/v1/invitations/${marcInvitationId}/resend`,
        ines,
        lumenId,
        {},
      );
      const outsider = await call('get', '/internal/v1/members', camille, lumenId);

      for (const response of [read, change, remove]) {
        expect(response.status).toBe(404);
        expect(response.body).toMatchObject({ code: 'member.not-found' });
      }
      for (const response of [revoke, resend]) {
        expect(response.status).toBe(404);
        expect(response.body).toMatchObject({ code: 'invitation.not-found' });
      }
      expect(outsider.status).toBe(404);
      expect(outsider.body).toMatchObject({ code: 'organization.not-found' });
      const unchanged = await call(
        'get',
        `/internal/v1/members/${camilleMemberId}`,
        camille,
        atelierNordId,
      );
      expect(unchanged.body).toMatchObject({ role: 'owner', version: 1 });
    });

    it('keeps the rows of Atelier Nord out of a tenant transaction of Coopérative Lumen', async () => {
      const tenant = app.get(TenantTransactionRunner);
      const context: OrganizationContext = {
        organizationId: lumenId,
        actor: { type: 'user', id: ines.id },
        role: null,
        scopes: [],
      };

      const visible = await runWithOrganizationContext(context, () =>
        tenant.run(async (tx) => {
          const counts = await tx.client.query(
            `select (select count(*)::int from organizations) as organizations,
                    (select count(*)::int from members) as members,
                    (select count(*)::int from invitations) as invitations,
                    (select count(*)::int from invitation_emails) as invitation_emails,
                    (select count(*)::int from organizations where id = $1) as atelier`,
            [atelierNordId],
          );
          return counts.rows[0];
        }),
      );
      expect(visible).toEqual({
        organizations: 1,
        members: 1,
        invitations: 0,
        invitation_emails: 0,
        atelier: 0,
      });

      for (const statement of [
        `insert into members (organization_id, user_id, role, joined_at) values ($1, '${hugo.id}', 'admin', now())`,
        `insert into invitations (organization_id, email, role, invited_by_user_id, sent_at, expires_at)
           values ($1, 'intrus@exemple.fr', 'admin', '${ines.id}', now(), now() + interval '7 days')`,
        `insert into invitation_emails (organization_id, invitation_id, sent_at)
           values ($1, '${marcInvitationId}', now())`,
      ]) {
        await expect(
          runWithOrganizationContext(context, () =>
            tenant.run((tx) => tx.client.query(statement, [atelierNordId])),
          ),
        ).rejects.toMatchObject({ code: '42501' });
      }
      const updated = await runWithOrganizationContext(context, () =>
        tenant.run((tx) =>
          tx.client.query(
            `update members set role = 'guest' where organization_id = $1 returning id`,
            [atelierNordId],
          ),
        ),
      );
      expect(updated.rows).toHaveLength(0);
      const owner = await call(
        'get',
        `/internal/v1/members/${camilleMemberId}`,
        camille,
        atelierNordId,
      );
      expect(owner.body).toMatchObject({ role: 'owner' });
    });
  });

  describe('transactions', () => {
    it('rolls back the organization, its owner and its events when an invitation fails', async () => {
      await stack.migrator.query(`
        create function refuse_rollback_probe() returns trigger language plpgsql as $$
        begin
          if new.email = 'rollback@ateliernord.fr' then
            raise exception 'rollback probe';
          end if;
          return new;
        end $$`);
      await stack.migrator.query(`
        create trigger invitations_rollback_probe before insert on invitations
        for each row execute function refuse_rollback_probe()`);
      const before = await stack.system<{ count: number }>(
        'select count(*)::int as count from outbox_events',
      );
      const emailsBefore = await stack.system<{ count: number }>(
        'select count(*)::int as count from invitation_emails',
      );
      try {
        const response = await call('post', '/internal/v1/organizations', camille, null, {
          name: 'Atelier Sud',
          inviteEmails: [ines.email, 'rollback@ateliernord.fr'],
        });

        expect(response.status).toBe(500);
        expect(response.body).toMatchObject({ code: 'internal.unexpected' });
      } finally {
        await stack.migrator.query('drop trigger invitations_rollback_probe on invitations');
        await stack.migrator.query('drop function refuse_rollback_probe()');
      }
      const organizations = await stack.system<{ count: number }>(
        `select count(*)::int as count from organizations where slug = 'atelier-sud'`,
      );
      const owners = await stack.system<{ count: number }>(
        `select count(*)::int as count from members where user_id = $1`,
        [camille.id],
      );
      const after = await stack.system<{ count: number }>(
        'select count(*)::int as count from outbox_events',
      );
      const emailsAfter = await stack.system<{ count: number }>(
        'select count(*)::int as count from invitation_emails',
      );
      expect(organizations).toEqual([{ count: 0 }]);
      expect(owners).toEqual([{ count: 1 }]);
      expect(after).toEqual(before);
      expect(emailsAfter).toEqual(emailsBefore);

      const retried = await call('post', '/internal/v1/organizations', camille, null, {
        name: 'Atelier Sud',
      });
      expect(retried.status).toBe(201);
      expect((retried.body as { organization: Organization }).organization.slug).toBe(
        'atelier-sud',
      );
    });
  });

  describe('invitation email limits', () => {
    beforeAll(async () => {
      await vi.waitFor(
        async () => {
          expect(await directoryOf(camille)).toMatchObject({ email_verified: true });
        },
        { timeout: 15_000 },
      );
    });
    // Decision 1 of the P2b security follow-ups: an invitation email goes out at most once an
    // hour, and an organization causes at most 100 of them in any 24 hours.

    let lyonId = '';
    let lilleId = '';
    let lucieInvitationId = '';

    /**
     * Addresses nobody was invited with yet.
     *
     * @param prefix - What tells this run of addresses from the others.
     * @param count - How many.
     * @returns The addresses.
     */
    function newcomers(prefix: string, count: number): string[] {
      return Array.from(
        { length: count },
        (_: unknown, index: number) => `${prefix}.${String(index)}@ateliernord.fr`,
      );
    }

    /**
     * Counts the rows of an organization in a table.
     *
     * @param table - `invitations` or `invitation_emails`.
     * @param organizationId - The organization.
     * @returns The count.
     */
    async function rowsOf(
      table: 'invitations' | 'invitation_emails',
      organizationId: string,
    ): Promise<number> {
      const rows = await stack.system<{ count: number }>(
        `select count(*)::int as count from ${table} where organization_id = $1`,
        [organizationId],
      );
      return rows[0]?.count ?? 0;
    }

    /**
     * Invites addresses to an organization of Camille as `member`.
     *
     * @param organizationId - The organization.
     * @param emails - The addresses.
     * @returns The response.
     */
    function invite(organizationId: string, emails: readonly string[]): Promise<Response> {
      return call('post', '/internal/v1/invitations', camille, organizationId, {
        emails,
        role: 'member',
      });
    }

    /**
     * Reads the `Retry-After` header of a response.
     *
     * @param response - The response.
     * @returns The seconds it asks to wait.
     */
    function retryAfter(response: Response): number {
      return Number(response.headers['retry-after']);
    }

    /** Ages earlier fixture sends so each group can exercise its own tenant budget. */
    async function expireSenderUsage(account: Account): Promise<void> {
      const client = await stack.migrator.connect();
      try {
        await client.query('begin');
        await client.query(`select set_config('app.invitation_sender_id', $1::uuid::text, true)`, [
          account.id,
        ]);
        await client.query(
          `update invitation_sender_emails set sent_at = now() - interval '25 hours' where sender_id = $1`,
          [account.id],
        );
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    }

    it('counts the addresses a creation invites against the allowance of the new organization', async () => {
      await expireSenderUsage(camille);
      const created = await call('post', '/internal/v1/organizations', camille, null, {
        name: 'Atelier Nord Lyon',
        inviteEmails: newcomers('lyon', 50),
      });

      expect(created.status).toBe(201);
      lyonId = (created.body as OrganizationCreated).organization.id;
      expect(await rowsOf('invitation_emails', lyonId)).toBe(50);

      const batch = await invite(lyonId, ['lyon.0@ateliernord.fr', ...newcomers('lyon-b', 49)]);
      const full = await invite(lyonId, newcomers('lyon-c', 2));

      expect(batch.status).toBe(200);
      expect(full.status).toBe(429);
      expect(full.body).toMatchObject({
        code: 'invitation.daily-limit-reached',
        details: { remaining: 1 },
      });
    });

    it('refuses the 101st email of 24 hours, with what remains and when the allowance grows', async () => {
      const last = await invite(lyonId, newcomers('lyon-c', 1));
      const invitations: number = await rowsOf('invitations', lyonId);
      const issued: number = await outboxCount('invitation.issued.v1', 'organizationId', lyonId);
      const oldest = await stack.system<{ sent_at: Date }>(
        'select min(sent_at) as sent_at from invitation_emails where organization_id = $1',
        [lyonId],
      );

      const refused = await invite(lyonId, ['lucie.bernard@ateliernord.fr']);

      expect(last.status).toBe(200);
      expect(refused.status).toBe(429);
      const nextAvailableAt: number = (oldest[0]?.sent_at.getTime() ?? 0) + 24 * 60 * 60_000;
      expect(refused.body).toEqual({
        type: 'about:blank',
        title: 'Too Many Requests',
        status: 429,
        code: 'invitation.daily-limit-reached',
        details: { remaining: 0, nextAvailableAt: new Date(nextAvailableAt).toISOString() },
      });
      expect(retryAfter(refused)).toBeGreaterThan(86_000);
      expect(retryAfter(refused)).toBeLessThanOrEqual(86_400);
      expect(await rowsOf('invitations', lyonId)).toBe(invitations);
      expect(await rowsOf('invitation_emails', lyonId)).toBe(100);
      expect(await outboxCount('invitation.issued.v1', 'organizationId', lyonId)).toBe(issued);
    });

    it('never refuses a batch of members and pending invitations, which sends nothing', async () => {
      const batch = await invite(lyonId, [camille.email, 'lyon.1@ateliernord.fr']);

      expect(batch.status).toBe(200);
      expect((batch.body as InvitationBatchResult).invitations.map((item) => item.outcome)).toEqual(
        ['already-member', 'already-invited'],
      );
    });

    it('takes one email of the allowance for a resend, refused with none left', async () => {
      const invitation = (await invite(lyonId, ['lyon.2@ateliernord.fr']))
        .body as InvitationBatchResult;
      const invitationId: string = invitation.invitations[0]?.invitationId ?? '';
      await stack.system(
        `update invitations set sent_at = sent_at - interval '2 hours' where id = $1`,
        [invitationId],
      );

      const resent = await call(
        'post',
        `/internal/v1/invitations/${invitationId}/resend`,
        camille,
        lyonId,
        {},
      );

      expect(resent.status).toBe(429);
      expect(resent.body).toMatchObject({
        code: 'invitation.daily-limit-reached',
        details: { remaining: 0 },
      });
      expect(retryAfter(resent)).toBeGreaterThan(86_000);
      expect(await outboxCount('invitation.issued.v1', 'invitationId', invitationId)).toBe(1);
      expect(await rowsOf('invitation_emails', lyonId)).toBe(100);
      const stored = await stack.system<{ version: number }>(
        'select version from invitations where id = $1',
        [invitationId],
      );
      expect(stored).toEqual([{ version: 1 }]);
    });

    it('grows the allowance again once the oldest emails leave the 24 hours, and forgets them', async () => {
      await expireSenderUsage(camille);
      await stack.system(
        `update invitation_emails set sent_at = sent_at - interval '1 day 1 minute'
          where organization_id = $1
            and sent_at = (select min(sent_at) from invitation_emails where organization_id = $1)`,
        [lyonId],
      );

      const batch = await invite(lyonId, ['lucie.bernard@ateliernord.fr']);

      expect(batch.status).toBe(200);
      expect(await rowsOf('invitation_emails', lyonId)).toBe(51);
      const stale = await stack.system<{ count: number }>(
        `select count(*)::int as count from invitation_emails
          where organization_id = $1 and sent_at <= now() - interval '1 day'`,
        [lyonId],
      );
      expect(stale).toEqual([{ count: 0 }]);
    });

    it('refuses a resend within the hour of the last sending, with when it becomes possible', async () => {
      await expireSenderUsage(camille);
      const created = await call('post', '/internal/v1/organizations', camille, null, {
        name: 'Atelier Nord Lille',
      });
      lilleId = (created.body as OrganizationCreated).organization.id;
      const batch = await invite(lilleId, ['lucie.bernard@ateliernord.fr']);
      lucieInvitationId = (batch.body as InvitationBatchResult).invitations[0]?.invitationId ?? '';
      const sent = await stack.system<{ sent_at: Date }>(
        'select sent_at from invitations where id = $1',
        [lucieInvitationId],
      );

      const resent = await call(
        'post',
        `/internal/v1/invitations/${lucieInvitationId}/resend`,
        camille,
        lilleId,
        {},
      );

      expect(resent.status).toBe(429);
      const resendAvailableAt: number = (sent[0]?.sent_at.getTime() ?? 0) + 60 * 60_000;
      expect(resent.body).toEqual({
        type: 'about:blank',
        title: 'Too Many Requests',
        status: 429,
        code: 'invitation.resend-throttled',
        details: { resendAvailableAt: new Date(resendAvailableAt).toISOString() },
      });
      expect(retryAfter(resent)).toBeGreaterThan(3_500);
      expect(retryAfter(resent)).toBeLessThanOrEqual(3_600);
      const listed = await call('get', '/internal/v1/invitations', camille, lilleId);
      expect((listed.body as InvitationPage).items[0]).toMatchObject({
        id: lucieInvitationId,
        version: 1,
      });
      expect(await rowsOf('invitation_emails', lilleId)).toBe(1);
      expect(await outboxCount('invitation.issued.v1', 'invitationId', lucieInvitationId)).toBe(1);
    });

    it('resends once the hour of the last sending is over, and counts that email', async () => {
      await stack.system(
        `update invitations set sent_at = sent_at - interval '61 minutes' where id = $1`,
        [lucieInvitationId],
      );

      const resent = await call(
        'post',
        `/internal/v1/invitations/${lucieInvitationId}/resend`,
        camille,
        lilleId,
        {},
      );
      const again = await call(
        'post',
        `/internal/v1/invitations/${lucieInvitationId}/resend`,
        camille,
        lilleId,
        {},
      );

      expect(resent.status).toBe(200);
      expect(resent.body).toMatchObject({ id: lucieInvitationId, version: 2 });
      expect(again.status).toBe(429);
      expect(again.body).toMatchObject({
        code: 'invitation.resend-throttled',
        details: { resendAvailableAt: expect.any(String) as string },
      });
      expect(await rowsOf('invitation_emails', lilleId)).toBe(2);
      await published(
        'invitation.issued.v1',
        (event) => event.invitationId === lucieInvitationId && event.version === 2,
      );
    });

    it('lets exactly one of two concurrent batches through when together they exceed the allowance', async () => {
      await invite(lilleId, newcomers('lille', 50));
      await invite(lilleId, newcomers('lille-b', 8));
      expect(await rowsOf('invitation_emails', lilleId)).toBe(60);

      const [first, second] = await Promise.all([
        invite(lilleId, newcomers('lille-c', 30)),
        invite(lilleId, newcomers('lille-d', 30)),
      ]);

      expect([first.status, second.status].sort()).toEqual([200, 429]);
      const refused: Response = first.status === 429 ? first : second;
      expect(refused.body).toMatchObject({
        code: 'invitation.daily-limit-reached',
        details: { remaining: 10 },
      });
      expect(await rowsOf('invitation_emails', lilleId)).toBe(90);
      expect(await rowsOf('invitations', lilleId)).toBe(89);
    });

    it('refuses as a whole a batch that needs more emails than remain, writing nothing', async () => {
      await invite(lilleId, newcomers('lille-e', 5));
      const invitations: number = await rowsOf('invitations', lilleId);
      const issued: number = await outboxCount('invitation.issued.v1', 'organizationId', lilleId);

      const refused = await invite(lilleId, [
        'lucie.bernard@ateliernord.fr',
        ...newcomers('lille-f', 6),
      ]);
      const fits = await invite(lilleId, [
        'lucie.bernard@ateliernord.fr',
        ...newcomers('lille-f', 5),
      ]);

      expect(refused.status).toBe(429);
      expect(refused.body).toMatchObject({
        code: 'invitation.daily-limit-reached',
        details: { remaining: 5 },
      });
      expect(fits.status).toBe(200);
      expect(
        (fits.body as InvitationBatchResult).invitations.filter(
          (item) => item.outcome === 'invited',
        ),
      ).toHaveLength(5);
      expect(await rowsOf('invitations', lilleId)).toBe(invitations + 5);
      expect(await rowsOf('invitation_emails', lilleId)).toBe(100);
      expect(await outboxCount('invitation.issued.v1', 'organizationId', lilleId)).toBe(issued + 5);
    });

    it('applies the same sender allowance to a different organization and to creation', async () => {
      const empty = await call('post', '/internal/v1/organizations', camille, null, {
        name: 'Atelier Nord Marseille',
        inviteEmails: [camille.email],
      });
      expect(empty.status).toBe(201);
      const organizationId = (empty.body as OrganizationCreated).organization.id;
      expect((empty.body as OrganizationCreated).invitations).toMatchObject([
        { outcome: 'already-member' },
      ]);

      const batch = await invite(organizationId, newcomers('marseille', 1));
      expect(batch.status).toBe(429);
      expect(batch.body).toMatchObject({
        code: 'invitation.daily-limit-reached',
        details: { remaining: 0 },
      });
      expect(await rowsOf('invitation_emails', organizationId)).toBe(0);

      const name = 'Atelier Nord Nantes';
      const refusedCreation = await call('post', '/internal/v1/organizations', camille, null, {
        name,
        inviteEmails: newcomers('nantes', 1),
      });
      expect(refusedCreation.status).toBe(429);
      expect(refusedCreation.body).toMatchObject({ code: 'invitation.daily-limit-reached' });
      expect(await stack.system('select id from organizations where name = $1', [name])).toEqual(
        [],
      );
    });
  });

  it('publishes and clears a private logo with locked authorization and committed replay', async () => {
    await vi.waitFor(
      async () => {
        expect(await directoryOf(camille)).toMatchObject({ email_verified: true });
      },
      { timeout: 15_000 },
    );
    const create = await call('post', '/internal/v1/organizations', camille, null, {
      name: 'Organization Logo Fixture',
      teamSize: '6-20',
      primaryUse: 'product-engineering',
      inviteEmails: [],
    });
    expect(create.status).toBe(201);
    const organizationId = (create.body as OrganizationCreated).organization.id;
    const path = '/internal/v1/organization/logo';
    const uploads = `${path}/uploads`;
    const declaration = { contentType: 'image/png', sizeBytes: 512 };

    const anonymous = await call('post', uploads, null, null, declaration);
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers['cache-control']).toBe('no-store');
    const malformed = await call('post', uploads, camille, organizationId, '{', {
      'Content-Type': 'application/json',
    });
    expect(malformed.status).toBe(400);
    expect(malformed.headers['cache-control']).toBe('no-store');

    const reserved = await call('post', uploads, camille, organizationId, declaration, {
      'Idempotency-Key': 'example-logo-reservation',
    });
    expect(reserved.status).toBe(201);
    expect(reserved.headers['cache-control']).toBe('no-store');
    conforms(ReserveOrganizationLogoUploadInternalResponse, reserved);
    const { uploadId, expiresAt } = ReserveOrganizationLogoUploadInternalResponse.parse(
      reserved.body,
    );
    expect(reserved.headers.location).toBe(`${uploads}/${uploadId}`);
    const replayed = await call('post', uploads, camille, organizationId, declaration, {
      'Idempotency-Key': 'example-logo-reservation',
    });
    expect(replayed.status).toBe(201);
    expect(replayed.body).toEqual(reserved.body);

    const read = await call('get', `${uploads}/${uploadId}`, camille, organizationId, undefined, {
      'If-None-Match': '*',
    });
    expect(read.status).toBe(200);
    expect(read.headers['cache-control']).toBe('no-store');
    conforms(GetOrganizationLogoUploadStateInternalResponse, read);
    expect(read.body).toEqual({ uploadId, state: 'pending', expiresAt });
    const outsider = await call('get', `${uploads}/${uploadId}`, ines, organizationId);
    expect(outsider.status).toBe(404);
    expect(outsider.headers['cache-control']).toBe('no-store');

    const stale = await call(
      'put',
      path,
      camille,
      organizationId,
      { uploadId },
      {
        'If-Match': '"9"',
      },
    );
    expect(stale.status).toBe(412);
    expect(stale.headers['cache-control']).toBe('no-store');
    expect(stale.body).toMatchObject({
      code: 'request.version-mismatch',
      details: { version: 1 },
    });
    const append = vi
      .spyOn(app.get(OutboxWriter), 'append')
      .mockRejectedValueOnce(new Error('Simulated logo outbox failure.'));
    try {
      const failed = await call(
        'put',
        path,
        camille,
        organizationId,
        { uploadId },
        { 'If-Match': '"1"' },
      );
      expect(failed.status).toBe(500);
      expect(failed.headers['cache-control']).toBe('no-store');
    } finally {
      append.mockRestore();
    }
    const stillPending = await call('get', `${uploads}/${uploadId}`, camille, organizationId);
    expect(stillPending.body).toMatchObject({ uploadId, state: 'pending' });
    const unchanged = await call('get', '/internal/v1/organization', camille, organizationId);
    expect(unchanged.body).toMatchObject({ logoId: null, version: 1 });
    expect(
      await outboxCount('organization.logo-changed.v1', 'organizationId', organizationId),
    ).toBe(0);

    const written = await call(
      'put',
      path,
      camille,
      organizationId,
      { uploadId },
      {
        'If-Match': '"1"',
      },
    );
    expect(written.status).toBe(204);
    expect(written.headers.etag).toBe('"2"');
    expect(written.headers['cache-control']).toBe('no-store');
    const changed = await published(
      'organization.logo-changed.v1',
      (event) => event.assetId === uploadId,
    );
    expect(changed).toMatchObject({
      version: 1,
      organizationId,
      actor: { type: 'user', id: camille.id },
      assetId: uploadId,
      oldAssetId: null,
    });
    const profile = await call('get', '/internal/v1/organization', camille, organizationId);
    expect(profile.body).toMatchObject({ logoId: uploadId, version: 2 });

    const removed = await call('delete', path, camille, organizationId, undefined, {
      'If-Match': '"2"',
    });
    expect(removed.status).toBe(204);
    expect(removed.headers.etag).toBe('"3"');
    const retired = await published(
      'organization.logo-changed.v1',
      (event) => event.oldAssetId === uploadId,
    );
    expect(retired).toMatchObject({ version: 2, assetId: null });
    const committedReplay = await call(
      'put',
      path,
      camille,
      organizationId,
      { uploadId },
      {
        'If-Match': '"1"',
      },
    );
    expect(committedReplay.status).toBe(204);
    expect(committedReplay.headers.etag).toBe('"3"');
    const cleared = await call('get', '/internal/v1/organization', camille, organizationId);
    expect(cleared.body).toMatchObject({ logoId: null, version: 3 });
    expect(
      await outboxCount('organization.logo-changed.v1', 'organizationId', organizationId),
    ).toBe(2);
  });

  it('keeps a current address that became reserved and refuses moving to another one', async () => {
    await vi.waitFor(
      async () => {
        expect(await directoryOf(camille)).toMatchObject({ email_verified: true });
      },
      { timeout: 15_000 },
    );
    const create = await call('post', '/internal/v1/organizations', camille, null, {
      name: 'Studio Pivot',
    });
    expect(create.status).toBe(201);
    const organizationId = (create.body as OrganizationCreated).organization.id;
    await stack.system(`update organizations set slug = 'home' where id = $1`, [organizationId]);

    const kept = await call('patch', '/internal/v1/organization', camille, organizationId, {
      name: 'Studio Pivot Lyon',
      slug: 'home',
    });
    const unchanged = await call('patch', '/internal/v1/organization', camille, organizationId, {
      slug: 'home',
    });
    const moved = await call('patch', '/internal/v1/organization', camille, organizationId, {
      slug: 'login',
    });

    expect(kept.status).toBe(200);
    expect(kept.body).toMatchObject({ name: 'Studio Pivot Lyon', slug: 'home', version: 2 });
    expect(unchanged.status).toBe(200);
    expect(unchanged.body).toMatchObject({ slug: 'home', version: 2 });
    expect(moved.status).toBe(422);
    expect(moved.body).toMatchObject({
      code: 'organization.slug-reserved',
      details: { slug: 'login' },
    });
    expect(await outboxCount('organization.updated.v1', 'organizationId', organizationId)).toBe(1);
  });

  it('answers only the client errors each operation declares in the contract', () => {
    const declared: DeclaredErrors = DeclaredErrors.load();

    expect(errors.length).toBeGreaterThan(40);
    expect(errors.filter((error: SeenError) => !declared.declares(error))).toEqual([]);
  });
});
