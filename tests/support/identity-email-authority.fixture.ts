import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { InternalTokenVerifier, type Ed25519PublicJwk } from '@cadenway/nest-common';
import { z } from 'zod';

const accountEvent = z.object({
  userId: z.string(),
  version: z.number(),
  email: z.string().optional(),
});

/** Keeps the fake Identity authority independent from Organization's persisted projection. */
export class IdentityEmailAuthorityFixture {
  private readonly accounts = new Map<string, { version: number; email: string | null }>();
  private server?: Server;

  public observe(name: string, payload: unknown): void {
    if (
      name !== 'user.email-verified.v1' &&
      name !== 'user.email-changed.v1' &&
      name !== 'user.deleted.v1'
    ) {
      return;
    }
    const event = accountEvent.parse(payload);
    this.set(
      event.userId,
      event.version,
      name === 'user.deleted.v1' ? null : (event.email ?? null),
    );
  }

  public set(userId: string, version: number, email: string | null): void {
    if ((this.accounts.get(userId)?.version ?? 0) < version) {
      this.accounts.set(userId, { version, email });
    }
  }

  public async start(key: Ed25519PublicJwk): Promise<string> {
    const verifier = await InternalTokenVerifier.create({
      audience: 'identity-service',
      trustedIssuers: { 'organization-service': [key] },
    });
    const server = createServer((request, response) => {
      const send = (status: number, body: object) => {
        response.writeHead(status, {
          'Cache-Control': 'no-store',
          'Content-Type': status === 200 ? 'application/json' : 'application/problem+json',
        });
        response.end(JSON.stringify(body));
      };
      const authorization = request.headers.authorization ?? '';
      void verifier
        .verify(authorization.slice('Bearer '.length))
        .then((principal) => {
          if (
            request.method !== 'GET' ||
            principal.actor.type !== 'system' ||
            principal.actor.id !== 'organization-service' ||
            principal.organizationId !== null ||
            principal.role !== null ||
            principal.scopes.length !== 0
          ) {
            send(403, {});
            return;
          }
          const userId = request.url?.match(
            /^\/internal\/v1\/users\/([^/]+)\/verified-email$/u,
          )?.[1];
          const email = userId === undefined ? null : this.accounts.get(userId)?.email;
          if (email == null) {
            send(404, {
              type: 'about:blank',
              title: 'Not Found',
              status: 404,
              code: 'user.not-found',
            });
            return;
          }
          send(200, { email });
        })
        .catch(() => send(401, {}));
    });
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    return `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  }

  public async stop(): Promise<void> {
    const server = this.server;
    if (server === undefined) return;
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error === undefined) resolve();
        else reject(error);
      });
    });
  }
}
