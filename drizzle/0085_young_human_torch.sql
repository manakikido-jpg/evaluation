CREATE TABLE "employee_payroll" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"member_id" text NOT NULL,
	"job" text NOT NULL,
	"source_id" text NOT NULL,
	"visitor_id" text NOT NULL,
	"date" text NOT NULL,
	"amount" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employee_payroll_amount_check" CHECK ("employee_payroll"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "guide_employees" (
	"member_id" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"waiting" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guide_receptions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"visitor_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"guide_id" text,
	"message_id" text,
	"notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "employee_payroll_source_idx" ON "employee_payroll" USING btree ("job","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "employee_payroll_visitor_day_idx" ON "employee_payroll" USING btree ("job","visitor_id","date");