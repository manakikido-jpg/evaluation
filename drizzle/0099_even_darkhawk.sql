CREATE TABLE "role_requests" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"member_id" text NOT NULL,
	"role_id" text NOT NULL,
	"minutes" integer,
	"reason" text DEFAULT '' NOT NULL,
	"requested_by" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" text,
	"result" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
