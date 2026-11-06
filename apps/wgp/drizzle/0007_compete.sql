ALTER TYPE "public"."board_kind" ADD VALUE 'daily';--> statement-breakpoint
ALTER TYPE "public"."board_kind" ADD VALUE 'trial';--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "course" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "ghost_run_id" uuid;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_ghost_run_id_runs_id_fk" FOREIGN KEY ("ghost_run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "runs_player_ghost_idx" ON "runs" USING btree ("player_id","ghost_run_id") WHERE ghost_run_id IS NOT NULL;