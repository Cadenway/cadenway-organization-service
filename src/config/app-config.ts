import { baseConfigShape, internalTokenVerifierConfigShape } from '@cadenway/nest-common';
import type { BaseConfig, InternalTokenVerifierConfig } from '@cadenway/nest-common';
import { databaseConfigShape } from '@cadenway/nest-common/database';
import type { DatabaseConfig } from '@cadenway/nest-common/database';
import { messagingConfigShape } from '@cadenway/nest-messaging';
import type { MessagingConfig } from '@cadenway/nest-messaging';
import { z } from 'zod';

/**
 * Type AppConfig
 *
 * @description
 * Variables the running service reads, validated when the application is created: by `loadConfig`
 * in `main.ts` for the options of `createApplication`, and by `ConfigModule` for the providers that
 * inject `CONFIG`.
 *
 * - `NODE_ENV`, `PORT`, `LOG_LEVEL`, `LOG_PRETTY`: `baseConfigShape` of `@cadenway/nest-common`;
 *   `PORT` is required, the others default to `production`, `info` and `false`.
 * - `DATABASE_URL`: the application role of this service's own database (`organization_app`), subject to
 *   row-level security and holding no DDL right.
 * - `DATABASE_TRANSACTION_MAX_ATTEMPTS`: total attempts for retryable database transactions, 3
 *   by default. Set it to 1 to disable retries.
 * - `NATS_URL`, `NATS_USER`, `NATS_PASSWORD`: `messagingConfigShape` of `@cadenway/nest-messaging`.
 *   `NATS_URL` is required; the user (`organization`) and its password are optional for the kit,
 *   which accepts an anonymous local broker, but every broker of Cadenway refuses a connection
 *   without them.
 * - `INTERNAL_TOKEN_AUDIENCE` and `INTERNAL_TOKEN_TRUSTED_ISSUERS`: the `aud` this service accepts
 *   and the public keys of the backends allowed to call it. An optional
 *   `SEARCH_SERVICE_INTERNAL_TOKEN_PUBLIC_JWKS` supplies Search keys when the map has no Search
 *   issuer.
 * - `SEARCH_PROJECTION_CURSOR_SECRET`: optional organization-local key for Search export cursors,
 *   as 32 bytes in canonical base64url.
 *
 * `OTEL_EXPORTER_OTLP_ENDPOINT` is read by `telemetry.ts`, before the application exists.
 */
export type AppConfig = BaseConfig &
  DatabaseConfig &
  MessagingConfig &
  InternalTokenVerifierConfig & {
    readonly SEARCH_PROJECTION_CURSOR_SECRET?: string;
  };

/**
 * Constant appConfigSchema
 *
 * @description
 * Zod schema of `AppConfig`, composed from the shapes of `@cadenway/nest-common` and
 * `@cadenway/nest-messaging` so the names, defaults and validation stay those of the kit. A missing
 * or invalid variable makes `loadConfig` throw a `ConfigError` that names it without printing its
 * value.
 *
 * @type {z.ZodType<AppConfig>}
 */
export const appConfigSchema: z.ZodType<AppConfig> = z
  .object({
    ...baseConfigShape,
    ...databaseConfigShape,
    ...messagingConfigShape,
    ...internalTokenVerifierConfigShape,
    SEARCH_SERVICE_INTERNAL_TOKEN_PUBLIC_JWKS: z.string().trim().optional(),
    SEARCH_PROJECTION_CURSOR_SECRET: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z
        .string()
        .refine(
          (value) =>
            value.length === 43 && Buffer.from(value, 'base64url').toString('base64url') === value,
          'Expected 32 bytes in canonical base64url.',
        )
        .optional(),
    ),
  })
  .transform(
    (
      {
        SEARCH_SERVICE_INTERNAL_TOKEN_PUBLIC_JWKS: searchKeys,
        SEARCH_PROJECTION_CURSOR_SECRET: cursorSecret,
        ...baseConfig
      },
      context,
    ): AppConfig => {
      const config: AppConfig = {
        ...baseConfig,
        ...(cursorSecret === undefined ? {} : { SEARCH_PROJECTION_CURSOR_SECRET: cursorSecret }),
      };
      if (
        !searchKeys ||
        searchKeys === 'null' ||
        Object.hasOwn(config.INTERNAL_TOKEN_TRUSTED_ISSUERS, 'search-service')
      ) {
        return config;
      }

      try {
        const keys: unknown = JSON.parse(`[${searchKeys}]`);
        const searchIssuer =
          internalTokenVerifierConfigShape.INTERNAL_TOKEN_TRUSTED_ISSUERS.safeParse(
            JSON.stringify({ 'search-service': keys }),
          );
        if (searchIssuer.success) {
          return {
            ...config,
            INTERNAL_TOKEN_TRUSTED_ISSUERS: {
              ...config.INTERNAL_TOKEN_TRUSTED_ISSUERS,
              ...searchIssuer.data,
            },
          };
        }
      } catch {
        // Report the variable without its contents.
      }
      context.addIssue({
        code: 'custom',
        path: ['SEARCH_SERVICE_INTERNAL_TOKEN_PUBLIC_JWKS'],
        message: 'Expected comma-separated public Ed25519 JWKs.',
      });
      return z.NEVER;
    },
  );

/**
 * Interface MigrationConfig
 *
 * @description
 * Variable the one-off migration container reads (`node dist/migrate.js`). The running service
 * never reads it: only the migrator role may change the structure of the database.
 */
export interface MigrationConfig {
  // #region Properties
  /**
   * Property MIGRATION_DATABASE_URL
   *
   * @description
   * Connection string of the migrator role (`organization_migrator`), which owns the tables and runs the
   * DDL. A secret; cadenway-ops passes it from `ORGANIZATION_SERVICE_MIGRATION_DATABASE_URL`.
   *
   * @type {string}
   * @readonly
   */
  readonly MIGRATION_DATABASE_URL: string;
  // #endregion
}

/**
 * Constant migrationConfigSchema
 *
 * @description
 * Zod schema of `MigrationConfig`: a `postgres://` or `postgresql://` URL, like `DATABASE_URL`.
 *
 * @type {z.ZodType<MigrationConfig>}
 */
export const migrationConfigSchema: z.ZodType<MigrationConfig> = z.object({
  MIGRATION_DATABASE_URL: z.url({
    protocol: /^postgres(?:ql)?$/u,
    error: 'Expected the postgres:// URL of the migrator role.',
  }),
});
