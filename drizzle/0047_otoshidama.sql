CREATE TABLE "otoshidama_bags" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"message_id" text,
	"total" integer NOT NULL,
	"count" integer NOT NULL,
	"shares" integer[] NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"refunded" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "otoshidama_claims" (
	"bag_id" bigint NOT NULL,
	"member_id" text NOT NULL,
	"amount" integer NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "otoshidama_claims_bag_id_member_id_pk" PRIMARY KEY("bag_id","member_id")
);
--> statement-breakpoint
CREATE INDEX "otoshidama_bags_open_idx" ON "otoshidama_bags" USING btree ("ended_at","expires_at");