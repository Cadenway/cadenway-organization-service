import { execFileSync } from 'node:child_process';

import { SystemTransactionRunner } from '@cadenway/nest-common/database';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DrizzleMembershipExport } from '../src/modules/organizations/infrastructure/persistence/drizzle/repositories/members/drizzle-membership-export.repository.js';

const project = `cadenway-organization-membership-export-${String(process.pid)}`;
const organizationId = '01938f6e-6d1a-7c3e-9a51-2f0c4b8d7e10';
const otherOrganizationId = '01938f6e-6d1a-7c3e-9a51-2f0c4b8d7e11';
const laterMembershipId = '01938f6e-9000-7000-8000-000000000901';
const terminalMembershipId = '01938f6e-9000-7000-8000-000000000501';

function compose(...args: string[]): string {
  return execFileSync('docker', ['compose', '-p', project, '-f', 'compose.dev.yaml', ...args], {
    env: { ...process.env, DEV_POSTGRES_PORT: '0' },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

describe('Organization membership export', () => {
  let app: pg.Pool | undefined;
  let admin: pg.Pool | undefined;

  beforeAll(async () => {
    compose('up', '-d', '--wait', 'postgres');
    const port = compose('port', 'postgres', '5432').trim().split(':').at(-1) ?? '';
    const migrationUrl = `postgres://organization_migrator:organization_migrator@127.0.0.1:${port}/organization`;
    const migrator = new pg.Pool({ connectionString: migrationUrl });
    try {
      await migrate(drizzle({ client: migrator }), { migrationsFolder: 'migrations' });
    } finally {
      await migrator.end();
    }
    app = new pg.Pool({
      connectionString: `postgres://organization_app:organization_app@127.0.0.1:${port}/organization`,
    });
    admin = new pg.Pool({
      connectionString: `postgres://postgres:postgres@127.0.0.1:${port}/organization`,
    });
    await admin.query(
      `insert into organizations (id, name, name_key, slug, default_language, team_size, primary_use, owner_user_id)
       values ($1, 'Atelier Nord', 'atelier nord', 'atelier-nord', 'fr', '1-5', 'other', uuidv7()),
              ($2, 'Studio Sud', 'studio sud', 'studio-sud', 'fr', '1-5', 'other', uuidv7())`,
      [organizationId, otherOrganizationId],
    );
    await admin.query(
      `insert into members (id, organization_id, user_id, role, joined_at, version, removed_at)
       select ('01938f6e-9000-7000-8000-' || lpad(i::text, 12, '0'))::uuid,
              case when i = 501 then $2::uuid else $1::uuid end,
              uuidv7(), 'member', now(),
              case when i = 501 then 2 else 1 end,
              case when i = 501 then '2026-06-01'::timestamptz end
        from generate_series(1, 501) as members(i)`,
      [organizationId, otherOrganizationId],
    );
  });

  afterAll(async () => {
    await app?.end();
    await admin?.end();
    compose('down', '--volumes');
  });

  it('reads all pages from one read-only view even when a membership is added between pages', async () => {
    if (app === undefined || admin === undefined) throw new Error('PostgreSQL was not started.');
    const adminDb = admin;
    const exportMemberships = new DrizzleMembershipExport(new SystemTransactionRunner(app));
    const lengths: number[] = [];
    await expect(
      exportMemberships.export(async (page) => {
        lengths.push(page.length);
        if (lengths.length === 1) {
          await adminDb.query(
            `insert into members (id, organization_id, user_id, role, joined_at)
             values ($1, $2, uuidv7(), 'guest', now())`,
            [laterMembershipId, otherOrganizationId],
          );
          return;
        }
        expect(page).toEqual([
          expect.objectContaining({
            organizationId: otherOrganizationId,
            memberId: terminalMembershipId,
            version: 2,
            removedAt: new Date('2026-06-01T00:00:00.000Z'),
          }),
        ]);
      }),
    ).resolves.toBe(501);
    expect(lengths).toEqual([500, 1]);
  });
});
