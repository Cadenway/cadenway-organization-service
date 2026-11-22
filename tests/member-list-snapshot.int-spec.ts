import { ListMembersInternalResponse } from '@cadenway/contracts/validators/internal/organization-service';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { DrizzleMemberRepository } from '../src/modules/organizations/infrastructure/persistence/drizzle/repositories/members/drizzle-member.repository.js';
import { newId, ServiceStack } from './support/service-stack.js';

describe('Member list snapshot', () => {
  const organizationId = newId();
  const ownerUserId = newId();
  const memberUserId = newId();
  const memberId = newId();
  let stack: ServiceStack | undefined;
  let app: NestExpressApplication;

  beforeAll(async () => {
    stack = await ServiceStack.start('member-list-snapshot');
    app = await stack.startApplication();
    await stack.system(
      `insert into organizations
        (id, name, name_key, slug, default_language, team_size, primary_use, owner_user_id)
       values ($1, 'Atelier Nord', 'atelier nord', 'atelier-nord', 'fr', '1-5', 'other', $2)`,
      [organizationId, ownerUserId],
    );
    await stack.system(
      `insert into directory_users (user_id, name, name_key, email)
       values ($1, 'Camille Martin', 'camille martin', 'camille.martin@ateliernord.fr'),
              ($2, 'Hugo Dubois', 'hugo dubois', 'hugo.dubois@ateliernord.fr')`,
      [ownerUserId, memberUserId],
    );
    await stack.system(
      `insert into members (id, organization_id, user_id, role, joined_at)
       values ($1, $2, $3, 'owner', now()), ($4, $2, $5, 'member', now())`,
      [newId(), organizationId, ownerUserId, memberId, memberUserId],
    );
  });

  afterAll(async () => {
    await stack?.stop();
  });

  it('keeps the filtered page and both counts together when a removal commits after the page query', async () => {
    const activeStack = stack;
    if (activeStack === undefined) throw new Error('The Organization stack is not running.');
    const list = async () =>
      request(app.getHttpServer())
        .get('/internal/v1/members')
        .query({ role: 'member' })
        .set('Authorization', await activeStack.bearer(ownerUserId, organizationId));

    // Both paths use PostgreSQL. Commit a removal on a separate connection after the page has
    // been selected and before the same request queries either count.
    const readPage = Reflect.get(DrizzleMemberRepository.prototype, 'list');
    const pageRead = vi
      .spyOn(DrizzleMemberRepository.prototype, 'list')
      .mockImplementationOnce(async function (
        this: DrizzleMemberRepository,
        ...args: Parameters<typeof readPage>
      ) {
        const page = await readPage.apply(this, args);
        await activeStack.system(
          'update members set removed_at = now(), version = version + 1 where organization_id = $1 and id = $2',
          [organizationId, memberId],
        );
        return page;
      });
    try {
      const response = await list();
      expect(response.status).toBe(200);
      expect(ListMembersInternalResponse.parse(response.body)).toMatchObject({
        items: [{ id: memberId, role: 'member' }],
        total: 1,
        counts: { owner: 1, admin: 0, member: 1, guest: 0 },
      });
    } finally {
      pageRead.mockRestore();
    }

    const refreshed = await list();
    expect(refreshed.status).toBe(200);
    expect(ListMembersInternalResponse.parse(refreshed.body)).toMatchObject({
      items: [],
      total: 0,
      counts: { owner: 1, admin: 0, member: 0, guest: 0 },
    });
  });
});
