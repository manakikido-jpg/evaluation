CREATE TABLE "notice_images" (
	"notice_id" bigint PRIMARY KEY NOT NULL,
	"content_type" text NOT NULL,
	"data" bytea NOT NULL,
	"hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notices" ADD COLUMN "image_hash" text;--> statement-breakpoint
ALTER TABLE "notices" ADD COLUMN "image_position" text DEFAULT 'bottom' NOT NULL;--> statement-breakpoint
ALTER TABLE "notices" ADD COLUMN "posted_image" text;--> statement-breakpoint
ALTER TABLE "notice_images" ADD CONSTRAINT "notice_images_notice_id_notices_id_fk" FOREIGN KEY ("notice_id") REFERENCES "public"."notices"("id") ON DELETE cascade ON UPDATE no action;