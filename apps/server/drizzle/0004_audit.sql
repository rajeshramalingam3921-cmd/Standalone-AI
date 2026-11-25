CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"project_id" uuid,
	"target_type" text,
	"target_id" text,
	"detail" jsonb NOT NULL,
	CONSTRAINT "audit_events_actor_check" CHECK ("audit_events"."actor" IN ('owner', 'agent', 'system'))
);
--> statement-breakpoint
CREATE INDEX "audit_events_at_idx" ON "audit_events" USING btree ("at");--> statement-breakpoint
CREATE INDEX "audit_events_project_at_idx" ON "audit_events" USING btree ("project_id","at");--> statement-breakpoint
-- Audit events are append-only: refuse UPDATE and DELETE at the database level.
CREATE OR REPLACE FUNCTION audit_events_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER audit_events_no_update_delete
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_append_only();
