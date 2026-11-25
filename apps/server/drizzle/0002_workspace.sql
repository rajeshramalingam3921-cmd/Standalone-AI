CREATE TABLE "change_sets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"source" text NOT NULL,
	"status" text NOT NULL,
	"files" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "change_sets_status_check" CHECK ("change_sets"."status" IN ('pending', 'applied', 'rejected', 'reverted')),
	CONSTRAINT "change_sets_source_check" CHECK ("change_sets"."source" IN ('user', 'agent'))
);
--> statement-breakpoint
CREATE TABLE "command_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"argv" jsonb NOT NULL,
	"status" text NOT NULL,
	"exit_code" integer,
	"output" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "command_runs_name_check" CHECK ("command_runs"."name" IN ('build', 'test', 'lint')),
	CONSTRAINT "command_runs_status_check" CHECK ("command_runs"."status" IN ('running', 'passed', 'failed', 'timeout', 'error'))
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "commands" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "change_sets" ADD CONSTRAINT "change_sets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "command_runs" ADD CONSTRAINT "command_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "change_sets_project_created_idx" ON "change_sets" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "command_runs_project_started_idx" ON "command_runs" USING btree ("project_id","started_at");