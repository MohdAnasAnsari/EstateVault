CREATE TYPE "public"."alert_type" AS ENUM('fraud', 'aml', 'sanctions', 'pep', 'listing');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('not_started', 'pending', 'changes_requested', 'rejected', 'verified');--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "nationality" varchar(100);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "rera_license_expiry" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "off_plan" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "verification_status" "verification_status" DEFAULT 'not_started' NOT NULL;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "seller_verification_feedback" text;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "title_deed_document" jsonb;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "noc_document" jsonb;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "encumbrance_document" jsonb;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "quality_tier_override" "quality_tier";--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "meilisearch_indexed_at" timestamp with time zone;--> statement-breakpoint
CREATE TABLE "kyc_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "kyc_status" DEFAULT 'submitted' NOT NULL,
	"jumio_reference" varchar(120),
	"document_s3_keys" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"financial_capacity_range" varchar(100),
	"asset_type_interests" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	"issue_date" timestamp with time zone,
	"review_reason" text
);--> statement-breakpoint
CREATE TABLE "aml_screenings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"risk_score" integer NOT NULL,
	"pep_match" boolean DEFAULT false NOT NULL,
	"sanctions_match" boolean DEFAULT false NOT NULL,
	"requires_review" boolean DEFAULT false NOT NULL,
	"screened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewer_notes" text
);--> statement-breakpoint
CREATE TABLE "admin_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "alert_type" NOT NULL,
	"title" varchar(200) NOT NULL,
	"target_id" uuid,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" uuid NOT NULL,
	"action" varchar(120) NOT NULL,
	"target_id" varchar(120) NOT NULL,
	"target_type" varchar(80) NOT NULL,
	"ip" varchar(80),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "kyc_submissions" ADD CONSTRAINT "kyc_submissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aml_screenings" ADD CONSTRAINT "aml_screenings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_admin_id_users_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kyc_submissions_user_idx" ON "kyc_submissions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "kyc_submissions_status_idx" ON "kyc_submissions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "aml_screenings_user_idx" ON "aml_screenings" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "aml_screenings_review_idx" ON "aml_screenings" USING btree ("requires_review");--> statement-breakpoint
CREATE INDEX "admin_alerts_type_idx" ON "admin_alerts" USING btree ("type");--> statement-breakpoint
CREATE INDEX "admin_alerts_resolved_idx" ON "admin_alerts" USING btree ("resolved_at");--> statement-breakpoint
CREATE INDEX "audit_log_admin_idx" ON "audit_log" USING btree ("admin_id");--> statement-breakpoint
CREATE INDEX "audit_log_action_idx" ON "audit_log" USING btree ("action");
