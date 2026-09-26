CREATE TABLE "onboarding_done" (
	"member_id" text PRIMARY KEY NOT NULL,
	"reward" integer DEFAULT 0 NOT NULL,
	"done_at" timestamp with time zone DEFAULT now() NOT NULL
);
