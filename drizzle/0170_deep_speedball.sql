CREATE TABLE "goen_perk_claims" (
	"member_id" text NOT NULL,
	"goen" integer NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goen_perk_claims_member_id_goen_pk" PRIMARY KEY("member_id","goen")
);
