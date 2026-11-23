import { generateKeyPairSync } from 'node:crypto';

import {
  CheckAutomationRecipientInternalResponse,
  GetBillingActiveSeatCountInternalResponse,
  ListBillingMembershipsInternalResponse,
  ListBillingOrganizationsInternalResponse,
  ListQuotaNotificationRecipientsInternalResponse,
  LookupQuotaNotificationRecipientsInternalResponse,
} from '@cadenway/contracts/validators/internal/organization-service';
import { InternalTokenSigner } from '@cadenway/nest-common';
import type { Ed25519PrivateJwk, Ed25519PublicJwk } from '@cadenway/nest-common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { newId, ServiceStack } from './support/service-stack.js';
import { DeclaredErrors } from './support/declared-errors.js';

function issuerKey(kid: string): {
  readonly publicJwk: Ed25519PublicJwk;
  readonly privateJwk: Ed25519PrivateJwk;
} {
  const { x, d } = generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' });
  if (x === undefined || d === undefined) throw new Error('Ed25519 test key is incomplete.');
  const publicJwk: Ed25519PublicJwk = { kty: 'OKP', crv: 'Ed25519', x, kid };
  return { publicJwk, privateJwk: { ...publicJwk, d } };
}

describe('signed Billing and quota notification authorities', () => {
  const organizationId = '019a7001-2b3c-7d4e-8f5a-6b7c8d9e0f12';
  const otherOrganizationId = '019a7002-2b3c-7d4e-8f5a-6b7c8d9e0f12';
  const ownerId = '019a7011-2b3c-7d4e-8f5a-6b7c8d9e0f12';
  const adminId = '019a7012-2b3c-7d4e-8f5a-6b7c8d9e0f12';
  const guestId = '019a7013-2b3c-7d4e-8f5a-6b7c8d9e0f12';
  const memberIds = [
    '019a7021-2b3c-7d4e-8f5a-6b7c8d9e0f12',
    '019a7022-2b3c-7d4e-8f5a-6b7c8d9e0f12',
    '019a7023-2b3c-7d4e-8f5a-6b7c8d9e0f12',
  ];
  const billingKey = issuerKey('billing-test');
  const notificationKey = issuerKey('notification-test');
  let stack: ServiceStack;
  let app: NestExpressApplication;
  let billing: InternalTokenSigner;
  let notification: InternalTokenSigner;

  const token = async (
    signer: InternalTokenSigner,
    actorId: string,
    tenant: string | null,
  ): Promise<string> =>
    `Bearer ${await signer.sign('organization-service', {
      actor: { type: 'system', id: actorId },
      organizationId: tenant,
    })}`;

  beforeAll(async () => {
    stack = await ServiceStack.start('billing-authority');
    vi.stubEnv('BILLING_SERVICE_INTERNAL_TOKEN_PUBLIC_JWKS', JSON.stringify(billingKey.publicJwk));
    vi.stubEnv(
      'NOTIFICATION_SERVICE_INTERNAL_TOKEN_PUBLIC_JWKS',
      JSON.stringify(notificationKey.publicJwk),
    );
    vi.stubEnv('BILLING_AUTHORITY_CURSOR_SECRET', Buffer.alloc(32, 7).toString('base64url'));
    app = await stack.startApplication();
    billing = await InternalTokenSigner.create({
      issuer: 'billing-service',
      privateJwk: billingKey.privateJwk,
    });
    notification = await InternalTokenSigner.create({
      issuer: 'notification-service',
      privateJwk: notificationKey.privateJwk,
    });
    await stack.system(
      `insert into organizations
       (id, name, name_key, slug, default_language, team_size, primary_use, owner_user_id)
       values ($1, 'Atelier Nord', 'atelier nord', 'atelier-nord', 'fr', '1-5', 'other', $3),
              ($2, 'Lumen', 'lumen', 'lumen', 'fr', '1-5', 'other', $4)`,
      [organizationId, otherOrganizationId, ownerId, newId()],
    );
    await stack.system(
      `insert into members (id, organization_id, user_id, role, joined_at, version, removed_at)
       values ($1, $4, $5, 'owner', now(), 1, null),
              ($2, $4, $6, 'admin', now(), 2, null),
              ($3, $4, $7, 'guest', now(), 3, now())`,
      [...memberIds, organizationId, ownerId, adminId, guestId],
    );
  });

  afterAll(async () => {
    await stack.stop();
  });

  it('keeps roster and membership pages bound to their tenant and retained source versions', async () => {
    const global = await token(billing, 'billing-service', null);
    const tenant = await token(billing, 'billing-service', organizationId);
    const otherTenant = await token(billing, 'billing-service', otherOrganizationId);
    const roster = await request(app.getHttpServer())
      .get('/internal/v1/billing-organizations')
      .query({ limit: 1 })
      .set('Authorization', global);
    expect(roster.status).toBe(200);
    expect(roster.headers['cache-control']).toBe('private, no-store');
    const rosterBody = ListBillingOrganizationsInternalResponse.parse(roster.body as unknown);
    expect(rosterBody.items).toEqual([organizationId]);
    expect(rosterBody.nextCursor).toEqual(expect.any(String));

    const first = await request(app.getHttpServer())
      .get('/internal/v1/billing-memberships')
      .query({ limit: 1 })
      .set('Authorization', tenant);
    expect(first.status).toBe(200);
    const firstBody = ListBillingMembershipsInternalResponse.parse(first.body as unknown);
    expect(firstBody.items).toEqual([
      { memberId: memberIds[0], state: 'active', role: 'owner', version: 1 },
    ]);
    expect(firstBody.nextCursor).toEqual(expect.any(String));

    const foreignCursor = await request(app.getHttpServer())
      .get('/internal/v1/billing-memberships')
      .query({ cursor: firstBody.nextCursor, limit: 1 })
      .set('Authorization', otherTenant);
    expect(foreignCursor.status).toBe(400);
    expect(foreignCursor.headers['cache-control']).toBe('private, no-store');

    const wrongOperation = await request(app.getHttpServer())
      .get('/internal/v1/billing-memberships')
      .query({ cursor: rosterBody.nextCursor, limit: 1 })
      .set('Authorization', tenant);
    expect(wrongOperation.status).toBe(400);
    expect(wrongOperation.headers['cache-control']).toBe('private, no-store');

    const remaining = await request(app.getHttpServer())
      .get('/internal/v1/billing-memberships')
      .query({ cursor: firstBody.nextCursor, limit: 2 })
      .set('Authorization', tenant);
    expect(remaining.status).toBe(200);
    expect(ListBillingMembershipsInternalResponse.safeParse(remaining.body).success).toBe(true);
    expect(remaining.body).toEqual({
      items: [
        { memberId: memberIds[1], state: 'active', role: 'admin', version: 2 },
        { memberId: memberIds[2], state: 'removed', version: 3 },
      ],
      nextCursor: null,
    });
  });

  it('rechecks owner and administrator roles before quota delivery', async () => {
    const authorization = await token(notification, 'notification-service', organizationId);
    const list = await request(app.getHttpServer())
      .get('/internal/v1/quota-notification-recipients')
      .query({ limit: 1 })
      .set('Authorization', authorization);
    expect(list.status).toBe(200);
    expect(list.headers['cache-control']).toBe('private, no-store');
    const listBody = ListQuotaNotificationRecipientsInternalResponse.parse(list.body as unknown);
    expect(listBody.items).toEqual([ownerId]);
    expect(listBody.nextCursor).toEqual(expect.any(String));

    await stack.system("update members set role = 'member', version = 3 where id = $1", [
      memberIds[1],
    ]);
    const lookup = await request(app.getHttpServer())
      .post('/internal/v1/quota-notification-recipients/lookup')
      .set('Authorization', authorization)
      .send({ userIds: [ownerId, adminId, guestId] });
    expect(lookup.status).toBe(200);
    expect(lookup.headers['cache-control']).toBe('private, no-store');
    const lookupBody = LookupQuotaNotificationRecipientsInternalResponse.parse(
      lookup.body as unknown,
    );
    expect(lookupBody.items).toEqual([ownerId]);
  });

  it('counts current seats in one signed read after more than a page of membership history', async () => {
    await stack.system(
      `insert into members (organization_id, user_id, role, joined_at, removed_at)
       select $1::uuid, uuidv7(), 'guest', now(), null::timestamptz from generate_series(1, 56)
       union all
       select $1::uuid, uuidv7(), 'member', now(), now() from generate_series(1, 55)
       union all
       select id, owner_user_id, 'owner', now(), null::timestamptz
         from organizations where id = $1::uuid`,
      [otherOrganizationId],
    );
    const tenant = await token(billing, 'billing-service', otherOrganizationId);
    const route = '/internal/v1/billing-active-seats';

    const counted = await request(app.getHttpServer())
      .get(route)
      .set('Authorization', tenant)
      .set('If-None-Match', '*');
    expect(counted.status).toBe(200);
    expect(counted.headers['cache-control']).toBe('private, no-store');
    expect(GetBillingActiveSeatCountInternalResponse.parse(counted.body as unknown)).toEqual({
      activeSeatCount: 1,
    });

    const wrongIssuer = await token(notification, 'notification-service', otherOrganizationId);
    const unscoped = await token(billing, 'billing-service', null);
    const unknownTenant = await token(billing, 'billing-service', newId());
    const responses = await Promise.all([
      request(app.getHttpServer()).get(route),
      request(app.getHttpServer()).get(route).set('Authorization', wrongIssuer),
      request(app.getHttpServer()).get(route).set('Authorization', unscoped),
      request(app.getHttpServer()).get(route).set('Authorization', unknownTenant),
    ]);
    expect(responses.map(({ status }) => status)).toEqual([401, 403, 403, 404]);
    for (const response of responses) {
      expect(response.headers['cache-control']).toBe('private, no-store');
    }
  });

  it('refuses missing, foreign and incorrectly scoped authorities without caching errors', async () => {
    const billingTenant = await token(billing, 'billing-service', organizationId);
    const billingGlobal = await token(billing, 'billing-service', null);
    const wrongActor = await token(billing, 'other-service', organizationId);
    const notificationTenant = await token(notification, 'notification-service', organizationId);
    const absent = await token(notification, 'notification-service', newId());
    const responses = await Promise.all([
      request(app.getHttpServer()).get('/internal/v1/billing-memberships'),
      request(app.getHttpServer())
        .get('/internal/v1/billing-memberships')
        .set('Authorization', notificationTenant),
      request(app.getHttpServer())
        .get('/internal/v1/billing-memberships')
        .set('Authorization', wrongActor),
      request(app.getHttpServer())
        .get('/internal/v1/billing-memberships')
        .set('Authorization', billingGlobal),
      request(app.getHttpServer())
        .get('/internal/v1/billing-organizations')
        .set('Authorization', billingTenant),
      request(app.getHttpServer())
        .get('/internal/v1/quota-notification-recipients')
        .set('Authorization', absent),
    ]);
    expect(responses.map(({ status }) => status)).toEqual([401, 403, 403, 403, 403, 404]);
    for (const response of responses) {
      expect(response.headers['cache-control']).toBe('private, no-store');
    }
  });

  it('checks Automation recipients against current membership and the signed tenant', async () => {
    const activeAdminId = '019a7031-2b3c-7d4e-8f5a-6b7c8d9e0f12';
    const activeGuestId = '019a7032-2b3c-7d4e-8f5a-6b7c8d9e0f12';
    const removedId = '019a7033-2b3c-7d4e-8f5a-6b7c8d9e0f12';
    const foreignId = '019a7034-2b3c-7d4e-8f5a-6b7c8d9e0f12';
    const invitedId = '019a7035-2b3c-7d4e-8f5a-6b7c8d9e0f12';
    const activeAdminMemberId = newId();
    await stack.system(
      `insert into members (id, organization_id, user_id, role, joined_at, removed_at)
       values ($1, $5, $6, 'admin', now(), null),
              ($2, $5, $7, 'guest', now(), null),
              ($3, $5, $8, 'member', now(), now()),
              ($4, $9, $10, 'member', now(), null)`,
      [
        activeAdminMemberId,
        newId(),
        newId(),
        newId(),
        organizationId,
        activeAdminId,
        activeGuestId,
        removedId,
        otherOrganizationId,
        foreignId,
      ],
    );
    await stack.system(
      `insert into directory_users (user_id, email, email_verified)
       values ($1, 'pending@atelier-nord.fr', true)`,
      [invitedId],
    );
    await stack.system(
      `insert into invitations
       (id, organization_id, email, role, invited_by_user_id, sent_at, expires_at)
       values ($1, $2, 'pending@atelier-nord.fr', 'member', $3, now(), now() + interval '7 days')`,
      [newId(), organizationId, ownerId],
    );
    const path = '/internal/v1/automation-recipients/check';
    const owner = await stack.bearer(ownerId, organizationId);
    const admin = await stack.bearer(activeAdminId, organizationId);
    const check = (authorization: string, userId: string) =>
      request(app.getHttpServer()).post(path).set('Authorization', authorization).send({ userId });

    for (const authorization of [owner, admin]) {
      for (const [userId, eligible] of [
        [activeGuestId, true],
        [ownerId, true],
        [removedId, false],
        [foreignId, false],
        [invitedId, false],
      ] as const) {
        const response = await check(authorization, userId);
        expect(response.status).toBe(200);
        expect(response.headers['cache-control']).toBe('private, no-store');
        expect(CheckAutomationRecipientInternalResponse.parse(response.body as unknown)).toEqual({
          eligible,
        });
      }
    }

    await stack.system("update members set role = 'member' where id = $1", [activeAdminMemberId]);
    const demoted = await check(admin, activeGuestId);
    expect(demoted.status).toBe(403);
    expect(demoted.body).toMatchObject({ code: 'organization.role-forbidden' });

    await stack.system('update members set removed_at = now() where id = $1', [
      activeAdminMemberId,
    ]);
    const removed = await check(admin, activeGuestId);
    expect(removed.status).toBe(404);
    expect(removed.body).toMatchObject({ code: 'organization.not-found' });

    const malformed = await check(owner, 'not-a-uuid');
    const missing = await request(app.getHttpServer()).post(path).send({ userId: activeGuestId });
    expect(malformed.status).toBe(400);
    expect(missing.status).toBe(401);
    const declared = DeclaredErrors.load();
    for (const response of [demoted, removed, malformed, missing]) {
      expect(response.headers['cache-control']).toBe('private, no-store');
      const body = response.body as { readonly code: string };
      expect(
        declared.declares({ method: 'post', path, status: response.status, code: body.code }),
      ).toBe(true);
    }
  });
});
