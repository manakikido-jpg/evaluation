CREATE TABLE "omikuji" (
	"member_id" text NOT NULL,
	"date" text NOT NULL,
	"fortune" text NOT NULL,
	"amount" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "omikuji_member_id_date_pk" PRIMARY KEY("member_id","date")
);
