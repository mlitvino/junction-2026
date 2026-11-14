CREATE TABLE "preference_layer" (
	"organization_id" text NOT NULL,
	"scope" text NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"locked" text[] DEFAULT '{}' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "preference_layer_organization_id_scope_pk" PRIMARY KEY("organization_id","scope"),
	CONSTRAINT "preference_layer_scope_check" CHECK ("preference_layer"."scope" IN ('base', 'buyer', 'approver'))
);
--> statement-breakpoint
ALTER TABLE "preference_layer" ADD CONSTRAINT "preference_layer_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preference_layer" ADD CONSTRAINT "preference_layer_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;