CREATE TABLE "invite_links" (
	"code" text PRIMARY KEY NOT NULL,
	"inviter_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"uses" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "invites" ADD COLUMN "source" text DEFAULT 'answer' NOT NULL;--> statement-breakpoint
CREATE INDEX "invite_links_inviter_idx" ON "invite_links" USING btree ("inviter_id");