CREATE TYPE "public"."unit_link_kind" AS ENUM('series', 'related');--> statement-breakpoint
CREATE TABLE "unit_link" (
	"from_unit_id" uuid NOT NULL,
	"to_unit_id" uuid NOT NULL,
	"kind" "unit_link_kind" NOT NULL,
	"score" real NOT NULL,
	CONSTRAINT "unit_link_from_unit_id_to_unit_id_pk" PRIMARY KEY("from_unit_id","to_unit_id")
);
--> statement-breakpoint
CREATE TABLE "saved_unit" (
	"user_id" text NOT NULL,
	"unit_id" uuid NOT NULL,
	"saved_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "saved_unit_user_id_unit_id_pk" PRIMARY KEY("user_id","unit_id")
);
--> statement-breakpoint
CREATE TABLE "unit_feedback" (
	"user_id" text NOT NULL,
	"unit_id" uuid NOT NULL,
	"vote" smallint NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "unit_feedback_user_id_unit_id_pk" PRIMARY KEY("user_id","unit_id")
);
--> statement-breakpoint
ALTER TABLE "content_brief" ADD COLUMN "level" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "content_brief" ADD COLUMN "series" text;--> statement-breakpoint
ALTER TABLE "content_brief" ADD COLUMN "cross_field_id" uuid;--> statement-breakpoint
ALTER TABLE "unit" ADD COLUMN "level" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "unit" ADD COLUMN "series" text;--> statement-breakpoint
ALTER TABLE "unit_link" ADD CONSTRAINT "unit_link_from_unit_id_unit_id_fk" FOREIGN KEY ("from_unit_id") REFERENCES "public"."unit"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_link" ADD CONSTRAINT "unit_link_to_unit_id_unit_id_fk" FOREIGN KEY ("to_unit_id") REFERENCES "public"."unit"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_unit" ADD CONSTRAINT "saved_unit_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_unit" ADD CONSTRAINT "saved_unit_unit_id_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."unit"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_feedback" ADD CONSTRAINT "unit_feedback_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_feedback" ADD CONSTRAINT "unit_feedback_unit_id_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."unit"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "saved_user_at_idx" ON "saved_unit" USING btree ("user_id","saved_at");--> statement-breakpoint
CREATE INDEX "feedback_user_created_idx" ON "unit_feedback" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "content_brief" ADD CONSTRAINT "content_brief_cross_field_id_field_id_fk" FOREIGN KEY ("cross_field_id") REFERENCES "public"."field"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "unit_series_idx" ON "unit" USING btree ("series","level");