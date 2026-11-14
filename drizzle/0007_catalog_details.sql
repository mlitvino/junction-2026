ALTER TABLE "valio_product" ADD COLUMN "may_contain_allergens" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "valio_product" ADD COLUMN "content_per_base_unit" double precision;--> statement-breakpoint
ALTER TABLE "valio_product" ADD COLUMN "content_unit" text;--> statement-breakpoint
ALTER TABLE "valio_product" ADD COLUMN "nutrition" jsonb;--> statement-breakpoint
ALTER TABLE "valio_product" ADD COLUMN "labels" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "valio_product" ADD COLUMN "claims" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "valio_product" ADD COLUMN "dietary_tags" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
CREATE INDEX "valio_product_allergens_idx" ON "valio_product" USING gin ("allergens");--> statement-breakpoint
CREATE INDEX "valio_product_dietary_tags_idx" ON "valio_product" USING gin ("dietary_tags");--> statement-breakpoint
CREATE INDEX "valio_product_labels_idx" ON "valio_product" USING gin ("labels");