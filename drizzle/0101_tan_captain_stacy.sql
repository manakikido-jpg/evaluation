CREATE TABLE "presence_gifts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"ticket_kind" text,
	"amount" integer NOT NULL,
	"note" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reason" text,
	"count" integer DEFAULT 0 NOT NULL,
	"done_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "presence_gifts_status" ON "presence_gifts" USING btree ("status");