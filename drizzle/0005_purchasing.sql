CREATE TABLE "approval" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"proposal_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"proposal_hash" text NOT NULL,
	"status" text NOT NULL,
	"requested_by" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"comment" text,
	CONSTRAINT "approval_proposal_id_unique" UNIQUE("proposal_id"),
	CONSTRAINT "approval_status_check" CHECK ("approval"."status" IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'))
);
--> statement-breakpoint
CREATE TABLE "proposal" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"organization_id" text NOT NULL,
	"created_by" text NOT NULL,
	"status" text NOT NULL,
	"lines" jsonb NOT NULL,
	"total_excl_vat" double precision,
	"currency" text NOT NULL,
	"pricing_date" date NOT NULL,
	"price_source" text NOT NULL,
	"outcome" text NOT NULL,
	"decision" jsonb NOT NULL,
	"hash" text NOT NULL,
	"note" text,
	"quote_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "proposal_status_check" CHECK ("proposal"."status" IN ('READY', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'BLOCKED', 'ORDERED', 'CANCELLED')),
	CONSTRAINT "proposal_outcome_check" CHECK ("proposal"."outcome" IN ('ALLOW', 'REQUIRE_APPROVAL', 'DENY'))
);
--> statement-breakpoint
CREATE TABLE "purchase_order" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"proposal_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"created_by" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"proposal_hash" text NOT NULL,
	"status" text DEFAULT 'SIMULATED_CONFIRMED' NOT NULL,
	"source" text DEFAULT 'LOCAL_SIMULATOR' NOT NULL,
	"lines" jsonb NOT NULL,
	"total_excl_vat" double precision,
	"currency" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_order_proposal_id_unique" UNIQUE("proposal_id"),
	CONSTRAINT "purchase_order_idempotency_key" UNIQUE("organization_id","idempotency_key")
);
--> statement-breakpoint
ALTER TABLE "approval" ADD CONSTRAINT "approval_proposal_id_proposal_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval" ADD CONSTRAINT "approval_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval" ADD CONSTRAINT "approval_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval" ADD CONSTRAINT "approval_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal" ADD CONSTRAINT "proposal_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal" ADD CONSTRAINT "proposal_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_proposal_id_proposal_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_org_status_idx" ON "approval" USING btree ("organization_id","status","requested_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "proposal_org_status_idx" ON "proposal" USING btree ("organization_id","status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "purchase_order_org_created_idx" ON "purchase_order" USING btree ("organization_id","created_at" DESC NULLS LAST);