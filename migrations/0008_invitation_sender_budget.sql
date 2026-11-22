CREATE TABLE "invitation_sender_emails" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"sender_id" uuid NOT NULL,
	"sent_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invitation_sender_emails" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "invitation_sender_emails_sender_sent_index" ON "invitation_sender_emails" USING btree ("sender_id","sent_at");--> statement-breakpoint
CREATE POLICY "invitation_sender_emails_sender_isolation" ON "invitation_sender_emails" AS PERMISSIVE FOR ALL TO public USING (sender_id = nullif(current_setting('app.invitation_sender_id', true), '')::uuid) WITH CHECK (sender_id = nullif(current_setting('app.invitation_sender_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "invitation_sender_emails" FORCE ROW LEVEL SECURITY;
