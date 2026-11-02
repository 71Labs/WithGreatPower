CREATE TYPE "public"."auth_kind" AS ENUM('near_auth', 'wallet', 'dev');--> statement-breakpoint
CREATE TYPE "public"."board_kind" AS ENUM('tonight', 'season', 'alltime');--> statement-breakpoint
CREATE TYPE "public"."chain_op_status" AS ENUM('pending', 'sending', 'sent', 'failed', 'dead');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('issued', 'verified', 'rejected', 'expired');--> statement-breakpoint
CREATE TYPE "public"."season_status" AS ENUM('scheduled', 'live', 'closed', 'recorded');--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id_hash" text PRIMARY KEY NOT NULL,
	"player_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ua" text,
	"ip_hash" text
);
--> statement-breakpoint
CREATE TABLE "budget_counters" (
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"period" text NOT NULL,
	"count" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_counters_scope_key_period_pk" PRIMARY KEY("scope","key","period")
);
--> statement-breakpoint
CREATE TABLE "chain_ops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"player_id" uuid,
	"payload" jsonb NOT NULL,
	"status" "chain_op_status" DEFAULT 'pending' NOT NULL,
	"tx_hash" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "items_mirror" (
	"account_id" text NOT NULL,
	"token_id" text NOT NULL,
	"balance" bigint DEFAULT 0 NOT NULL,
	"player_id" uuid,
	"block_height" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "items_mirror_account_id_token_id_pk" PRIMARY KEY("account_id","token_id")
);
--> statement-breakpoint
CREATE TABLE "leaderboard_entries" (
	"board" "board_kind" NOT NULL,
	"period_key" text NOT NULL,
	"player_id" uuid NOT NULL,
	"best_score" integer NOT NULL,
	"ticks" integer DEFAULT 0 NOT NULL,
	"run_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leaderboard_entries_board_period_key_player_id_pk" PRIMARY KEY("board","period_key","player_id")
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"near_account_id" text NOT NULL,
	"auth_kind" "auth_kind" NOT NULL,
	"auth_sub" text,
	"handle" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"banned_at" timestamp with time zone,
	"migrated_local_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"mode" text DEFAULT 'patrol' NOT NULL,
	"night" integer NOT NULL,
	"seed" bigint NOT NULL,
	"ruleset" text NOT NULL,
	"save_rev_at_start" integer NOT NULL,
	"start_save" jsonb NOT NULL,
	"status" "run_status" DEFAULT 'issued' NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"submitted_at" timestamp with time zone,
	"input_log" "bytea",
	"log_bytes" integer,
	"ticks" integer,
	"client_hash" text,
	"verified_score" integer,
	"stats" jsonb,
	"checkpoints" jsonb,
	"digest" text,
	"reject_reason" text,
	"assist" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saves" (
	"player_id" uuid PRIMARY KEY NOT NULL,
	"state" jsonb NOT NULL,
	"rev" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seasons" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" "season_status" DEFAULT 'scheduled' NOT NULL,
	"root" text,
	"top10" jsonb,
	"digest" text,
	"record_tx" text,
	"recorded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "session_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_key" text NOT NULL,
	"player_id" uuid NOT NULL,
	"device_label" text,
	"add_tx" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chain_ops" ADD CONSTRAINT "chain_ops_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items_mirror" ADD CONSTRAINT "items_mirror_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaderboard_entries" ADD CONSTRAINT "leaderboard_entries_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaderboard_entries" ADD CONSTRAINT "leaderboard_entries_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saves" ADD CONSTRAINT "saves_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_keys" ADD CONSTRAINT "session_keys_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_sessions_player_idx" ON "auth_sessions" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "auth_sessions_expires_idx" ON "auth_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "chain_ops_dedupe_key" ON "chain_ops" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "chain_ops_status_next_idx" ON "chain_ops" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "items_mirror_player_idx" ON "items_mirror" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "leaderboard_rank_idx" ON "leaderboard_entries" USING btree ("board","period_key","best_score" DESC NULLS LAST,"ticks","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "players_near_account_id_key" ON "players" USING btree ("near_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "players_auth_sub_key" ON "players" USING btree ("auth_sub");--> statement-breakpoint
CREATE INDEX "runs_player_status_idx" ON "runs" USING btree ("player_id","status");--> statement-breakpoint
CREATE INDEX "runs_status_expires_idx" ON "runs" USING btree ("status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "runs_one_issued_per_player" ON "runs" USING btree ("player_id") WHERE status = 'issued';--> statement-breakpoint
CREATE UNIQUE INDEX "session_keys_public_key_key" ON "session_keys" USING btree ("public_key");--> statement-breakpoint
CREATE INDEX "session_keys_player_idx" ON "session_keys" USING btree ("player_id");