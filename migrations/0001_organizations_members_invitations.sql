CREATE TABLE "directory_users" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"name" text,
	"name_key" text,
	"name_version" integer DEFAULT 0 NOT NULL,
	"email" text,
	"email_verified" boolean DEFAULT false NOT NULL,
	"email_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "directory_users_versions_check" CHECK ("directory_users"."name_version" >= 0 and "directory_users"."email_version" >= 0),
	CONSTRAINT "directory_users_verified_email_check" CHECK (not "directory_users"."email_verified" or "directory_users"."email" is not null)
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"invited_by_user_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"answered_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitations_role_check" CHECK ("invitations"."role" in ('admin', 'member', 'guest')),
	CONSTRAINT "invitations_status_check" CHECK ("invitations"."status" in ('pending', 'accepted', 'refused', 'revoked')),
	CONSTRAINT "invitations_email_check" CHECK (char_length("invitations"."email") between 3 and 254),
	CONSTRAINT "invitations_expiry_check" CHECK ("invitations"."expires_at" > "invitations"."sent_at"),
	CONSTRAINT "invitations_version_check" CHECK ("invitations"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "invitations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "members" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"invitation_id" uuid,
	"joined_at" timestamp with time zone NOT NULL,
	"removed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "members_role_check" CHECK ("members"."role" in ('owner', 'admin', 'member', 'guest')),
	CONSTRAINT "members_version_check" CHECK ("members"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"website" text,
	"default_language" text NOT NULL,
	"plan" text DEFAULT 'free' NOT NULL,
	"team_size" text NOT NULL,
	"primary_use" text NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_name_check" CHECK (char_length("organizations"."name") between 1 and 120),
	CONSTRAINT "organizations_slug_check" CHECK ("organizations"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length("organizations"."slug") between 2 and 63),
	CONSTRAINT "organizations_description_check" CHECK ("organizations"."description" is null or char_length("organizations"."description") <= 280),
	CONSTRAINT "organizations_website_check" CHECK ("organizations"."website" is null or char_length("organizations"."website") <= 2048),
	CONSTRAINT "organizations_default_language_check" CHECK ("organizations"."default_language" in ('fr', 'en', 'de')),
	CONSTRAINT "organizations_plan_check" CHECK ("organizations"."plan" in ('free', 'team', 'enterprise')),
	CONSTRAINT "organizations_team_size_check" CHECK ("organizations"."team_size" in ('1-5', '6-20', '21-100', 'over-100')),
	CONSTRAINT "organizations_primary_use_check" CHECK ("organizations"."primary_use" in ('product-engineering', 'agency-client-projects', 'marketing-content', 'operations-support', 'other')),
	CONSTRAINT "organizations_version_check" CHECK ("organizations"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "directory_users_email_index" ON "directory_users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_organization_email_pending_unique" ON "invitations" USING btree ("organization_id","email") WHERE "invitations"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "invitations_organization_pending_index" ON "invitations" USING btree ("organization_id","sent_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "invitations"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "invitations_email_pending_index" ON "invitations" USING btree ("email","sent_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "invitations"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "members_organization_user_active_unique" ON "members" USING btree ("organization_id","user_id") WHERE "members"."removed_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "members_organization_owner_unique" ON "members" USING btree ("organization_id") WHERE "members"."role" = 'owner' and "members"."removed_at" is null;--> statement-breakpoint
CREATE INDEX "members_user_active_index" ON "members" USING btree ("user_id") WHERE "members"."removed_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_slug_unique" ON "organizations" USING btree ("slug");--> statement-breakpoint
CREATE POLICY "invitations_organization_isolation" ON "invitations" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid or current_setting('app.system_access', true) = 'on') WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid or current_setting('app.system_access', true) = 'on');--> statement-breakpoint
CREATE POLICY "members_organization_isolation" ON "members" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid or current_setting('app.system_access', true) = 'on') WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid or current_setting('app.system_access', true) = 'on');--> statement-breakpoint
CREATE POLICY "organizations_organization_isolation" ON "organizations" AS PERMISSIVE FOR ALL TO public USING (id = nullif(current_setting('app.organization_id', true), '')::uuid or current_setting('app.system_access', true) = 'on') WITH CHECK (id = nullif(current_setting('app.organization_id', true), '')::uuid or current_setting('app.system_access', true) = 'on');--> statement-breakpoint
-- Added by hand, as the READMEs of @cadenway/nest-common and @cadenway/nest-messaging require:
-- drizzle-kit enables row-level security but does not force it, and without FORCE the owner of a
-- table (the migrator role) would bypass its policy. directory_users holds no organization data and
-- carries no policy.
ALTER TABLE "organizations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "members" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invitations" FORCE ROW LEVEL SECURITY;
