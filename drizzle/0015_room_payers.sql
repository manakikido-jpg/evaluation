CREATE TABLE "room_payers" (
	"channel_id" text NOT NULL,
	"member_id" text NOT NULL,
	"paid_until" timestamp with time zone NOT NULL,
	"unpaid_since" timestamp with time zone,
	CONSTRAINT "room_payers_channel_id_member_id_pk" PRIMARY KEY("channel_id","member_id")
);
