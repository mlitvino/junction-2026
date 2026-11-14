CREATE TABLE "audit_event" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"organization_id" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"actor_name" text,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text NOT NULL,
	"summary" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_event_actor_type_check" CHECK ("audit_event"."actor_type" IN ('user', 'agent', 'system'))
);
--> statement-breakpoint
ALTER TABLE "proposal" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "proposal" ADD COLUMN "selection" jsonb;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_event_org_created_idx" ON "audit_event" USING btree ("organization_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_event_resource_idx" ON "audit_event" USING btree ("resource_type","resource_id","created_at");