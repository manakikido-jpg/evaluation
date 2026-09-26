CREATE TABLE "boost_thanks" (
	"member_id" text NOT NULL,
	"since" timestamp with time zone NOT NULL,
	"announced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_reward_at" timestamp with time zone,
	CONSTRAINT "boost_thanks_member_id_since_pk" PRIMARY KEY("member_id","since")
);
--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "boosting_since" timestamp with time zone;