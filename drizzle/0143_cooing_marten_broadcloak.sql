CREATE TABLE "guide_threads" (
	"member_id" text PRIMARY KEY NOT NULL,
	"thread_id" text NOT NULL,
	"slot_at" timestamp with time zone,
	"slot_label" text,
	"reminded" boolean DEFAULT false NOT NULL,
	"watched" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "guide_threads_thread_idx" ON "guide_threads" USING btree ("thread_id");