import { baseConfigShape, internalTokenVerifierConfigShape } from '@cadenway/nest-common';
import type { BaseConfig, InternalTokenVerifierConfig } from '@cadenway/nest-common';
import { databaseConfigShape } from '@cadenway/nest-common/database';
import type { DatabaseConfig } from '@cadenway/nest-common/database';
import { messagingConfigShape } from '@cadenway/nest-messaging';
import type { MessagingConfig } from '@cadenway/nest-messaging';
import { z } from 'zod';

const optionalCursorSecret = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z
    .string()
    .refine(
      (value) =>
        value.length === 43 && Buffer.from(value, 'base64url').toString('base64url') === value,
      'Expected 32 bytes in canonical base64url.',
    )
    .optional(),
);

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
 *   issuer-specific fallback supplies public Search, Billing and Notification keys when the map has
 *   no corresponding issuer.
 * - `SEARCH_PROJECTION_CURSOR_SECRET` and `BILLING_AUTHORITY_CURSOR_SECRET`: stable keys for their
 *   respective export cursors, as 32 bytes in canonical base64url.
 * - `ORGANIZATION_SEAT_ENTITLEMENT_EVENTS_ENABLED`: enables the Billing durable independently of
 *   seat admission enforcement. Defaults to false until the broker permissions are deployed.
 *
 * `OTEL_EXPORTER_OTLP_ENDPOINT` is read by `telemetry.ts`, before the application exists.
 */
export type AppConfig = BaseConfig &
  DatabaseConfig &
  MessagingConfig &
  InternalTokenVerifierConfig & {
    readonly SEARCH_PROJECTION_CURSOR_SECRET?: string;
    readonly BILLING_AUTHORITY_CURSOR_SECRET?: string;
    readonly ORGANIZATION_SEAT_QUOTA_ENABLED: boolean;
    readonly ORGANIZATION_SEAT_ENTITLEMENT_EVENTS_ENABLED: boolean;
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
    BILLING_SERVICE_INTERNAL_TOKEN_PUBLIC_JWKS: z.string().trim().optional(),
    NOTIFICATION_SERVICE_INTERNAL_TOKEN_PUBLIC_JWKS: z.string().trim().optional(),
    SEARCH_PROJECTION_CURSOR_SECRET: optionalCursorSecret,
    BILLING_AUTHORITY_CURSOR_SECRET: optionalCursorSecret,
    ORGANIZATION_SEAT_QUOTA_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    ORGANIZATION_SEAT_ENTITLEMENT_EVENTS_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
  })
  .transform(
    (
      {
        SEARCH_SERVICE_INTERNAL_TOKEN_PUBLIC_JWKS: searchKeys,
        BILLING_SERVICE_INTERNAL_TOKEN_PUBLIC_JWKS: billingKeys,
        NOTIFICATION_SERVICE_INTERNAL_TOKEN_PUBLIC_JWKS: notificationKeys,
        SEARCH_PROJECTION_CURSOR_SECRET: searchCursorSecret,
        BILLING_AUTHORITY_CURSOR_SECRET: billingCursorSecret,
        ...baseConfig
      },
      context,
    ): AppConfig => {
      const trusted = { ...baseConfig.INTERNAL_TOKEN_TRUSTED_ISSUERS };
      const fallbacks = [
        ['search-service', 'SEARCH_SERVICE_INTERNAL_TOKEN_PUBLIC_JWKS', searchKeys],
        ['billing-service', 'BILLING_SERVICE_INTERNAL_TOKEN_PUBLIC_JWKS', billingKeys],
        [
          'notification-service',
          'NOTIFICATION_SERVICE_INTERNAL_TOKEN_PUBLIC_JWKS',
          notificationKeys,
        ],
      ] as const;
      for (const [issuer, variable, fragment] of fallbacks) {
        if (!fragment || fragment === 'null' || Object.hasOwn(trusted, issuer)) continue;
        try {
          const keys: unknown = JSON.parse(`[${fragment}]`);
          const issuerConfig =
            internalTokenVerifierConfigShape.INTERNAL_TOKEN_TRUSTED_ISSUERS.safeParse(
              JSON.stringify({ [issuer]: keys }),
            );
          if (issuerConfig.success) {
            Object.assign(trusted, issuerConfig.data);
            continue;
          }
        } catch {
          // Report the variable without its contents.
        }
        context.addIssue({
          code: 'custom',
          path: [variable],
          message: 'Expected comma-separated public Ed25519 JWKs.',
        });
        return z.NEVER;
      }
      return {
        ...baseConfig,
        INTERNAL_TOKEN_TRUSTED_ISSUERS: trusted,
        ...(searchCursorSecret === undefined
          ? {}
          : { SEARCH_PROJECTION_CURSOR_SECRET: searchCursorSecret }),
        ...(billingCursorSecret === undefined
          ? {}
          : { BILLING_AUTHORITY_CURSOR_SECRET: billingCursorSecret }),
      };
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
