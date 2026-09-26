CREATE TABLE "temp_voice" (
	"channel_id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"hub_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
