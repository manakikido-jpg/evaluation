CREATE TABLE "member_buffs" (
	"member_id" text NOT NULL,
	"kind" text NOT NULL,
	"until" timestamp with time zone,
	"remaining" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "member_buffs_member_id_kind_pk" PRIMARY KEY("member_id","kind")
);
--> statement-breakpoint
CREATE TABLE "name_decos" (
	"member_id" text PRIMARY KEY NOT NULL,
	"emoji" text NOT NULL,
	"base_nick" text,
	"until" timestamp with time zone NOT NULL
);
