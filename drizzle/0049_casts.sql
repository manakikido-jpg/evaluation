CREATE TABLE "cast_images" (
	"key" text PRIMARY KEY NOT NULL,
	"content_type" text NOT NULL,
	"data" "bytea" NOT NULL,
	"hash" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cast_sessions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"cast_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"plan" text NOT NULL,
	"minutes" integer NOT NULL,
	"price" integer NOT NULL,
	"status" text NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL,
	"channel_id" text,
	"thread_id" text,
	"start_at" timestamp with time zone,
	"accept_by" timestamp with time zone,
	"started_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"delete_at" timestamp with time zone,
	"warned" boolean DEFAULT false NOT NULL,
	"extensions" integer DEFAULT 0 NOT NULL,
	"paid" integer DEFAULT 0 NOT NULL,
	"rating" integer,
	"decided_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cast_sessions_price" CHECK ("cast_sessions"."price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "casts" (
	"member_id" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"bio" text DEFAULT '' NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"price_30" integer DEFAULT 0 NOT NULL,
	"price_60" integer DEFAULT 0 NOT NULL,
	"price_night" integer DEFAULT 0 NOT NULL,
	"minor_ok" boolean DEFAULT true NOT NULL,
	"available" text DEFAULT 'off' NOT NULL,
	"waiting_until" timestamp with time zone,
	"blocked" text[] DEFAULT '{}'::text[] NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp with time zone,
	"approved_by" text
);
--> statement-breakpoint
CREATE INDEX "cast_sessions_status_idx" ON "cast_sessions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "cast_sessions_cast_idx" ON "cast_sessions" USING btree ("cast_id","created_at");