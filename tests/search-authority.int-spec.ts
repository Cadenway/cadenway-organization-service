import { generateKeyPairSync } from 'node:crypto';

import {
  GetSearchMembershipInternalResponse,
  ListSearchOrganizationsInternalResponse,
} from '@cadenway/contracts/validators/internal/organization-service';
import type { Ed25519PublicJwk, InternalTokenClaims } from '@cadenway/nest-common';
import { InternalTokenSigner } from '@cadenway/nest-common';
import { SystemTransactionRunner } from '@cadenway/nest-common/database';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { ListSearchOrganizations } from '../src/modules/organizations/application/use-cases/queries/search/list-search-organizations/list-search-organizations.use-case.js';
import { DrizzleSearchOrganizationsReader } from '../src/modules/organizations/infrastructure/persistence/drizzle/repositories/search/drizzle-search-organizations.repository.js';
import { SearchOrganizationCursor } from '../src/modules/organizations/presentation/http/mappers/search/search-organization-cursor.mapper.js';
import { newId, ServiceStack } from './support/service-stack.js';

describe('Organization Search authority persistence', () => {
  const firstId = '019a7001-2b3c-4d4e-8f5a-6b7c8d9e0f12';
  const secondId = '019a7002-2b3c-7d4e-8f5a-6b7c8d9e0f12';
  const thirdId = '019a7003-2b3c-4d4e-8f5a-6b7c8d9e0f12';
  const newOrganizationId = '019a7004-2b3c-7d4e-8f5a-6b7c8d9e0f12';
  const userId = newId();
  const outsiderId = newId();
  const memberId = newId();
  const newMemberId = newId();
  let stack: ServiceStack | undefined;
  let app: NestExpressApplication;
  let identity: InternalTokenSigner;
  const membersOnlySigners = new Map<string, InternalTokenSigner>();
  let searchOrganizations: ListSearchOrganizations;

  /** Creates a disposable issuer and configures only its verification key. */
  async function addIssuer(issuer: string, variable: string): Promise<InternalTokenSigner> {
    const { x, d } = generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' });
    if (x === undefined || d === undefined) throw new Error('Node returned no test signing key.');
    const publicJwk: Ed25519PublicJwk = { kty: 'OKP', crv: 'Ed25519', x, kid: `test-${issuer}` };
    vi.stubEnv(variable, JSON.stringify(publicJwk));
    return InternalTokenSigner.create({
      issuer,
      privateJwk: { ...publicJwk, d },
    });
  }

  beforeAll(async () => {
    identity = await addIssuer('identity-service', 'IDENTITY_SERVICE_INTERNAL_TOKEN_PUBLIC_JWKS');
    membersOnlySigners.set(
      'task-service',
      await addIssuer('task-service', 'TASK_SERVICE_INTERNAL_TOKEN_PUBLIC_JWKS'),
    );
    membersOnlySigners.set(
      'realtime-gateway',
      await addIssuer('realtime-gateway', 'REALTIME_GATEWAY_INTERNAL_TOKEN_PUBLIC_JWKS'),
    );
    vi.stubEnv('SEARCH_PROJECTION_CURSOR_SECRET', Buffer.alloc(32, 7).toString('base64url'));
    stack = await ServiceStack.start('search-authority');
    app = await stack.startApplication();
    searchOrganizations = new ListSearchOrganizations(
      new DrizzleSearchOrganizationsReader(app.get(SystemTransactionRunner)),
    );
    await stack.system(
      `insert into organizations
       (id, name, name_key, slug, default_language, team_size, primary_use, owner_user_id)
       values ($2, 'Second', 'second', 'second', 'fr', '1-5', 'other', $5),
              ($1, 'First', 'first', 'first', 'fr', '1-5', 'other', $4),
              ($3, 'Third', 'third', 'third', 'fr', '1-5', 'other', $5)`,
      [firstId, secondId, thirdId, userId, outsiderId],
    );
    await stack.system(
      `insert into members (id, organization_id, user_id, role, joined_at, version)
       values ($1, $2, $4, 'admin', now(), 2), ($6, $3, $5, 'owner', now(), 1)`,
      [memberId, firstId, secondId, userId, outsiderId, newId()],
    );
  });

  afterAll(async () => {
    await stack?.stop();
    vi.unstubAllEnvs();
  });

  /** Exercises the real internal JWT guard and route with the disposable Identity signing key. */
  async function identityGet(
    path: string,
    claims: InternalTokenClaims,
    audience = 'organization-service',
  ) {
    return request(app.getHttpServer())
      .get(path)
      .set('Authorization', `Bearer ${await identity.sign(audience, claims)}`);
  }

  it('resumes signed pages across historical IDs and includes the original upper ID', async () => {
    const cursor = new SearchOrganizationCursor(Buffer.alloc(32, 7).toString('base64url'));
    const first = await searchOrganizations.execute({ position: null, limit: 1 });
    expect(first).toEqual({ items: [firstId], next: { upperId: thirdId, afterId: firstId } });
    await stack?.system(
      `insert into organizations
       (id, name, name_key, slug, default_language, team_size, primary_use, owner_user_id)
       values ($1, 'Fourth', 'fourth', 'fourth', 'fr', '1-5', 'other', $2)`,
      [newOrganizationId, outsiderId],
    );

    const second = await searchOrganizations.execute({
      position: cursor.read(cursor.write(first.next) ?? undefined),
      limit: 1,
    });
    expect(second).toEqual({ items: [secondId], next: { upperId: thirdId, afterId: secondId } });
    const third = await searchOrganizations.execute({
      position: cursor.read(cursor.write(second.next) ?? undefined),
      limit: 1,
    });
    expect(third).toEqual({ items: [thirdId], next: null });

    const fresh = await searchOrganizations.execute({ position: null, limit: 100 });
    expect(fresh).toEqual({ items: [firstId, secondId, thirdId, newOrganizationId], next: null });
  });

  it('serves Identity the active signed tenant stamp through role changes, removal and rejoining', async () => {
    const proof = (organizationId: string, actorUserId: string) =>
      identityGet('/internal/v1/search-membership', {
        organizationId,
        actor: { type: 'user', id: actorUserId },
      });
    const first = await proof(firstId, userId);
    expect(first.status).toBe(200);
    expect(first.headers['cache-control']).toBe('private, no-store');
    expect(GetSearchMembershipInternalResponse.parse(first.body as unknown)).toEqual({
      memberId,
      role: 'admin',
      version: 2,
    });
    for (const [organizationId, actorUserId] of [
      [firstId, outsiderId],
      [secondId, userId],
      [newId(), userId],
    ] as const) {
      const response = await proof(organizationId, actorUserId);
      expect(response.status).toBe(404);
      expect(response.body).toMatchObject({ code: 'organization.not-found' });
    }

    await stack?.system("update members set role = 'member', version = 3 where id = $1", [
      memberId,
    ]);
    const changed = await proof(firstId, userId);
    expect(changed.status).toBe(200);
    expect(GetSearchMembershipInternalResponse.parse(changed.body as unknown)).toEqual({
      memberId,
      role: 'member',
      version: 3,
    });

    await stack?.system('update members set removed_at = now(), version = 4 where id = $1', [
      memberId,
    ]);
    const removed = await proof(firstId, userId);
    expect(removed.status).toBe(404);
    expect(removed.body).toMatchObject({ code: 'organization.not-found' });

    await stack?.system(
      `insert into members (id, organization_id, user_id, role, joined_at)
       values ($1, $2, $3, 'guest', now())`,
      [newMemberId, firstId, userId],
    );
    const rejoined = await proof(firstId, userId);
    expect(rejoined.status).toBe(200);
    expect(GetSearchMembershipInternalResponse.parse(rejoined.body as unknown)).toEqual({
      memberId: newMemberId,
      role: 'guest',
      version: 1,
    });
  });

  it('confines valid Identity tokens to their signed actor, tenant and authority routes', async () => {
    const ownSystem = { type: 'system', id: 'identity-service' } as const;
    const delegatedUser = {
      actor: { type: 'user', id: userId } as const,
      organizationId: firstId,
    };
    const list = '/internal/v1/search-organizations';
    const membership = '/internal/v1/search-membership';
    const search = await identityGet(list + '?limit=1', { actor: ownSystem, organizationId: null });
    expect(search.status).toBe(200);
    expect(ListSearchOrganizationsInternalResponse.parse(search.body as unknown)).toMatchObject({
      items: [firstId],
    });
    const wrongSystemSubject = await identityGet(list, {
      actor: { type: 'system', id: 'search-service' },
      organizationId: null,
    });
    const tenantOnGlobalExport = await identityGet(list, {
      actor: ownSystem,
      organizationId: firstId,
    });
    const missingTenant = await identityGet(membership, { ...delegatedUser, organizationId: null });
    const delegatedRole = await identityGet(membership, { ...delegatedUser, role: 'owner' });
    const overrideActor = await identityGet(`${membership}?userId=${outsiderId}`, delegatedUser);
    const wrongAudience = await identityGet(membership, delegatedUser, 'identity-service');
    const otherRoute = await identityGet('/internal/v1/members', delegatedUser);
    expect(wrongSystemSubject.body).toMatchObject({ status: 403, code: 'auth.actor-not-allowed' });
    expect(tenantOnGlobalExport.body).toMatchObject({
      status: 403,
      code: 'auth.organization-not-allowed',
    });
    expect(missingTenant.body).toMatchObject({ status: 403, code: 'auth.organization-required' });
    expect(delegatedRole.body).toMatchObject({ status: 403, code: 'auth.actor-not-allowed' });
    expect(overrideActor.body).toMatchObject({ status: 400, code: 'request.invalid' });
    expect(wrongAudience.body).toMatchObject({ status: 401, code: 'auth.token-invalid' });
    expect(otherRoute.body).toMatchObject({ status: 403, code: 'auth.issuer-not-allowed' });
  });

  it.each(['task-service', 'realtime-gateway'])(
    'confines the %s signer to live membership',
    async (issuer) => {
      const signer = membersOnlySigners.get(issuer);
      if (signer === undefined) throw new Error('Test authority issuer is absent.');
      const delegated = { actor: { type: 'user', id: userId } as const, organizationId: firstId };
      const bearer = await signer.sign('organization-service', delegated);
      const proof = await request(app.getHttpServer())
        .get('/internal/v1/search-membership')
        .set('Authorization', `Bearer ${bearer}`);
      expect(proof.status).toBe(200);
      expect(proof.headers['cache-control']).toBe('private, no-store');
      expect(GetSearchMembershipInternalResponse.safeParse(proof.body).success).toBe(true);

      const system = await signer.sign('organization-service', {
        actor: { type: 'system', id: issuer },
        organizationId: null,
      });
      const exportResponse = await request(app.getHttpServer())
        .get('/internal/v1/search-organizations')
        .set('Authorization', `Bearer ${system}`);
      expect(exportResponse.body).toMatchObject({ status: 403, code: 'auth.issuer-not-allowed' });
    },
  );
});
