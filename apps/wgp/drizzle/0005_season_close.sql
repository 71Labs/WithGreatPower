ALTER TABLE "seasons" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "seasons" ADD COLUMN "standings" jsonb;