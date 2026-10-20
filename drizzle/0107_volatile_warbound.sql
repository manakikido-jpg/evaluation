CREATE TABLE "cast_champagnes" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" bigint NOT NULL,
	"customer_id" text NOT NULL,
	"cast_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"bottle" text NOT NULL,
	"bottle_name" text NOT NULL,
	"price" integer NOT NULL,
	"fee" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"paid_at" timestamp with time zone,
	"notice_id" text
);
--> statement-breakpoint
ALTER TABLE "cast_champagnes" ADD CONSTRAINT "cast_champagnes_session_id_cast_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."cast_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cast_champagnes_session_idx" ON "cast_champagnes" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "cast_champagnes_cast_idx" ON "cast_champagnes" USING btree ("cast_id","paid_at");