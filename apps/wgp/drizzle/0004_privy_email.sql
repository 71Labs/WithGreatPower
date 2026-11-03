ALTER TYPE "public"."auth_kind" ADD VALUE 'privy';--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "email" text;--> statement-breakpoint
CREATE INDEX "players_email_idx" ON "players" USING btree ("email");