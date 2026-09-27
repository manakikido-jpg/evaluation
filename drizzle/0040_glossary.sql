CREATE TABLE "glossary_terms" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"category" text NOT NULL,
	"term" text NOT NULL,
	"reading" text DEFAULT '' NOT NULL,
	"emoji" text DEFAULT '' NOT NULL,
	"description" text NOT NULL,
	"aliases" text DEFAULT '' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "glossary_terms_category_idx" ON "glossary_terms" USING btree ("category","position");