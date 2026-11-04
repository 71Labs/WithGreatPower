CREATE TYPE "public"."social_draft_status" AS ENUM('pending', 'approved', 'rejected', 'posted', 'expired');--> statement-breakpoint
CREATE TABLE "social_draft_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"detail" jsonb
);
--> statement-breakpoint
CREATE TABLE "social_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"edited_text" text,
	"media_url" text,
	"reply_to" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"source_event" text NOT NULL,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "social_draft_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"posted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "x_handle" text;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "x_tag_ok" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "social_draft_log" ADD CONSTRAINT "social_draft_log_draft_id_social_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."social_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "social_draft_log_draft_idx" ON "social_draft_log" USING btree ("draft_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "social_drafts_source_event_key" ON "social_drafts" USING btree ("source_event");--> statement-breakpoint
CREATE INDEX "social_drafts_created_idx" ON "social_drafts" USING btree ("created_at");