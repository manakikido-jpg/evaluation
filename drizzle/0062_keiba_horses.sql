CREATE TABLE "keiba_horses" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"style" integer NOT NULL,
	"spd_milli" integer NOT NULL,
	"sta_milli" integer NOT NULL,
	"apt" integer NOT NULL,
	"surf" integer NOT NULL,
	"coat" integer NOT NULL,
	"silk" jsonb NOT NULL,
	"starts" integer DEFAULT 0 NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"seconds" integer DEFAULT 0 NOT NULL,
	"thirds" integer DEFAULT 0 NOT NULL,
	"recent" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
