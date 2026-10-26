CREATE TABLE "visit_design_grants" (
	"member_id" text NOT NULL,
	"design_id" text NOT NULL,
	"granted_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "visit_design_grants_member_id_design_id_pk" PRIMARY KEY("member_id","design_id")
);
