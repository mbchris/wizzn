ALTER TABLE "content_brief" ALTER COLUMN "format" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "unit" ADD COLUMN "pair_id" uuid;--> statement-breakpoint
CREATE INDEX "unit_pair_idx" ON "unit" USING btree ("pair_id");