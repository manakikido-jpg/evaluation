CREATE TABLE "role_templates" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"bits" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_templates_name_unique" UNIQUE("name")
);
