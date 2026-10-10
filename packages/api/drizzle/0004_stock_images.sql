CREATE TYPE "public"."asset_origin" AS ENUM('generated', 'stock');--> statement-breakpoint
ALTER TABLE "asset" ADD COLUMN "origin" "asset_origin" DEFAULT 'generated' NOT NULL;--> statement-breakpoint
ALTER TABLE "asset" ADD COLUMN "credit" jsonb;--> statement-breakpoint
ALTER TABLE "asset" ADD COLUMN "stock_query" text;--> statement-breakpoint
ALTER TABLE "asset" ADD COLUMN "prompt" text;--> statement-breakpoint
ALTER TABLE "asset" ADD COLUMN "rejected_stock_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;