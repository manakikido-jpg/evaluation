CREATE TABLE "ujiko_keep_state" (
	"member_id" text PRIMARY KEY NOT NULL,
	"state" text DEFAULT 'ujiko' NOT NULL,
	"since" timestamp with time zone NOT NULL,
	"next_judge_at" timestamp with time zone,
	"warned_for" timestamp with time zone,
	"held_for" timestamp with time zone,
	"omamori_used_last" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
