CREATE TABLE "casino_profit_shares" (
	"date" text PRIMARY KEY NOT NULL,
	"profit" bigint NOT NULL,
	"percent" integer NOT NULL,
	"paid" bigint DEFAULT 0 NOT NULL,
	"recipients" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"note" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
