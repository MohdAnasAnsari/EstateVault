CREATE TYPE "public"."deal_room_file_category" AS ENUM('asset_docs', 'legal', 'financial', 'offers', 'other');--> statement-breakpoint
CREATE TYPE "public"."deal_room_participant_role" AS ENUM('buyer', 'seller', 'legal_advisor', 'agent', 'admin');--> statement-breakpoint
CREATE TYPE "public"."deal_room_status" AS ENUM('interest_expressed', 'pending_nda', 'nda_signed', 'due_diligence', 'offer_submitted', 'offer_accepted', 'closed');--> statement-breakpoint
CREATE TYPE "public"."message_type" AS ENUM('text', 'file', 'system', 'nda', 'offer');--> statement-breakpoint
CREATE TYPE "public"."nda_status" AS ENUM('pending', 'partially_signed', 'signed', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."offer_status" AS ENUM('submitted', 'countered', 'accepted', 'rejected', 'expired', 'withdrawn');--> statement-breakpoint
CREATE TABLE "deal_rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"buyer_id" uuid NOT NULL,
	"seller_id" uuid NOT NULL,
	"agent_id" uuid,
	"created_by_id" uuid NOT NULL,
	"status" "deal_room_status" DEFAULT 'interest_expressed' NOT NULL,
	"nda_status" "nda_status" DEFAULT 'pending' NOT NULL,
	"full_address_revealed" boolean DEFAULT false NOT NULL,
	"commercial_data_unlocked" boolean DEFAULT false NOT NULL,
	"last_message_at" timestamp with time zone,
	"stage_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "deal_room_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_room_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "deal_room_participant_role" NOT NULL,
	"pseudonym" varchar(80) NOT NULL,
	"identity_revealed" boolean DEFAULT false NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone
);--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_room_id" uuid NOT NULL,
	"sender_id" uuid,
	"sender_public_key" text,
	"type" "message_type" DEFAULT 'text' NOT NULL,
	"ciphertext" text,
	"nonce" text,
	"content_preview" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"delivered_to" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"read_by" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reactions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "deal_room_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_room_id" uuid NOT NULL,
	"message_id" uuid,
	"uploaded_by" uuid NOT NULL,
	"category" "deal_room_file_category" DEFAULT 'other' NOT NULL,
	"file_name_encrypted" text NOT NULL,
	"mime_type" varchar(255) NOT NULL,
	"s3_key" varchar(255) NOT NULL,
	"size_bytes" integer NOT NULL,
	"nonce" text NOT NULL,
	"wrapped_keys" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"encrypted_blob_base64" text,
	"downloads" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "ndas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_room_id" uuid NOT NULL,
	"template_version" varchar(50) NOT NULL,
	"parties" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"signature_hashes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "nda_status" DEFAULT 'pending' NOT NULL,
	"pdf_s3_key" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_room_id" uuid NOT NULL,
	"parent_offer_id" uuid,
	"sender_id" uuid NOT NULL,
	"sender_public_key" text NOT NULL,
	"amount" numeric(20, 2) NOT NULL,
	"currency" varchar(3) NOT NULL,
	"conditions_ciphertext" text NOT NULL,
	"conditions_nonce" text NOT NULL,
	"status" "offer_status" DEFAULT 'submitted' NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "deal_rooms" ADD CONSTRAINT "deal_rooms_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_rooms" ADD CONSTRAINT "deal_rooms_buyer_id_users_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_rooms" ADD CONSTRAINT "deal_rooms_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_rooms" ADD CONSTRAINT "deal_rooms_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_rooms" ADD CONSTRAINT "deal_rooms_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_room_participants" ADD CONSTRAINT "deal_room_participants_deal_room_id_deal_rooms_id_fk" FOREIGN KEY ("deal_room_id") REFERENCES "public"."deal_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_room_participants" ADD CONSTRAINT "deal_room_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_deal_room_id_deal_rooms_id_fk" FOREIGN KEY ("deal_room_id") REFERENCES "public"."deal_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_room_files" ADD CONSTRAINT "deal_room_files_deal_room_id_deal_rooms_id_fk" FOREIGN KEY ("deal_room_id") REFERENCES "public"."deal_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_room_files" ADD CONSTRAINT "deal_room_files_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_room_files" ADD CONSTRAINT "deal_room_files_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ndas" ADD CONSTRAINT "ndas_deal_room_id_deal_rooms_id_fk" FOREIGN KEY ("deal_room_id") REFERENCES "public"."deal_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_deal_room_id_deal_rooms_id_fk" FOREIGN KEY ("deal_room_id") REFERENCES "public"."deal_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deal_rooms_listing_idx" ON "deal_rooms" USING btree ("listing_id");--> statement-breakpoint
CREATE INDEX "deal_rooms_status_idx" ON "deal_rooms" USING btree ("status");--> statement-breakpoint
CREATE INDEX "deal_rooms_buyer_idx" ON "deal_rooms" USING btree ("buyer_id");--> statement-breakpoint
CREATE INDEX "deal_rooms_seller_idx" ON "deal_rooms" USING btree ("seller_id");--> statement-breakpoint
CREATE INDEX "deal_room_participants_room_idx" ON "deal_room_participants" USING btree ("deal_room_id");--> statement-breakpoint
CREATE INDEX "deal_room_participants_user_idx" ON "deal_room_participants" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "deal_room_participants_unique_idx" ON "deal_room_participants" USING btree ("deal_room_id","user_id");--> statement-breakpoint
CREATE INDEX "messages_room_idx" ON "messages" USING btree ("deal_room_id");--> statement-breakpoint
CREATE INDEX "messages_sender_idx" ON "messages" USING btree ("sender_id");--> statement-breakpoint
CREATE INDEX "messages_created_idx" ON "messages" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "deal_room_files_room_idx" ON "deal_room_files" USING btree ("deal_room_id");--> statement-breakpoint
CREATE INDEX "deal_room_files_uploaded_by_idx" ON "deal_room_files" USING btree ("uploaded_by");--> statement-breakpoint
CREATE INDEX "deal_room_files_message_idx" ON "deal_room_files" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "deal_room_files_expires_idx" ON "deal_room_files" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ndas_room_unique_idx" ON "ndas" USING btree ("deal_room_id");--> statement-breakpoint
CREATE INDEX "ndas_status_idx" ON "ndas" USING btree ("status");--> statement-breakpoint
CREATE INDEX "offers_room_idx" ON "offers" USING btree ("deal_room_id");--> statement-breakpoint
CREATE INDEX "offers_parent_idx" ON "offers" USING btree ("parent_offer_id");--> statement-breakpoint
CREATE INDEX "offers_sender_idx" ON "offers" USING btree ("sender_id");--> statement-breakpoint
CREATE INDEX "offers_status_idx" ON "offers" USING btree ("status");
