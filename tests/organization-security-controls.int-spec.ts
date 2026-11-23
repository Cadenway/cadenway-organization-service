import { generateKeyPairSync } from 'node:crypto';

import { InternalTokenSigner, runWithOrganizationContext } from '@cadenway/nest-common';
import type { Ed25519PublicJwk } from '@cadenway/nest-common';
import { SystemTransactionRunner, TenantTransactionRunner } from '@cadenway/nest-common/database';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Invitation } from '../src/modules/organizations/domain/aggregates/invitation/invitation.aggregate.js';
import { EmailAddress } from '../src/modules/organizations/domain/value-objects/email/email-address.value-object.js';
import { DrizzleDirectoryRepository } from '../src/modules/organizations/infrastructure/persistence/drizzle/repositories/directory/drizzle-directory.repository.js';
import { DrizzleInvitationEmailRepository } from '../src/modules/organizations/infrastructure/persistence/drizzle/repositories/invitations/drizzle-invitation-email.repository.js';
import { DrizzleInvitationRepository } from '../src/modules/organizations/infrastructure/persistence/drizzle/repositories/invitations/drizzle-invitation.repository.js';
import { DrizzleMemberRepository } from '../src/modules/organizations/infrastructure/persistence/drizzle/repositories/members/drizzle-member.repository.js';
import { DrizzleOrganizationRepository } from '../src/modules/organizations/infrastructure/persistence/drizzle/repositories/organizations/drizzle-organization.repository.js';
import { newId, ServiceStack } from './support/service-stack.js';

describe('Organization security transaction controls', () => {
  const firstOrg = newId();
  const secondOrg = newId();
  const owner = newId();
  const admin = newId();
  const ownerMembership = newId();
  const adminMembership = newId();
  let stack: ServiceStack;
  let tenant: TenantTransactionRunner;

  beforeAll(async () => {
    stack = await ServiceStack.start('security-transaction-controls');
    tenant = new TenantTransactionRunner(stack.migrator);
    await stack.system(
      `insert into organizations
        (id, name, name_key, slug, default_language, team_size, primary_use, owner_user_id)
       values ($1, 'Atelier Nord', 'atelier nord', 'atelier-nord', 'fr', '1-5', 'other', $3),
              ($2, 'Coopérative Lumen', 'cooperative lumen', 'cooperative-lumen', 'fr', '1-5', 'other', $3)`,
      [firstOrg, secondOrg, owner],
    );
    await stack.system(
      `insert into members (id, organization_id, user_id, role, joined_at)
       values ($1, $3, $4, 'owner', now()), ($2, $3, $5, 'admin', now()),
              (uuidv7(), $6, $4, 'owner', now())`,
      [ownerMembership, adminMembership, firstOrg, owner, admin, secondOrg],
    );
  });

  afterAll(async () => {
    await stack.stop();
  });

  it('counts only active seats in the current tenant after more than one page of history', async () => {
    const organizationId = newId();
    const historicalOwner = newId();
    await stack.system(
      `insert into organizations
        (id, name, name_key, slug, default_language, team_size, primary_use, owner_user_id)
       values ($1, 'Atelier Histoires', 'atelier histoires', 'atelier-histoires', 'fr', '1-5', 'other', $2)`,
      [organizationId, historicalOwner],
    );
    await stack.system(
      `insert into members (organization_id, user_id, role, joined_at, removed_at)
       select $1::uuid, uuidv7(), 'guest', now(), null::timestamptz from generate_series(1, 56)
       union all
       select $1::uuid, uuidv7(), 'member', now(), now() from generate_series(1, 55)
       union all
       select $1::uuid, $2::uuid, 'owner', now(), null::timestamptz`,
      [organizationId, historicalOwner],
    );

    await runWithOrganizationContext(
      { organizationId, actor: { type: 'system', id: 'billing-service' }, role: null, scopes: [] },
      () =>
        tenant.run(async ({ db }) => {
          const organizations = new DrizzleOrganizationRepository(db);
          await expect(organizations.countActiveSeats(organizationId)).resolves.toBe(1);
          await expect(organizations.countActiveSeats(firstOrg)).resolves.toBeNull();
        }),
    );
  });

  it('accepts only the unscoped Identity signer, remembers the attempt and refuses an owner', async () => {
    const key = generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' });
    if (key.x === undefined || key.d === undefined) throw new Error('Missing test key material.');
    const publicJwk: Ed25519PublicJwk = {
      kty: 'OKP',
      crv: 'Ed25519',
      x: key.x,
      kid: 'test-account-deletion-authority',
    };
    const app = await stack.startApplication({ 'identity-service': [publicJwk] });
    const signer = await InternalTokenSigner.create({
      issuer: 'identity-service',
      privateJwk: { ...publicJwk, d: key.d },
    });
    const authorization = async (organizationId: string | null): Promise<string> =>
      `Bearer ${await signer.sign('organization-service', {
        actor: { type: 'system', id: 'identity-service' },
        organizationId,
      })}`;
    const adapter = request(app.getHttpServer());
    const account = newId();
    const attempt = '019a6c30-7a8b-7c9d-8e0f-1a2b3c4d8e91';
    const differentAttempt = '019a6c30-7a8b-7c9d-8e0f-1a2b3c4d8e92';
    const route = (userId: string, id = attempt): string =>
      `/internal/v1/users/${userId}/account-deletion-reservations/${id}`;
    await stack.system('insert into directory_users (user_id) values ($1), ($2)', [account, owner]);
    const bearer = await authorization(null);

    const wrongIssuer = await adapter
      .put(route(account))
      .set('Authorization', await stack.bearer(owner, firstOrg));
    expect(wrongIssuer.status).toBe(403);
    expect(wrongIssuer.headers['cache-control']).toBe('private, no-store');
    const scoped = await adapter
      .put(route(account))
      .set('Authorization', await authorization(firstOrg));
    expect(scoped.status).toBe(403);
    expect(scoped.body).toMatchObject({ code: 'auth.organization-not-allowed' });
    const created = await adapter.put(route(account)).set('Authorization', bearer);
    expect(created.status).toBe(201);
    expect(created.headers['cache-control']).toBe('private, no-store');
    expect(created.text).toBe('');
    await adapter.put(route(account)).set('Authorization', bearer).expect(204);
    const conflict = await adapter
      .put(route(account, differentAttempt))
      .set('Authorization', bearer);
    expect(conflict.status).toBe(409);
    expect(conflict.body).toMatchObject({ code: 'account.deletion-reservation-conflict' });
    const refusesOwner = await adapter.put(route(owner)).set('Authorization', bearer);
    expect(refusesOwner.status).toBe(409);
    expect(refusesOwner.body).toMatchObject({
      code: 'account.organization-owner',
      details: { organizationIds: [firstOrg, secondOrg].sort() },
    });
  });

  it('returns both current tenant memberships and takes both row locks before the decision', async () => {
    await runWithOrganizationContext(
      { organizationId: firstOrg, actor: { type: 'user', id: owner }, role: null, scopes: [] },
      () =>
        tenant.run(async ({ db }) => {
          const members = new DrizzleMemberRepository(db);
          const locked = await members.lockActorAndTarget(firstOrg, owner, adminMembership);
          const ids = locked.map((member) => member.id);
          expect(ids).toEqual([ownerMembership, adminMembership].sort());
          await expect(
            stack.system(
              `select id from members where organization_id = $1 and id = any ($2::uuid[])
                order by id for update skip locked`,
              [firstOrg, ids],
            ),
          ).resolves.toEqual([]);
          await expect(
            members.lockActorAndTarget(firstOrg, owner, ownerMembership),
          ).resolves.toHaveLength(1);
        }),
    );
  });

  it('holds the current invitation sender role against updates until commit', async () => {
    await runWithOrganizationContext(
      { organizationId: firstOrg, actor: { type: 'user', id: admin }, role: null, scopes: [] },
      () =>
        tenant.run(async ({ db }) => {
          const members = new DrizzleMemberRepository(db);
          const sender = await members.findActiveOfUser(firstOrg, admin, 'share');
          expect(sender?.role).toBe('admin');
          await expect(
            stack.system(
              'select id from members where organization_id = $1 and id = $2 for no key update skip locked',
              [firstOrg, adminMembership],
            ),
          ).resolves.toEqual([]);
        }),
    );
  });

  it('preserves a durable directory reservation across reads until the deletion commits', async () => {
    const system = new SystemTransactionRunner(stack.migrator);
    const account = newId();
    const attempt = '019a6c30-7a8b-7c9d-8e0f-1a2b3c4d8e91';
    await stack.system('insert into directory_users (user_id) values ($1)', [account]);

    await system.run(async ({ db }) => {
      const directory = new DrizzleDirectoryRepository(db);
      const members = new DrizzleMemberRepository(db);
      await expect(members.listOwnedOrganizationIds(owner)).resolves.toEqual(
        [firstOrg, secondOrg].sort(),
      );
      await expect(members.listOwnedOrganizationIds(account)).resolves.toEqual([]);
      await expect(directory.findForUpdate(account)).resolves.not.toBeNull();
      await directory.reserveDeletion(account, attempt);
    });

    await system.run(async ({ db }) => {
      const directory = new DrizzleDirectoryRepository(db);
      const entry = await directory.findForShare(account);
      expect(entry?.isDeleted).toBe(false);
      await expect(directory.findDeletionAttempt(account)).resolves.toBe(attempt);
    });

    await system.run(async ({ db }) => {
      const directory = new DrizzleDirectoryRepository(db);
      const entry = await directory.lock(account);
      await directory.save(entry.applyDeletion(1));
    });
    await system.run(async ({ db }) => {
      const directory = new DrizzleDirectoryRepository(db);
      await expect(directory.findDeletionAttempt(account)).resolves.toBeNull();
    });
  });

  it('serializes one sender across two tenant transactions and clears the ledger scope after commit', async () => {
    const now = new Date('2026-11-22T09:00:00Z');
    const windowStart = new Date('2026-11-21T09:00:00Z');
    let started = (): void => undefined;
    let commit = (): void => undefined;
    const firstLocked = new Promise<void>((resolve) => {
      started = resolve;
    });
    const mayCommit = new Promise<void>((resolve) => {
      commit = resolve;
    });
    const first = runWithOrganizationContext(
      { organizationId: firstOrg, actor: { type: 'user', id: owner }, role: null, scopes: [] },
      () =>
        tenant.run(async ({ db }) => {
          const emails = new DrizzleInvitationEmailRepository(db);
          await expect(emails.lockSenderUsage(owner, windowStart)).resolves.toMatchObject({
            count: 0,
          });
          const invitation = await new DrizzleInvitationRepository(db).insertPending(
            Invitation.issue(
              firstOrg,
              EmailAddress.parse('ines@ateliernord.fr'),
              'member',
              owner,
              now,
            ),
          );
          if (invitation === null) throw new Error('Invitation fixture was already present.');
          await emails.record(invitation, owner);
          started();
          await mayCommit;
        }),
    );
    await Promise.race([firstLocked, first]);
    let announceSecond = (): void => undefined;
    let secondFinished = false;
    const secondStarted = new Promise<void>((resolve) => {
      announceSecond = resolve;
    });
    const second = runWithOrganizationContext(
      { organizationId: secondOrg, actor: { type: 'user', id: owner }, role: null, scopes: [] },
      () =>
        tenant.run(async ({ db }) => {
          announceSecond();
          const usage = await new DrizzleInvitationEmailRepository(db).lockSenderUsage(
            owner,
            windowStart,
          );
          secondFinished = true;
          return usage;
        }),
    );
    try {
      await Promise.race([secondStarted, second]);
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
      expect(secondFinished).toBe(false);
    } finally {
      commit();
      await first;
    }
    await expect(second).resolves.toEqual({ count: 1, oldestSentAt: now });
    await expect(stack.system('select id from invitation_sender_emails')).resolves.toEqual([]);
  });
});
