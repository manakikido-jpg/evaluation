CREATE TABLE "visit_creator_licenses" (
	"member_id" text PRIMARY KEY NOT NULL,
	"price" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "visit_designs" (
	"id" text PRIMARY KEY NOT NULL,
	"creator_id" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"price" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'private' NOT NULL,
	"data" "bytea" NOT NULL,
	"review_note" text DEFAULT '' NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "visit_purchases" ADD COLUMN "creator_id" text;--> statement-breakpoint
ALTER TABLE "visit_purchases" ADD COLUMN "creator_paid" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "visit_design_creator_idx" ON "visit_designs" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "visit_design_status_idx" ON "visit_designs" USING btree ("status");