CREATE TABLE "casino_style_draws" (
	"member_id" text NOT NULL,
	"request_id" text NOT NULL,
	"results" jsonb NOT NULL,
	"cost" integer NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "casino_style_draws_member_id_request_id_pk" PRIMARY KEY("member_id","request_id")
);
--> statement-breakpoint
CREATE TABLE "casino_styles" (
	"member_id" text PRIMARY KEY NOT NULL,
	"owned" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"equipped" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"trial_key" text,
	"trial_until" timestamp with time zone,
	"tickets" integer DEFAULT 0 NOT NULL,
	"pity" integer DEFAULT 0 NOT NULL
);
