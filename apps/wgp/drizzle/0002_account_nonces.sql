CREATE TABLE "auth_nonces" (
	"id_hash" text PRIMARY KEY NOT NULL,
	"purpose" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chain_ops" ADD COLUMN "reward_nonce" integer;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "next_reward_nonce" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX "auth_nonces_expires_idx" ON "auth_nonces" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "chain_ops_player_reward_nonce" ON "chain_ops" USING btree ("player_id","reward_nonce") WHERE reward_nonce IS NOT NULL;