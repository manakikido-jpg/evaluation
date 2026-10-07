CREATE TABLE "special_goen" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"member_id" text NOT NULL,
	"amount" integer NOT NULL,
	"reason" text NOT NULL,
	"granted_by" text NOT NULL,
	"nonce" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" text,
	"checked_at" timestamp with time zone,
	CONSTRAINT "special_goen_amount_positive" CHECK ("special_goen"."amount" > 0)
);
--> statement-breakpoint
CREATE INDEX "special_goen_member_idx" ON "special_goen" USING btree ("member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "special_goen_nonce_idx" ON "special_goen" USING btree ("nonce");