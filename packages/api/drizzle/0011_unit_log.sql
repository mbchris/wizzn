CREATE TYPE "public"."unit_log_level" AS ENUM('info', 'warn', 'error');--> statement-breakpoint
CREATE TABLE "unit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"unit_id" uuid NOT NULL,
	"at" timestamp DEFAULT now() NOT NULL,
	"level" "unit_log_level" DEFAULT 'info' NOT NULL,
	"step" text,
	"message" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "unit_log" ADD CONSTRAINT "unit_log_unit_id_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."unit"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "unit_log_unit_idx" ON "unit_log" USING btree ("unit_id","id");