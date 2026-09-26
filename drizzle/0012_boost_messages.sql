CREATE TABLE "boost_messages" (
	"message_id" text PRIMARY KEY NOT NULL,
	"member_id" text NOT NULL,
	"count" integer NOT NULL,
	"granted" integer NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
