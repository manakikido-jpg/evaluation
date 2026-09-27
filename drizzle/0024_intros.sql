CREATE TABLE "intros" (
	"member_id" text PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"message_id" text NOT NULL,
	"excerpt" text DEFAULT '' NOT NULL,
	"posted_at" timestamp with time zone NOT NULL
);
