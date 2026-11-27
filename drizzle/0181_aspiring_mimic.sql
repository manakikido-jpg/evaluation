CREATE TABLE "omamori_holdings" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"member_id" text NOT NULL,
	"week" text NOT NULL,
	"bought_at" timestamp with time zone DEFAULT now() NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "omamori_holdings_member_week_idx" ON "omamori_holdings" USING btree ("member_id","week");