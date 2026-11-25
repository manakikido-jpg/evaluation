CREATE TABLE "ema_keep_warn" (
	"member_id" text PRIMARY KEY NOT NULL,
	"reached_keep" boolean DEFAULT false NOT NULL,
	"warned_at" timestamp with time zone
);
