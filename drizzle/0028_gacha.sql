CREATE TABLE "gacha_draws" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"member_id" text NOT NULL,
	"tier" text NOT NULL,
	"pity" boolean DEFAULT false NOT NULL,
	"price" integer NOT NULL,
	"role_id" text,
	"ticket" text,
	"ticket_count" integer DEFAULT 0 NOT NULL,
	"coins" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gacha_state" (
	"member_id" text PRIMARY KEY NOT NULL,
	"since_top" integer DEFAULT 0 NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"member_id" text NOT NULL,
	"kind" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tickets_member_id_kind_pk" PRIMARY KEY("member_id","kind")
);
--> statement-breakpoint
ALTER TABLE "temp_voice" ADD COLUMN "free_ticket" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "gacha_draws_member_idx" ON "gacha_draws" USING btree ("member_id","created_at");