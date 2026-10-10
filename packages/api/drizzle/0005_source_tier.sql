ALTER TABLE "source" ADD COLUMN "tier" smallint DEFAULT 4 NOT NULL;--> statement-breakpoint
ALTER TABLE "source" ADD COLUMN "provider" text DEFAULT 'web' NOT NULL;