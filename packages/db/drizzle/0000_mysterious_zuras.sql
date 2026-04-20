CREATE EXTENSION IF NOT EXISTS pgcrypto;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TYPE "public"."access_tier" AS ENUM('level_1', 'level_2', 'level_3');--> statement-breakpoint
CREATE TYPE "public"."asset_type" AS ENUM('hotel', 'palace', 'heritage_estate', 'development_plot', 'penthouse_tower', 'private_island', 'branded_residence', 'villa', 'commercial_building', 'golf_resort', 'other');--> statement-breakpoint
CREATE TYPE "public"."kyc_status" AS ENUM('pending', 'submitted', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."listing_status" AS ENUM('draft', 'pending_review', 'active', 'paused', 'sold', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."media_type" AS ENUM('photo', 'video', 'floor_plan', 'virtual_tour', 'document');--> statement-breakpoint
CREATE TYPE "public"."quality_tier" AS ENUM('bronze', 'silver', 'gold', 'platinum');--> statement-breakpoint
CREATE TYPE "public"."seller_motivation" AS ENUM('motivated', 'testing_market', 'best_offers', 'fast_close', 'price_flexible');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('buyer', 'seller', 'agent', 'admin');--> statement-breakpoint
CREATE TYPE "public"."visibility" AS ENUM('public', 'verified_buyers', 'off_market');--> statement-breakpoint
CREATE TABLE "exchange_rates_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_currency" varchar(3) NOT NULL,
	"to_currency" varchar(3) NOT NULL,
	"rate" numeric(12, 6) NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "listing_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"type" "media_type" NOT NULL,
	"url" varchar NOT NULL,
	"thumbnail_url" varchar,
	"order_index" integer DEFAULT 0 NOT NULL,
	"ai_quality_score" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_id" uuid NOT NULL,
	"agent_id" uuid,
	"title" varchar(200) NOT NULL,
	"slug" varchar(220) NOT NULL,
	"asset_type" "asset_type" NOT NULL,
	"status" "listing_status" DEFAULT 'draft' NOT NULL,
	"visibility" "visibility" DEFAULT 'public' NOT NULL,
	"price_amount" numeric(20, 2),
	"price_currency" varchar(3) DEFAULT 'AED' NOT NULL,
	"price_on_request" boolean DEFAULT false NOT NULL,
	"country" varchar(100) NOT NULL,
	"city" varchar(100) NOT NULL,
	"district" varchar(100),
	"address_encrypted" text,
	"coordinates_lat" numeric(10, 7),
	"coordinates_lng" numeric(10, 7),
	"size_sqm" numeric(10, 2),
	"bedrooms" integer,
	"bathrooms" integer,
	"floors" integer,
	"year_built" integer,
	"description" text,
	"description_ar" text,
	"key_features" jsonb DEFAULT '[]'::jsonb,
	"commercial_data" jsonb,
	"seller_motivation" "seller_motivation" DEFAULT 'testing_market' NOT NULL,
	"title_deed_verified" boolean DEFAULT false NOT NULL,
	"title_deed_number" varchar(50),
	"listing_quality_score" integer DEFAULT 0 NOT NULL,
	"quality_tier" "quality_tier" DEFAULT 'bronze' NOT NULL,
	"last_seller_confirmation" timestamp with time zone DEFAULT now() NOT NULL,
	"view_count" integer DEFAULT 0 NOT NULL,
	"interest_count" integer DEFAULT 0 NOT NULL,
	"days_on_market" integer DEFAULT 0 NOT NULL,
	"ai_fraud_flag" boolean DEFAULT false NOT NULL,
	"embedding" vector(1536),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "listings_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "saved_listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"listing_id" uuid NOT NULL,
	"notes_encrypted" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"phone" varchar(20),
	"phone_verified" boolean DEFAULT false NOT NULL,
	"password_hash" varchar NOT NULL,
	"role" "user_role" DEFAULT 'buyer' NOT NULL,
	"access_tier" "access_tier" DEFAULT 'level_1' NOT NULL,
	"display_name" varchar(50),
	"real_name_encrypted" text,
	"avatar_url" varchar,
	"kyc_status" "kyc_status" DEFAULT 'pending' NOT NULL,
	"rera_orn" varchar(10),
	"rera_verified" boolean DEFAULT false NOT NULL,
	"preferred_currency" varchar(3) DEFAULT 'AED' NOT NULL,
	"preferred_language" varchar(5) DEFAULT 'en' NOT NULL,
	"public_key" text,
	"encrypted_private_key" text,
	"preference_embedding" vector(1536),
	"stripe_customer_id" varchar,
	"stripe_subscription_id" varchar,
	"expo_push_token" varchar,
	"last_active_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_phone_unique" UNIQUE("phone")
);
--> statement-breakpoint
ALTER TABLE "listing_media" ADD CONSTRAINT "listing_media_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_listings" ADD CONSTRAINT "saved_listings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_listings" ADD CONSTRAINT "saved_listings_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "exchange_rates_unique_idx" ON "exchange_rates_cache" USING btree ("from_currency","to_currency");--> statement-breakpoint
CREATE INDEX "listing_media_listing_idx" ON "listing_media" USING btree ("listing_id");--> statement-breakpoint
CREATE UNIQUE INDEX "listings_slug_idx" ON "listings" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "listings_status_idx" ON "listings" USING btree ("status");--> statement-breakpoint
CREATE INDEX "listings_asset_type_idx" ON "listings" USING btree ("asset_type");--> statement-breakpoint
CREATE INDEX "listings_country_idx" ON "listings" USING btree ("country");--> statement-breakpoint
CREATE INDEX "listings_city_idx" ON "listings" USING btree ("city");--> statement-breakpoint
CREATE INDEX "listings_seller_idx" ON "listings" USING btree ("seller_id");--> statement-breakpoint
CREATE INDEX "listings_price_idx" ON "listings" USING btree ("price_amount");--> statement-breakpoint
CREATE UNIQUE INDEX "saved_listings_unique_idx" ON "saved_listings" USING btree ("user_id","listing_id");--> statement-breakpoint
CREATE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role");
