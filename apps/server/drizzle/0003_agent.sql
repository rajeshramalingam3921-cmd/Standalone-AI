ALTER TABLE "change_sets" ADD COLUMN "task_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "agent" jsonb;--> statement-breakpoint
ALTER TABLE "change_sets" ADD CONSTRAINT "change_sets_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE restrict ON UPDATE no action;