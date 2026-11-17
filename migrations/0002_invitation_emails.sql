CREATE TABLE "invitation_emails" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"invitation_id" uuid NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invitation_emails" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invitation_emails" ADD CONSTRAINT "invitation_emails_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation_emails" ADD CONSTRAINT "invitation_emails_invitation_id_invitations_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."invitations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invitation_emails_organization_sent_at_index" ON "invitation_emails" USING btree ("organization_id","sent_at");--> statement-breakpoint
CREATE POLICY "invitation_emails_organization_isolation" ON "invitation_emails" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid or current_setting('app.system_access', true) = 'on') WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid or current_setting('app.system_access', true) = 'on');--> statement-breakpoint
-- Added by hand, as the READMEs of @cadenway/nest-common and @cadenway/nest-messaging require:
-- drizzle-kit enables row-level security but does not force it, and without FORCE the owner of a
-- table (the migrator role) would bypass its policy.
ALTER TABLE "invitation_emails" FORCE ROW LEVEL SECURITY;
