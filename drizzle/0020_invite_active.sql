CREATE TABLE "invite_active" (
	"member_id" text NOT NULL,
	"date" text NOT NULL,
	"inviter_id" text NOT NULL,
	"amount" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invite_active_member_id_date_pk" PRIMARY KEY("member_id","date")
);
