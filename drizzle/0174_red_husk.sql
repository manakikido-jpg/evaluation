DROP INDEX "ticket_notices_dedupe_idx";--> statement-breakpoint
ALTER TABLE "ticket_notices" ADD COLUMN "cycle" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_notices_dedupe_idx" ON "ticket_notices" USING btree ("ticket_id","cycle","dedupe");