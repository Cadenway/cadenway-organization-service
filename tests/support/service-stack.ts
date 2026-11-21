import { execFileSync } from 'node:child_process';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

import { createApplication, InternalTokenSigner, loadConfig } from '@cadenway/nest-common';
import type { Ed25519PrivateJwk, Ed25519PublicJwk } from '@cadenway/nest-common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import pg from 'pg';
import { vi } from 'vitest';

import { AppModule } from '../../src/app.module.js';
import { appConfigSchema } from '../../src/config/app-config.js';
import { installOrganizationAuthorityCachePolicy } from '../../src/infrastructure/http/organization-authority-cache-policy.js';
import { installOrganizationLogoCachePolicy } from '../../src/infrastructure/http/organization-logo-cache-policy.js';

// The service as main.ts assembles it, on the disposable PostgreSQL and NATS of compose.dev.yaml
// started as a throwaway Compose project on free ports, as tests/service-wiring.int-spec.ts does:
// `@cadenway/nest-testing` does not export container fixtures yet. The NATS command line of the
// `nats-streams` container plays identity-service (it publishes as `admin`) and reads the stream
// as notification-service would.

/** Compose file of the development dependencies. */
const composeFile: string = fileURLToPath(new URL('../../compose.dev.yaml', import.meta.url));

/** State of a consumer, as `nats consumer info --json` reports it. */
export interface ConsumerState {
  /** Messages delivered so far, redeliveries included. */
  readonly delivered: { readonly consumer_seq: number; readonly stream_seq: number };
  /** Messages of the stream not delivered yet. */
  readonly num_pending: number;
  /** Messages delivered and not acknowledged yet. */
  readonly num_ack_pending: number;
  /** The settings of the consumer. */
  readonly config: {
    /** Deliveries of a message, the first included, before its dead letter. */
    readonly max_deliver: number;
    /** Time the server waits for an acknowledgement before it delivers again, in nanoseconds. */
    readonly ack_wait: number;
  };
}

/**
 * Finds a port of the loopback interface that nothing listens on.
 *
 * @returns A free port, released before it is returned.
 */
async function freePort(): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (address === null || typeof address === 'string') {
          reject(new Error('The probe server has no TCP address.'));
        } else {
          resolve(String(address.port));
        }
      });
    });
  });
}

/**
 * Creates an Ed25519 key pair in the JWK forms the internal token uses.
 *
 * @returns The public key for the verifier and the private key for the signer of the gateway.
 */
function keyPair(): {
  readonly publicJwk: Ed25519PublicJwk;
  readonly privateJwk: Ed25519PrivateJwk;
} {
  const { x, d } = generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' });
  if (x === undefined || d === undefined) {
    throw new Error('Node returned an Ed25519 JWK without its key material.');
  }
  const publicJwk: Ed25519PublicJwk = { kty: 'OKP', crv: 'Ed25519', x, kid: 'test-api-gateway' };
  return { publicJwk, privateJwk: { ...publicJwk, d } };
}

/** The dependencies, the migrations and, once started, the application. */
export class ServiceStack {
  /** Throwaway project name: it never touches the developer's own stacks. */
  private readonly project: string;

  /** Host port of NATS, fixed for the run. */
  private readonly natsPort: string;

  /** The key pair of the fake gateway. */
  private readonly gateway = keyPair();

  /** Signer of the internal tokens of the fake gateway. */
  private signer: InternalTokenSigner | undefined;

  /** The application, once started. */
  private application: NestExpressApplication | undefined;

  /** A pool of the migrator role, for the checks the application role may not run. */
  public readonly migrator: pg.Pool;

  /** Host port of PostgreSQL. */
  private readonly postgresPort: string;

  private constructor(project: string, natsPort: string, postgresPort: string) {
    this.project = project;
    this.natsPort = natsPort;
    this.postgresPort = postgresPort;
    this.migrator = new pg.Pool({
      connectionString: this.url('organization_migrator'),
      max: 2,
      idleTimeoutMillis: 0,
    });
    this.migrator.on('error', () => undefined);
  }

  /**
   * Starts PostgreSQL, NATS and the streams, then applies the migrations as the migrator role.
   *
   * @param name - Suffix of the throwaway project name.
   * @returns The stack, without the application.
   */
  public static async start(name: string): Promise<ServiceStack> {
    const project = `cadenway-organization-service-${name}-${String(process.pid)}`;
    const natsPort = await freePort();
    const run = (...args: readonly string[]): string =>
      execFileSync(
        'docker',
        ['compose', '--project-name', project, '--file', composeFile, ...args],
        {
          encoding: 'utf8',
          env: { ...process.env, DEV_POSTGRES_PORT: '0', DEV_NATS_PORT: natsPort },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
    run('up', '--detach', '--wait', '--wait-timeout', '120', 'postgres', 'nats', 'nats-streams');
    const postgresPort = run('port', 'postgres', '5432').trim().split(':').at(-1) ?? '';
    const stack = new ServiceStack(project, natsPort, postgresPort);
    vi.stubEnv('MIGRATION_DATABASE_URL', stack.url('organization_migrator'));
    vi.resetModules();
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await import('../../src/migrate.js');
    } finally {
      log.mockRestore();
    }
    return stack;
  }

  /**
   * The connection string of a role of the database.
   *
   * @param role - `organization_migrator` or `organization_app`.
   * @returns The URL.
   */
  private url(role: string): string {
    return `postgres://${role}:${role}@127.0.0.1:${this.postgresPort}/organization`;
  }

  /**
   * Runs `docker compose` on the throwaway project.
   *
   * @param args - Compose command and its arguments.
   * @returns The standard output.
   */
  private compose(...args: readonly string[]): string {
    return execFileSync(
      'docker',
      ['compose', '--project-name', this.project, '--file', composeFile, ...args],
      {
        encoding: 'utf8',
        env: { ...process.env, DEV_POSTGRES_PORT: '0', DEV_NATS_PORT: this.natsPort },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
  }

  /**
   * Runs the NATS command line of the `nats-streams` container, as its `admin` user.
   *
   * @param args - Arguments of the `nats` command.
   * @returns The standard output.
   */
  private nats(...args: readonly string[]): string {
    return this.compose('exec', '-T', 'nats-streams', 'nats', '--timeout', '5s', ...args);
  }

  /**
   * Publishes an event in `EVENTS`, as its producer would.
   *
   * @param name - Name of the event, such as `user.signed-up.v1`.
   * @param payload - Its payload.
   * @param messageId - The `Nats-Msg-Id`; the event id by default. Another one stores the same
   * event again, as a requeue past the duplicate window of the stream would.
   */
  public publish(name: string, payload: { readonly id: string }, messageId?: string): void {
    this.nats(
      'pub',
      '--jetstream',
      '-H',
      `Nats-Msg-Id:${messageId ?? payload.id}`,
      `evt.${name}`,
      JSON.stringify(payload),
    );
  }

  /**
   * Reads the payload of the last message of a subject of `EVENTS`.
   *
   * @param name - Name of the event.
   * @returns The payload, or `null` when the subject holds none.
   */
  public lastEvent(name: string): Record<string, unknown> | null {
    let output: string;
    try {
      output = this.nats('stream', 'get', 'EVENTS', '--last-for', `evt.${name}`, '--json');
    } catch {
      return null;
    }
    const message = JSON.parse(output) as { readonly data: string };
    return JSON.parse(Buffer.from(message.data, 'base64').toString('utf8')) as Record<
      string,
      unknown
    >;
  }

  /**
   * Reads the state of a durable consumer of `EVENTS`.
   *
   * @param name - Name of the consumer.
   * @returns Its state.
   */
  public consumer(name: string): ConsumerState {
    return JSON.parse(this.nats('consumer', 'info', 'EVENTS', name, '--json')) as ConsumerState;
  }

  /**
   * Runs a query as the migrator role in a transaction with the system access of the kit, so the
   * forced policies show every organization.
   *
   * @param text - The SQL.
   * @param values - Its parameters.
   * @returns The rows.
   */
  public async system<TRow>(text: string, values: readonly unknown[] = []): Promise<TRow[]> {
    const client = await this.migrator.connect();
    try {
      await client.query('begin');
      await client.query(`select set_config('app.system_access', 'on', true)`);
      const result = await client.query(text, [...values]);
      await client.query('commit');
      return result.rows as TRow[];
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Creates the application as `main.ts` does, as the application role and the NATS user
   * `organization`, and initializes it, which subscribes the handlers.
   *
   * @returns The application.
   */
  public async startApplication(): Promise<NestExpressApplication> {
    vi.stubEnv('PORT', '3011');
    vi.stubEnv('LOG_PRETTY', 'false');
    vi.stubEnv('DATABASE_URL', this.url('organization_app'));
    vi.stubEnv('NATS_URL', `nats://127.0.0.1:${this.natsPort}`);
    vi.stubEnv('NATS_USER', 'organization');
    vi.stubEnv('NATS_PASSWORD', 'organization');
    vi.stubEnv('INTERNAL_TOKEN_AUDIENCE', 'organization-service');
    vi.stubEnv(
      'INTERNAL_TOKEN_TRUSTED_ISSUERS',
      JSON.stringify({ 'api-gateway': [this.gateway.publicJwk] }),
    );
    const config = loadConfig(appConfigSchema);
    const app = await createApplication(AppModule, {
      service: 'organization-service',
      config,
      internalToken: {
        verifier: {
          audience: config.INTERNAL_TOKEN_AUDIENCE,
          trustedIssuers: config.INTERNAL_TOKEN_TRUSTED_ISSUERS,
        },
      },
      logDestination: { write: (): void => undefined },
    });
    installOrganizationLogoCachePolicy(app);
    installOrganizationAuthorityCachePolicy(app);
    await app.init();
    this.signer = await InternalTokenSigner.create({
      issuer: 'api-gateway',
      privateJwk: this.gateway.privateJwk,
    });
    this.application = app;
    return app;
  }

  /**
   * Signs the internal token the gateway sends for a user.
   *
   * @param userId - The user the introspection returned.
   * @param organizationId - The organization of the session, or `null`.
   * @returns `Bearer <token>`.
   */
  public async bearer(userId: string, organizationId: string | null): Promise<string> {
    if (this.signer === undefined) {
      throw new Error('The application did not start.');
    }
    return `Bearer ${await this.signer.sign('organization-service', {
      actor: { type: 'user', id: userId },
      organizationId,
    })}`;
  }

  /**
   * Stops the application and removes the project, its containers and its volumes.
   */
  public async stop(): Promise<void> {
    try {
      await this.application?.close();
      await this.migrator.end();
    } finally {
      vi.unstubAllEnvs();
      this.compose('down', '--volumes', '--remove-orphans');
    }
  }
}

/**
 * A fresh UUID, for the ids of events and of accounts the mockup does not name.
 *
 * @returns The id.
 */
export function newId(): string {
  return randomUUID();
}
