CREATE TABLE "sticker_drafts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"author_id" text NOT NULL,
	"author_name" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"tags" text NOT NULL,
	"image_data" "bytea" NOT NULL,
	"image_hash" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"sticker_id" text,
	"decided_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "sticker_drafts_author_idx" ON "sticker_drafts" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "sticker_drafts_status_idx" ON "sticker_drafts" USING btree ("status");