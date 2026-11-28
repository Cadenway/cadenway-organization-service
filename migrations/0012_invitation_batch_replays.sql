CREATE TABLE "invitation_batch_replays" (
	"organization_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"key_digest" text NOT NULL,
	"request" jsonb NOT NULL,
	"outcome" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitation_batch_replays_pkey" PRIMARY KEY("organization_id","actor_user_id","key_digest"),
	CONSTRAINT "invitation_batch_replays_key_digest_check" CHECK ("invitation_batch_replays"."key_digest" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "invitation_batch_replays" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invitation_batch_replays" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invitation_batch_replays" ADD CONSTRAINT "invitation_batch_replays_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invitation_batch_replays_organization_expiry_index" ON "invitation_batch_replays" USING btree ("organization_id","expires_at");--> statement-breakpoint
CREATE POLICY "invitation_batch_replays_organization_isolation" ON "invitation_batch_replays" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid or current_setting('app.system_access', true) = 'on') WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid or current_setting('app.system_access', true) = 'on');