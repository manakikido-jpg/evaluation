CREATE TABLE "diaries" (
	"member_id" text PRIMARY KEY NOT NULL,
	"thread_id" text,
	"mode" text DEFAULT 'owner' NOT NULL,
	"bought_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "diaries_thread_id_unique" UNIQUE("thread_id"),
	CONSTRAINT "diaries_mode_check" CHECK ("diaries"."mode" in ('owner', 'everyone'))
);
