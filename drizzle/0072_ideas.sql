CREATE TABLE "idea_comments" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"idea_id" bigint NOT NULL,
	"body" text NOT NULL,
	"by" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idea_votes" (
	"idea_id" bigint NOT NULL,
	"member_id" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idea_votes_idea_id_member_id_pk" PRIMARY KEY("idea_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "ideas" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"kind" text DEFAULT 'idea' NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idea_comments_idea_idx" ON "idea_comments" USING btree ("idea_id","at");--> statement-breakpoint
CREATE INDEX "ideas_updated_idx" ON "ideas" USING btree ("updated_at");