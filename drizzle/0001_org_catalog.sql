-- pg_trgm powers the trigram index on valio_product.search_text (added by hand: drizzle-kit
-- doesn't manage extensions). Bundled with the pgvector/pgvector image.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE TABLE "valio_availability_snapshot" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"requested_date" date NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text NOT NULL,
	"sales_block" boolean NOT NULL,
	"logistic_model" text,
	"closing_time" text,
	"available_amount" double precision,
	"available_date" text,
	"sales_unit" text
);
--> statement-breakpoint
CREATE TABLE "valio_price_snapshot" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"pricing_date" date NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text NOT NULL,
	"currency" text,
	"price_excl_vat" double precision,
	"price_incl_vat" double precision,
	"vat_rate" double precision,
	"list_price_excl_vat" double precision,
	"comparison_price" double precision,
	"comparison_unit" text,
	"customer_price" boolean NOT NULL,
	"valid_from" text,
	"valid_to" text,
	"error" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "valio_product" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"name_fi" text,
	"name_sv" text,
	"brand" text,
	"vendor_name" text NOT NULL,
	"category" text NOT NULL,
	"sales_unit" text NOT NULL,
	"base_unit" text NOT NULL,
	"gtin" text,
	"synkka_gtin" text,
	"allowed_lot_size" double precision NOT NULL,
	"temperature_condition" integer,
	"storage_temp_min" double precision,
	"storage_temp_max" double precision,
	"country_of_origin" text,
	"vat_code" text,
	"variable_weight" boolean,
	"net_weight_kg" double precision,
	"co2_per_kg" double precision,
	"co2_per_base_unit" double precision,
	"delivery_reliability" double precision,
	"has_image" boolean DEFAULT false NOT NULL,
	"allergens" text[] DEFAULT '{}' NOT NULL,
	"synkka_updated_at" timestamp with time zone,
	"search_text" text NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "valio_product_substitute" (
	"product_id" text NOT NULL,
	"substitute_id" text NOT NULL,
	CONSTRAINT "valio_product_substitute_product_id_substitute_id_pk" PRIMARY KEY("product_id","substitute_id")
);
--> statement-breakpoint
CREATE TABLE "valio_product_unit" (
	"product_id" text NOT NULL,
	"unit_id" text NOT NULL,
	"gtin" text,
	"size_in_base_units" double precision NOT NULL,
	CONSTRAINT "valio_product_unit_product_id_unit_id_pk" PRIMARY KEY("product_id","unit_id")
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_member" (
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"roles" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_member_organization_id_user_id_pk" PRIMARY KEY("organization_id","user_id"),
	CONSTRAINT "organization_member_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "organization_member_roles_check" CHECK ("organization_member"."roles" <@ ARRAY['buyer', 'approver']::text[] AND cardinality("organization_member"."roles") > 0)
);
--> statement-breakpoint
ALTER TABLE "valio_product_substitute" ADD CONSTRAINT "valio_product_substitute_product_id_valio_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."valio_product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valio_product_unit" ADD CONSTRAINT "valio_product_unit_product_id_valio_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."valio_product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_member" ADD CONSTRAINT "organization_member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_member" ADD CONSTRAINT "organization_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "valio_availability_snapshot_lookup_idx" ON "valio_availability_snapshot" USING btree ("product_id","requested_date","fetched_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "valio_price_snapshot_lookup_idx" ON "valio_price_snapshot" USING btree ("product_id","pricing_date","fetched_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "valio_product_category_idx" ON "valio_product" USING btree ("category");--> statement-breakpoint
CREATE INDEX "valio_product_search_trgm_idx" ON "valio_product" USING gin ("search_text" gin_trgm_ops);