CREATE TABLE "invites" (
	"member_id" text PRIMARY KEY NOT NULL,
	"inviter_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rewarded_at" timestamp with time zone,
	"reward" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX "invites_inviter_idx" ON "invites" USING btree ("inviter_id");