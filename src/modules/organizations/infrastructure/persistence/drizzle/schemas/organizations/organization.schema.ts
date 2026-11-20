import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import {
  check,
  integer,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import type { DefaultLanguage } from '../../../../../domain/value-objects/organizations/default-language.value-object.js';
import type { Plan } from '../../../../../domain/value-objects/organizations/plan.value-object.js';

/**
 * Constant ORGANIZATION_ISOLATION
 *
 * @description
 * Predicate of the row-level security policy of `organizations`: the predicate of the kit
 * (`organizationIsolation` of `@cadenway/nest-common/database`), on `id`, since the row of an
 * organization is the organization itself. A tenant transaction sees its own organization only; a
 * system transaction sees every one.
 *
 * @type {SQL}
 */
const ORGANIZATION_ISOLATION: SQL = sql`id = nullif(current_setting('app.organization_id', true), '')::uuid or current_setting('app.system_access', true) = 'on'`;

/**
 * Table `organizations`: one row per organization, its profile ("Profil de l'organisation"), the
 * answers of the creation form and its owner. `slug` is unique across organizations (decision 10
 * of P2b): the unique index decides concurrent creations. `name_key` is the search key of the name
 * (`searchKeyOf`), the sort key of the picker. The enumerations are `text` with a `CHECK`
 * (`cw-database-conventions`). Row-level security is enabled here and forced by the migration.
 */
export const organizations = pgTable(
  'organizations',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    name: text('name').notNull(),
    nameKey: text('name_key').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    website: text('website'),
    defaultLanguage: text('default_language').$type<DefaultLanguage>().notNull(),
    plan: text('plan').$type<Plan>().notNull().default('free'),
    teamSize: text('team_size').notNull(),
    primaryUse: text('primary_use').notNull(),
    ownerUserId: uuid('owner_user_id').notNull(),
    logoId: uuid('logo_id'),
    logoGeneration: integer('logo_generation').notNull().default(0),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('organizations_slug_unique').on(table.slug),
    check('organizations_name_check', sql`char_length(${table.name}) between 1 and 120`),
    check(
      'organizations_slug_check',
      sql`${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(${table.slug}) between 2 and 63`,
    ),
    check(
      'organizations_description_check',
      sql`${table.description} is null or char_length(${table.description}) <= 280`,
    ),
    check(
      'organizations_website_check',
      sql`${table.website} is null or char_length(${table.website}) <= 2048`,
    ),
    check(
      'organizations_default_language_check',
      sql`${table.defaultLanguage} in ('fr', 'en', 'de')`,
    ),
    check('organizations_plan_check', sql`${table.plan} in ('free', 'team', 'enterprise')`),
    check(
      'organizations_team_size_check',
      sql`${table.teamSize} in ('1-5', '6-20', '21-100', 'over-100')`,
    ),
    check(
      'organizations_primary_use_check',
      sql`${table.primaryUse} in ('product-engineering', 'agency-client-projects', 'marketing-content', 'operations-support', 'other')`,
    ),
    check('organizations_version_check', sql`${table.version} >= 1`),
    check('organizations_logo_generation_check', sql`${table.logoGeneration} >= 0`),
    pgPolicy('organizations_organization_isolation', {
      as: 'permissive',
      for: 'all',
      to: 'public',
      using: ORGANIZATION_ISOLATION,
      withCheck: ORGANIZATION_ISOLATION,
    }),
  ],
);
