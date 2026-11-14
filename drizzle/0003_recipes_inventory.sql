CREATE TABLE "procurement_inventory_item" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text,
	"ingredient_name" text NOT NULL,
	"product_type" text NOT NULL,
	"linked_product_id" text,
	"quantity_in_stock" double precision DEFAULT 0 NOT NULL,
	"unit" text NOT NULL,
	"min_par_level" double precision,
	"location" text,
	"updated_by_user_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "procurement_recipe" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text,
	"name" text NOT NULL,
	"source" text DEFAULT 'customer' NOT NULL,
	"description" text,
	"base_servings" double precision DEFAULT 10 NOT NULL,
	"ingredients" jsonb NOT NULL,
	"instructions" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "procurement_inventory_item" ADD CONSTRAINT "procurement_inventory_item_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_inventory_item" ADD CONSTRAINT "procurement_inventory_item_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_recipe" ADD CONSTRAINT "procurement_recipe_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_recipe" ADD CONSTRAINT "procurement_recipe_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "procurement_inventory_org_idx" ON "procurement_inventory_item" USING btree ("organization_id","product_type");--> statement-breakpoint
CREATE INDEX "procurement_recipe_org_idx" ON "procurement_recipe" USING btree ("organization_id","name");