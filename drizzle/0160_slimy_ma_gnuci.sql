CREATE TABLE "kiseki_tickets" (
	"id" text PRIMARY KEY NOT NULL,
	"member_id" text NOT NULL,
	"request_id" text NOT NULL,
	"price" integer NOT NULL,
	"seconds" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	CONSTRAINT "kiseki_ticket_price_time" CHECK ("kiseki_tickets"."price"=1500 and "kiseki_tickets"."seconds"=3600),
	CONSTRAINT "kiseki_ticket_period" CHECK (("kiseki_tickets"."started_at" is null and "kiseki_tickets"."ends_at" is null) or ("kiseki_tickets"."started_at" is not null and "kiseki_tickets"."ends_at"="kiseki_tickets"."started_at"+interval '1 hour'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "kiseki_ticket_request" ON "kiseki_tickets" USING btree ("member_id","request_id");--> statement-breakpoint
CREATE INDEX "kiseki_ticket_member" ON "kiseki_tickets" USING btree ("member_id");