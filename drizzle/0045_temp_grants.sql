CREATE TABLE "temp_grants" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"member_id" text NOT NULL,
	"role_id" text,
	"channel_id" text,
	"preset" text,
	"prev_allow" text,
	"prev_deny" text,
	"reason" text DEFAULT '' NOT NULL,
	"granted_by" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"ended_by" text,
	"end_reason" text
);
--> statement-breakpoint
CREATE INDEX "temp_grants_active_idx" ON "temp_grants" USING btree ("ended_at","expires_at");--> statement-breakpoint
CREATE INDEX "temp_grants_member_idx" ON "temp_grants" USING btree ("member_id");