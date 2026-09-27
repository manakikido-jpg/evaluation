CREATE TABLE "gift_batches" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"nonce" text NOT NULL,
	"item" text NOT NULL,
	"label" text NOT NULL,
	"count" integer NOT NULL,
	"note" text NOT NULL,
	"role_id" text,
	"recipients" integer NOT NULL,
	"by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gift_batches_nonce_unique" UNIQUE("nonce")
);
