CREATE TABLE "organization_seat_entitlements" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"plan" text NOT NULL,
	"seat_limit" bigint NOT NULL,
	"version" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_seat_entitlements_plan_check" CHECK (char_length("organization_seat_entitlements"."plan") > 0),
	CONSTRAINT "organization_seat_entitlements_limit_check" CHECK ("organization_seat_entitlements"."seat_limit" between 5 and 9007199254740991),
	CONSTRAINT "organization_seat_entitlements_version_check" CHECK ("organization_seat_entitlements"."version" between 1 and 9007199254740991)
);
--> statement-breakpoint
ALTER TABLE "organization_seat_entitlements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "organization_seat_entitlements" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "organization_seat_entitlements" ADD CONSTRAINT "organization_seat_entitlements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "organization_seat_entitlements_organization_isolation" ON "organization_seat_entitlements" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid or current_setting('app.system_access', true) = 'on') WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid or current_setting('app.system_access', true) = 'on');
