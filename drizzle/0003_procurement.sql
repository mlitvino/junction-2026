CREATE TABLE "organization_procurement_settings" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"preferences" jsonb NOT NULL,
	"guardrails" jsonb NOT NULL,
	"updated_by_user_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "procurement_audit_event" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"organization_id" text,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"actor_name" text,
	"event_type" text NOT NULL,
	"summary" text NOT NULL,
	"details" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "procurement_order" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text,
	"created_by_user_id" text,
	"status" text NOT NULL,
	"prompt" text NOT NULL,
	"delivery_date" text NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"total_price_eur" double precision NOT NULL,
	"total_price_incl_vat_eur" double precision DEFAULT 0 NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organization_procurement_settings" ADD CONSTRAINT "organization_procurement_settings_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_procurement_settings" ADD CONSTRAINT "organization_procurement_settings_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_audit_event" ADD CONSTRAINT "procurement_audit_event_order_id_procurement_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."procurement_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_order" ADD CONSTRAINT "procurement_order_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_order" ADD CONSTRAINT "procurement_order_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "procurement_audit_event_order_idx" ON "procurement_audit_event" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE INDEX "procurement_order_org_created_idx" ON "procurement_order" USING btree ("organization_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "procurement_order_status_idx" ON "procurement_order" USING btree ("status");