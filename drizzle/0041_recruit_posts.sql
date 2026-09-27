CREATE TABLE "recruit_posts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"member_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "recruit_posts_member_idx" ON "recruit_posts" USING btree ("member_id","created_at");--> statement-breakpoint
CREATE INDEX "recruit_posts_channel_idx" ON "recruit_posts" USING btree ("channel_id","created_at");