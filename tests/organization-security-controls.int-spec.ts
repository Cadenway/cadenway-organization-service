import { runWithOrganizationContext } from '@cadenway/nest-common';
import { SystemTransactionRunner, TenantTransactionRunner } from '@cadenway/nest-common/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Invitation } from '../src/modules/organizations/domain/aggregates/invitation/invitation.aggregate.js';
import { EmailAddress } from '../src/modules/organizations/domain/value-objects/email/email-address.value-object.js';
import { DrizzleDirectoryRepository } from '../src/modules/organizations/infrastructure/persistence/drizzle/repositories/directory/drizzle-directory.repository.js';
import { DrizzleInvitationEmailRepository } from '../src/modules/organizations/infrastructure/persistence/drizzle/repositories/invitations/drizzle-invitation-email.repository.js';
import { DrizzleInvitationRepository } from '../src/modules/organizations/infrastructure/persistence/drizzle/repositories/invitations/drizzle-invitation.repository.js';
import { DrizzleMemberRepository } from '../src/modules/organizations/infrastructure/persistence/drizzle/repositories/members/drizzle-member.repository.js';
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
