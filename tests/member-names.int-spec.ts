import { LookupMemberNamesInternalResponse } from '@cadenway/contracts/validators/internal/organization-service';
import { InternalTokenSigner } from '@cadenway/nest-common';
import type { Ed25519PrivateJwk } from '@cadenway/nest-common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { newId, ServiceStack } from './support/service-stack.js';

describe('member names within the verified organization', () => {
  const organizationId = newId();
  const otherOrganizationId = newId();
  const camilleId = '019a5f3c-8d2e-7c4a-9b1f-3e5d7a9c1b30';
  const nadiaId = newId();
  const formerId = newId();
  const foreignId = newId();
  const missingNameId = newId();
  const path = '/internal/v1/member-names/lookup';
  let stack: ServiceStack;
  let app: NestExpressApplication;

  beforeAll(async () => {
    stack = await ServiceStack.start('member-names-http');
    app = await stack.startApplication();
    await stack.system(
      `insert into organizations
       (id, name, name_key, slug, default_language, team_size, primary_use, owner_user_id)
       values ($1, 'Atelier Nord', 'atelier nord', 'atelier-nord', 'fr', '1-5', 'other', $3),
              ($2, 'Coopérative Lumen', 'cooperative lumen', 'lumen', 'fr', '1-5', 'other', $4)`,
      [organizationId, otherOrganizationId, camilleId, foreignId],
    );
    await stack.system(
      `insert into directory_users (user_id, name, email)
       values ($1, 'Camille Martin', 'camille.martin@ateliernord.fr'),
              ($2, 'Nadia Garnier', 'nadia@cabinet-garnier.fr'),
              ($3, 'Ancien membre', 'former@example.test'),
              ($4, 'Inès Robert', 'ines@lumen.test'),
              ($5, null, 'missing@example.test')`,
      [camilleId, nadiaId, formerId, foreignId, missingNameId],
    );
    await stack.system(
      `insert into members (organization_id, user_id, role, joined_at, removed_at)
       values ($1, $3, 'owner', now(), null), ($1, $4, 'guest', now(), null),
              ($1, $5, 'member', now(), now()), ($2, $6, 'owner', now(), null),
              ($1, $7, 'member', now(), null)`,
      [organizationId, otherOrganizationId, camilleId, nadiaId, formerId, foreignId, missingNameId],
    );
  });

  afterAll(async () => {
    await stack.stop();
  });

  it('allows a guest to resolve only current names in their organization', async () => {
    const response = await request(app.getHttpServer())
      .post(path)
      .set('Authorization', await stack.bearer(nadiaId, organizationId))
      .send({ userIds: [camilleId, nadiaId, formerId, foreignId, missingNameId, camilleId] });

    expect(response.status).toBe(200);
    const body = LookupMemberNamesInternalResponse.parse(response.body);
    expect(body).toEqual(response.body);
    expect(body.items).toHaveLength(2);
    expect(body.items).toEqual(
      expect.arrayContaining([
        { userId: camilleId, name: 'Camille Martin' },
        { userId: nadiaId, name: 'Nadia Garnier' },
      ]),
    );
  });

  it('refuses a former member even when the signed token still names the organization', async () => {
    const response = await request(app.getHttpServer())
      .post(path)
      .set('Authorization', await stack.bearer(formerId, organizationId))
      .send({ userIds: [camilleId] });
    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ code: 'organization.not-found' });
  });

  it('requires a gateway user token scoped to an organization', async () => {
    const missingOrganization = await request(app.getHttpServer())
      .post(path)
      .set('Authorization', await stack.bearer(nadiaId, null))
      .send({ userIds: [camilleId] });
    expect(missingOrganization.status).toBe(403);
    expect(missingOrganization.body).toMatchObject({ code: 'auth.organization-required' });

    // ServiceStack generates this key in memory solely for the disposable test application.
    const fixture = stack as unknown as { gateway: { privateJwk: Ed25519PrivateJwk } };
    const gateway = await InternalTokenSigner.create({
      issuer: 'api-gateway',
      privateJwk: fixture.gateway.privateJwk,
    });
    const systemToken = await gateway.sign('organization-service', {
      actor: { type: 'system', id: null },
      organizationId,
    });
    const system = await request(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${systemToken}`)
      .send({ userIds: [camilleId] });
    expect(system.status).toBe(403);
    expect(system.body).toMatchObject({ code: 'auth.actor-not-allowed' });

    const other = await InternalTokenSigner.create({
      issuer: 'task-service',
      privateJwk: fixture.gateway.privateJwk,
    });
    const otherToken = await other.sign('organization-service', {
      actor: { type: 'user', id: nadiaId },
      organizationId,
    });
    const wrongIssuer = await request(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ userIds: [camilleId] });
    expect(wrongIssuer.status).toBe(401);
    expect(wrongIssuer.body).toMatchObject({ code: 'auth.token-invalid' });
  });

  it.each([
    {},
    { userIds: [] },
    { userIds: ['invalid'] },
    { userIds: [camilleId], organizationId },
    { userIds: Array(5001).fill(camilleId) },
  ])('rejects an invalid lookup body', async (body) => {
    const response = await request(app.getHttpServer())
      .post(path)
      .set('Authorization', await stack.bearer(nadiaId, organizationId))
      .send(body);
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'request.invalid' });
  });
});
