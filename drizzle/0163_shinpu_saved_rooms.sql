CREATE TABLE "shinpu_saved_rooms" (
	"id" text PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"format" integer DEFAULT 1 NOT NULL,
	"revision" integer NOT NULL,
	"seats" jsonb NOT NULL,
	"summary" jsonb NOT NULL,
	"snapshot" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "shinpu_saved_guild_expiry_idx" ON "shinpu_saved_rooms" USING btree ("guild_id","expires_at");