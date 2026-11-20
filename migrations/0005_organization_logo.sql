CREATE TABLE "organization_logo_reservations" (
	"organization_id" uuid NOT NULL,
	"upload_id" uuid NOT NULL,
	"uploader_user_id" uuid NOT NULL,
	"generation" integer NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"state" text NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL,
	"request_key_digest" text,
	"request_key_expires_at" timestamp (3) with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_logo_reservations_pkey" PRIMARY KEY("organization_id","upload_id"),
	CONSTRAINT "organization_logo_reservations_generation_check" CHECK ("organization_logo_reservations"."generation" >= 0),
	CONSTRAINT "organization_logo_reservations_size_check" CHECK ("organization_logo_reservations"."size_bytes" between 1 and 5242880),
	CONSTRAINT "organization_logo_reservations_content_type_check" CHECK ("organization_logo_reservations"."content_type" in ('image/png', 'image/svg+xml')),
	CONSTRAINT "organization_logo_reservations_state_check" CHECK ("organization_logo_reservations"."state" in ('pending', 'committed', 'expired', 'superseded')),
	CONSTRAINT "organization_logo_reservations_receipt_check" CHECK (("organization_logo_reservations"."request_key_digest" is null) = ("organization_logo_reservations"."request_key_expires_at" is null))
);
--> statement-breakpoint
ALTER TABLE "organization_logo_reservations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "organization_logo_reservations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "logo_id" uuid;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "logo_generation" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_logo_reservations" ADD CONSTRAINT "organization_logo_reservations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "organization_logo_reservations_actor_key_unique" ON "organization_logo_reservations" USING btree ("organization_id","uploader_user_id","request_key_digest") WHERE "organization_logo_reservations"."request_key_digest" is not null;--> statement-breakpoint
CREATE INDEX "organization_logo_reservations_pending_expiry_index" ON "organization_logo_reservations" USING btree ("expires_at","organization_id","upload_id") WHERE "organization_logo_reservations"."state" = 'pending';--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_logo_generation_check" CHECK ("organizations"."logo_generation" >= 0);--> statement-breakpoint
CREATE POLICY "organization_logo_reservations_organization_isolation" ON "organization_logo_reservations" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid or current_setting('app.system_access', true) = 'on') WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid or current_setting('app.system_access', true) = 'on');
