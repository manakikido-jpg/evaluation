CREATE TABLE "keiba_shares" (
	"horse_id" bigint NOT NULL,
	"member_id" text NOT NULL,
	"units" integer NOT NULL,
	CONSTRAINT "keiba_shares_horse_id_member_id_pk" PRIMARY KEY("horse_id","member_id")
);
--> statement-breakpoint
ALTER TABLE "keiba_horses" ADD COLUMN "share_price" integer;--> statement-breakpoint
CREATE INDEX "keiba_shares_member_idx" ON "keiba_shares" USING btree ("member_id");