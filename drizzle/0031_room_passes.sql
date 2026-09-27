CREATE TABLE "room_passes" (
	"member_id" text NOT NULL,
	"kind" text NOT NULL,
	"until" timestamp with time zone NOT NULL,
	CONSTRAINT "room_passes_member_id_kind_pk" PRIMARY KEY("member_id","kind")
);
--> statement-breakpoint
ALTER TABLE "shop_purchases" ADD COLUMN "ticket" text;