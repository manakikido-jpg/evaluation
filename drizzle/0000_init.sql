CREATE TABLE "shuin" (
	"giver_id" text NOT NULL,
	"receiver_id" text NOT NULL,
	"weight" integer NOT NULL,
	"giver_rank" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "shuin_giver_id_receiver_id_pk" PRIMARY KEY("giver_id","receiver_id"),
	CONSTRAINT "shuin_not_self" CHECK ("shuin"."giver_id" <> "shuin"."receiver_id"),
	CONSTRAINT "shuin_weight_positive" CHECK ("shuin"."weight" > 0)
);
--> statement-breakpoint
CREATE INDEX "shuin_receiver_idx" ON "shuin" USING btree ("receiver_id");