CREATE TABLE "market_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"on_chain" boolean NOT NULL,
	"price_milli" bigint NOT NULL,
	"stock" integer NOT NULL,
	"till" bigint NOT NULL,
	"side" text,
	"amount" integer,
	"bits" bigint,
	"fee" bigint,
	"account_id" text,
	"tx_hash" text
);
--> statement-breakpoint
CREATE TABLE "market_sim" (
	"id" text PRIMARY KEY NOT NULL,
	"state" jsonb NOT NULL,
	"rev" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "market_prices_item_at_idx" ON "market_prices" USING btree ("item","at");--> statement-breakpoint
CREATE INDEX "market_prices_at_idx" ON "market_prices" USING btree ("at");