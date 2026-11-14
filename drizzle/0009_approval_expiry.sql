ALTER TABLE "approval" DROP CONSTRAINT "approval_status_check";--> statement-breakpoint
ALTER TABLE "proposal" DROP CONSTRAINT "proposal_status_check";--> statement-breakpoint
ALTER TABLE "approval" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "approval" ADD CONSTRAINT "approval_status_check" CHECK ("approval"."status" IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED'));--> statement-breakpoint
ALTER TABLE "proposal" ADD CONSTRAINT "proposal_status_check" CHECK ("proposal"."status" IN ('READY', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'BLOCKED', 'ORDERED', 'CANCELLED', 'EXPIRED'));