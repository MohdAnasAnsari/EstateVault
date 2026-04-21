CREATE TYPE "public"."call_type" AS ENUM('audio', 'video');--> statement-breakpoint
CREATE TYPE "public"."call_status" AS ENUM('pending', 'active', 'ended', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."meeting_type" AS ENUM('property_discussion', 'due_diligence', 'offer', 'virtual_viewing');--> statement-breakpoint
CREATE TYPE "public"."meeting_status" AS ENUM('pending', 'confirmed', 'cancelled', 'completed');--> statement-breakpoint
CREATE TYPE "public"."notification_category" AS ENUM('call', 'meeting', 'message', 'offer', 'nda', 'deal_stage', 'listing', 'kyc');--> statement-breakpoint
CREATE TABLE "call_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_room_id" uuid NOT NULL,
	"initiated_by" uuid,
	"participants" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"call_type" "call_type" NOT NULL,
	"status" "call_status" DEFAULT 'ended' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"duration_seconds" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "meeting_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_room_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"meeting_type" "meeting_type" NOT NULL,
	"duration_minutes" integer NOT NULL,
	"timezone" varchar(100) NOT NULL,
	"status" "meeting_status" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "meeting_availability" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_request_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"slots" jsonb NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "meetings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_request_id" uuid NOT NULL,
	"deal_room_id" uuid NOT NULL,
	"meeting_type" "meeting_type" NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"duration_minutes" integer NOT NULL,
	"timezone" varchar(100) NOT NULL,
	"ics_uid" varchar(255) NOT NULL,
	"status" "meeting_status" DEFAULT 'confirmed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"category" "notification_category" NOT NULL,
	"title" varchar(255) NOT NULL,
	"body" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"entity_id" varchar(255),
	"read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"category" "notification_category" NOT NULL,
	"in_app" boolean DEFAULT true NOT NULL,
	"email" boolean DEFAULT true NOT NULL,
	"push" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "web_push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" varchar(500) NOT NULL,
	"p256dh" varchar(255) NOT NULL,
	"auth" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "call_logs" ADD CONSTRAINT "call_logs_deal_room_id_deal_rooms_id_fk" FOREIGN KEY ("deal_room_id") REFERENCES "public"."deal_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_logs" ADD CONSTRAINT "call_logs_initiated_by_users_id_fk" FOREIGN KEY ("initiated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_requests" ADD CONSTRAINT "meeting_requests_deal_room_id_deal_rooms_id_fk" FOREIGN KEY ("deal_room_id") REFERENCES "public"."deal_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_requests" ADD CONSTRAINT "meeting_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_availability" ADD CONSTRAINT "meeting_availability_meeting_request_id_meeting_requests_id_fk" FOREIGN KEY ("meeting_request_id") REFERENCES "public"."meeting_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_availability" ADD CONSTRAINT "meeting_availability_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_meeting_request_id_meeting_requests_id_fk" FOREIGN KEY ("meeting_request_id") REFERENCES "public"."meeting_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_deal_room_id_deal_rooms_id_fk" FOREIGN KEY ("deal_room_id") REFERENCES "public"."deal_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_push_subscriptions" ADD CONSTRAINT "web_push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "call_logs_room_idx" ON "call_logs" USING btree ("deal_room_id");--> statement-breakpoint
CREATE INDEX "call_logs_status_idx" ON "call_logs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "meeting_requests_room_idx" ON "meeting_requests" USING btree ("deal_room_id");--> statement-breakpoint
CREATE INDEX "meeting_requests_status_idx" ON "meeting_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "meeting_availability_request_idx" ON "meeting_availability" USING btree ("meeting_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_availability_unique_idx" ON "meeting_availability" USING btree ("meeting_request_id","user_id");--> statement-breakpoint
CREATE INDEX "meetings_room_idx" ON "meetings" USING btree ("deal_room_id");--> statement-breakpoint
CREATE INDEX "meetings_status_idx" ON "meetings" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "meetings_request_unique_idx" ON "meetings" USING btree ("meeting_request_id");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notifications_read_idx" ON "notifications" USING btree ("read");--> statement-breakpoint
CREATE INDEX "notifications_created_idx" ON "notifications" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "notification_prefs_user_idx" ON "notification_preferences" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_prefs_unique_idx" ON "notification_preferences" USING btree ("user_id","category");--> statement-breakpoint
CREATE INDEX "web_push_subscriptions_user_idx" ON "web_push_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "web_push_subscriptions_unique_idx" ON "web_push_subscriptions" USING btree ("user_id","endpoint");
