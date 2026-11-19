CREATE TABLE "ema" (
	"giver_id" text NOT NULL,
	"receiver_id" text NOT NULL,
	"tier" text NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "ema_giver_id_receiver_id_tier_pk" PRIMARY KEY("giver_id","receiver_id","tier"),
	CONSTRAINT "ema_not_self" CHECK ("ema"."giver_id" <> "ema"."receiver_id")
);
--> statement-breakpoint
CREATE INDEX "ema_receiver_idx" ON "ema" USING btree ("receiver_id","tier");