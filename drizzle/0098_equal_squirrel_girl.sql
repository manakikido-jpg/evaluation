CREATE TABLE "security_watch" (
	"member_id" text PRIMARY KEY NOT NULL,
	"reason" text NOT NULL,
	"added_by" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
