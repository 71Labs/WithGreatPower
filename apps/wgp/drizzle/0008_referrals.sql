CREATE TABLE "referral_rewards" (
	"player_id" uuid PRIMARY KEY NOT NULL,
	"goal" integer NOT NULL,
	"friends" jsonb NOT NULL,
	"xp" integer NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "referral_code" text;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "referred_by" uuid;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "referred_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "referral_rewards" ADD CONSTRAINT "referral_rewards_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_referred_by_players_id_fk" FOREIGN KEY ("referred_by") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "players_referral_code_key" ON "players" USING btree ("referral_code");--> statement-breakpoint
CREATE INDEX "players_referred_by_idx" ON "players" USING btree ("referred_by") WHERE referred_by IS NOT NULL;