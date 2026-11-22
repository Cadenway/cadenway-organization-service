import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

import { ConfigError, loadConfig } from '@cadenway/nest-common';
import { describe, expect, it } from 'vitest';

import { appConfigSchema, migrationConfigSchema } from './app-config.js';

describe('appConfigSchema', () => {
  const trustedIssuers: string =
    '{"api-gateway":[{"kty":"OKP","crv":"Ed25519","x":"MVZQc5h6AXxnMpaBTaYw5kI-yWWawl6zp8Srhuf5NK0","kid":"local-placeholder"}]}';
  const complete: Readonly<Record<string, string>> = {
    PORT: '3011',
    DATABASE_URL: 'postgres://organization_app:organization_app@localhost:5432/organization',
    NATS_URL: 'nats://localhost:4222',
    NATS_USER: 'organization',
    NATS_PASSWORD: 'organization',
    INTERNAL_TOKEN_AUDIENCE: 'organization-service',
    INTERNAL_TOKEN_TRUSTED_ISSUERS: trustedIssuers,
  };

  it('reads the variables of the service with the defaults of the kit', () => {
    expect(loadConfig(appConfigSchema, complete)).toEqual({
      NODE_ENV: 'production',
      PORT: 3011,
      LOG_LEVEL: 'info',
      LOG_PRETTY: false,
      DATABASE_URL: 'postgres://organization_app:organization_app@localhost:5432/organization',
      DATABASE_TRANSACTION_MAX_ATTEMPTS: 3,
      NATS_URL: 'nats://localhost:4222',
      NATS_USER: 'organization',
      NATS_PASSWORD: 'organization',
      ORGANIZATION_SEAT_QUOTA_ENABLED: false,
      ORGANIZATION_SEAT_ENTITLEMENT_EVENTS_ENABLED: false,
      INTERNAL_TOKEN_AUDIENCE: 'organization-service',
      INTERNAL_TOKEN_TRUSTED_ISSUERS: {
        'api-gateway': [
          {
            kty: 'OKP',
            crv: 'Ed25519',
            x: 'MVZQc5h6AXxnMpaBTaYw5kI-yWWawl6zp8Srhuf5NK0',
            kid: 'local-placeholder',
          },
        ],
      },
    });
  });

  it('accepts the committed .env.example as it is', () => {
    const example: NodeJS.Dict<string> = parseEnv(
      readFileSync(new URL('../../.env.example', import.meta.url), 'utf8'),
    );

    expect(() => loadConfig(appConfigSchema, example)).not.toThrow();
    expect(() => loadConfig(migrationConfigSchema, example)).not.toThrow();
  });

  it('accepts one transaction attempt to disable retries', () => {
    expect(
      loadConfig(appConfigSchema, { ...complete, DATABASE_TRANSACTION_MAX_ATTEMPTS: '1' })
        .DATABASE_TRANSACTION_MAX_ATTEMPTS,
    ).toBe(1);
  });

  it('enables the Billing consumer independently of seat quota enforcement', () => {
    expect(
      loadConfig(appConfigSchema, {
        ...complete,
        ORGANIZATION_SEAT_ENTITLEMENT_EVENTS_ENABLED: 'true',
      }),
    ).toMatchObject({
      ORGANIZATION_SEAT_ENTITLEMENT_EVENTS_ENABLED: true,
      ORGANIZATION_SEAT_QUOTA_ENABLED: false,
    });
  });

  it.each([
    ['search-service', 'SEARCH_SERVICE_INTERNAL_TOKEN_PUBLIC_JWKS'],
    ['identity-service', 'IDENTITY_SERVICE_INTERNAL_TOKEN_PUBLIC_JWKS'],
    ['task-service', 'TASK_SERVICE_INTERNAL_TOKEN_PUBLIC_JWKS'],
    ['realtime-gateway', 'REALTIME_GATEWAY_INTERNAL_TOKEN_PUBLIC_JWKS'],
  ] as const)(
    'loads rotating public keys for %s and a canonical cursor secret',
    (issuer, variable) => {
      const first = {
        kty: 'OKP',
        crv: 'Ed25519',
        x: 'MVZQc5h6AXxnMpaBTaYw5kI-yWWawl6zp8Srhuf5NK0',
        kid: 'fixture-rotation-1',
      };
      const second = { ...first, kid: 'fixture-rotation-2' };
      const cursorSecret = Buffer.alloc(32, 7).toString('base64url');
      const config = loadConfig(appConfigSchema, {
        ...complete,
        [variable]: [first, second].map((key) => JSON.stringify(key)).join(','),
        SEARCH_PROJECTION_CURSOR_SECRET: cursorSecret,
      });

      expect(config.INTERNAL_TOKEN_TRUSTED_ISSUERS).toMatchObject({
        'api-gateway': [{ kid: 'local-placeholder' }],
        [issuer]: [first, second],
      });
      expect(config.SEARCH_PROJECTION_CURSOR_SECRET).toBe(cursorSecret);
    },
  );

  it('gives the explicit Search issuer precedence over the fallback', () => {
    const key = {
      kty: 'OKP',
      crv: 'Ed25519',
      x: 'MVZQc5h6AXxnMpaBTaYw5kI-yWWawl6zp8Srhuf5NK0',
      kid: 'fixture-explicit-search',
    };
    const explicit = `${trustedIssuers.slice(0, -1)},"search-service":[${JSON.stringify(key)}]}`;

    expect(
      loadConfig(appConfigSchema, {
        ...complete,
        INTERNAL_TOKEN_TRUSTED_ISSUERS: explicit,
        SEARCH_SERVICE_INTERNAL_TOKEN_PUBLIC_JWKS: 'unusable-fallback',
      }).INTERNAL_TOKEN_TRUSTED_ISSUERS,
    ).toMatchObject({
      'api-gateway': [{ kid: 'local-placeholder' }],
      'search-service': [key],
    });
  });

  it.each(['', '  ', 'null'])(
    'leaves Search and Identity dormant with the fallback %j',
    (fallback) => {
      const config = loadConfig(appConfigSchema, {
        ...complete,
        SEARCH_SERVICE_INTERNAL_TOKEN_PUBLIC_JWKS: fallback,
        IDENTITY_SERVICE_INTERNAL_TOKEN_PUBLIC_JWKS: fallback,
        SEARCH_PROJECTION_CURSOR_SECRET: '',
      });

      expect(config.INTERNAL_TOKEN_TRUSTED_ISSUERS).not.toHaveProperty('search-service');
      expect(config.INTERNAL_TOKEN_TRUSTED_ISSUERS).not.toHaveProperty('identity-service');
      expect(config.INTERNAL_TOKEN_TRUSTED_ISSUERS).not.toHaveProperty('task-service');
      expect(config.INTERNAL_TOKEN_TRUSTED_ISSUERS).not.toHaveProperty('realtime-gateway');
      expect(config).not.toHaveProperty('SEARCH_PROJECTION_CURSOR_SECRET');
    },
  );

  it('refuses a private Search key without printing it', () => {
    const key = JSON.stringify({
      kty: 'OKP',
      crv: 'Ed25519',
      x: 'MVZQc5h6AXxnMpaBTaYw5kI-yWWawl6zp8Srhuf5NK0',
      kid: 'fixture-private-search',
      d: 'synthetic-private-key-contents',
    });
    const load = () =>
      loadConfig(appConfigSchema, { ...complete, SEARCH_SERVICE_INTERNAL_TOKEN_PUBLIC_JWKS: key });
    expect(load).toThrow(/SEARCH_SERVICE_INTERNAL_TOKEN_PUBLIC_JWKS/u);
    expect(load).not.toThrow(/synthetic-private-key-contents/u);
  });

  it('refuses a noncanonical encoding of the cursor secret without printing it', () => {
    const secret = `${'A'.repeat(42)}B`;
    const load = () =>
      loadConfig(appConfigSchema, { ...complete, SEARCH_PROJECTION_CURSOR_SECRET: secret });
    expect(load).toThrow(/SEARCH_PROJECTION_CURSOR_SECRET/u);
    expect(load).not.toThrow(secret);
  });

  it('refuses to start without the database, the broker, the audience or the trusted issuers', () => {
    expect(() => loadConfig(appConfigSchema, { PORT: '3011' })).toThrow(ConfigError);
    try {
      loadConfig(appConfigSchema, { PORT: '3011' });
    } catch (error) {
      const issues: readonly string[] = (error as ConfigError).issues;
      expect(issues.map((issue) => issue.split(':')[0])).toEqual(
        expect.arrayContaining([
          'DATABASE_URL',
          'NATS_URL',
          'INTERNAL_TOKEN_AUDIENCE',
          'INTERNAL_TOKEN_TRUSTED_ISSUERS',
        ]),
      );
    }
  });

  it('refuses a database URL that is not PostgreSQL, without printing it', () => {
    const secret: string = 'mysql://organization_app:s3cret@localhost/organization';

    expect(() => loadConfig(appConfigSchema, { ...complete, DATABASE_URL: secret })).toThrow(
      /DATABASE_URL/u,
    );
    expect(() => loadConfig(appConfigSchema, { ...complete, DATABASE_URL: secret })).not.toThrow(
      /s3cret/u,
    );
  });

  it('refuses a broker URL that is not NATS, without printing it', () => {
    const secret: string = 'http://organization:s3cret@localhost:4222';

    expect(() => loadConfig(appConfigSchema, { ...complete, NATS_URL: secret })).toThrow(
      /NATS_URL/u,
    );
    expect(() => loadConfig(appConfigSchema, { ...complete, NATS_URL: secret })).not.toThrow(
      /s3cret/u,
    );
  });

  it('refuses a private key listed as a verification key', () => {
    const withPrivateKey: string = trustedIssuers.replace('"kid"', `"d":"${'A'.repeat(43)}","kid"`);

    expect(() =>
      loadConfig(appConfigSchema, { ...complete, INTERNAL_TOKEN_TRUSTED_ISSUERS: withPrivateKey }),
    ).toThrow(/INTERNAL_TOKEN_TRUSTED_ISSUERS/u);
  });

  it('does not read the migrator URL: the running service never needs it', () => {
    expect(loadConfig(appConfigSchema, complete)).not.toHaveProperty('MIGRATION_DATABASE_URL');
  });
});

describe('migrationConfigSchema', () => {
  it('reads the URL of the migrator role', () => {
    expect(
      loadConfig(migrationConfigSchema, {
        MIGRATION_DATABASE_URL:
          'postgres://organization_migrator:organization_migrator@localhost:5432/organization',
      }),
    ).toEqual({
      MIGRATION_DATABASE_URL:
        'postgres://organization_migrator:organization_migrator@localhost:5432/organization',
    });
  });

  it('names MIGRATION_DATABASE_URL when it is missing', () => {
    expect(() =>
      loadConfig(migrationConfigSchema, {
        DATABASE_URL: 'postgres://organization_app:organization_app@localhost:5432/organization',
      }),
    ).toThrow(/MIGRATION_DATABASE_URL: required, not set/u);
  });

  it('names MIGRATION_DATABASE_URL when it is not a PostgreSQL URL, without printing it', () => {
    const secret: string = 'mysql://organization_migrator:s3cret@localhost/organization';

    expect(() => loadConfig(migrationConfigSchema, { MIGRATION_DATABASE_URL: secret })).toThrow(
      /MIGRATION_DATABASE_URL: Expected the postgres:\/\/ URL of the migrator role/u,
    );
    expect(() => loadConfig(migrationConfigSchema, { MIGRATION_DATABASE_URL: secret })).not.toThrow(
      /s3cret/u,
    );
  });
});
