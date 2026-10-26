CREATE TABLE "visit_orders" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"member_id" text NOT NULL,
	"request" text NOT NULL,
	"price" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"design_id" text,
	"note" text DEFAULT '' NOT NULL,
	"handled_by" text,
	"handled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "visit_orders_member_idx" ON "visit_orders" USING btree ("member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "visit_orders_one_open" ON "visit_orders" USING btree ("member_id") WHERE status = 'pending';