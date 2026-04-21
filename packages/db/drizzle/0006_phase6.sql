-- Phase 6: Off-Market Buyer Briefs, Portfolio Tracker, Deal Teams, Translation Cache

CREATE TABLE IF NOT EXISTS "buyer_briefs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "title" varchar(255) NOT NULL,
  "asset_types" jsonb NOT NULL DEFAULT '[]',
  "cities" jsonb NOT NULL DEFAULT '[]',
  "min_price" numeric(18,2),
  "max_price" numeric(18,2),
  "currency" varchar(10) NOT NULL DEFAULT 'AED',
  "min_size_sqm" integer,
  "max_size_sqm" integer,
  "min_bedrooms" integer,
  "max_bedrooms" integer,
  "description" text,
  "embedding" vector(1536),
  "status" varchar(50) NOT NULL DEFAULT 'active',
  "matched_listing_ids" jsonb NOT NULL DEFAULT '[]',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "buyer_briefs_user_idx" ON "buyer_briefs" ("user_id");
CREATE INDEX IF NOT EXISTS "buyer_briefs_status_idx" ON "buyer_briefs" ("status");

CREATE TABLE IF NOT EXISTS "portfolio_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "listing_id" uuid REFERENCES "listings"("id") ON DELETE SET NULL,
  "listing_snapshot" jsonb NOT NULL DEFAULT '{}',
  "stage" varchar(50) NOT NULL DEFAULT 'saved',
  "custom_label" varchar(255),
  "ai_insight" text,
  "last_ai_insight_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "portfolio_entries_user_idx" ON "portfolio_entries" ("user_id");
CREATE INDEX IF NOT EXISTS "portfolio_entries_stage_idx" ON "portfolio_entries" ("stage");
CREATE UNIQUE INDEX IF NOT EXISTS "portfolio_entries_unique_idx" ON "portfolio_entries" ("user_id", "listing_id");

CREATE TABLE IF NOT EXISTS "portfolio_notes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "entry_id" uuid NOT NULL REFERENCES "portfolio_entries"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "encrypted_note" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "portfolio_notes_entry_idx" ON "portfolio_notes" ("entry_id");

CREATE TABLE IF NOT EXISTS "deal_team_members" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "deal_room_id" uuid NOT NULL REFERENCES "deal_rooms"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "role" varchar(50) NOT NULL DEFAULT 'observer',
  "pseudonym" varchar(100),
  "invited_by" uuid REFERENCES "users"("id"),
  "accepted_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "deal_team_members_unique_idx" UNIQUE ("deal_room_id", "user_id")
);

CREATE INDEX IF NOT EXISTS "deal_team_members_deal_room_idx" ON "deal_team_members" ("deal_room_id");

CREATE TABLE IF NOT EXISTS "translation_cache" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "content_hash" varchar(64) NOT NULL,
  "target_language" varchar(10) NOT NULL,
  "translated_text" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL,
  CONSTRAINT "translation_cache_unique_idx" UNIQUE ("content_hash", "target_language")
);

CREATE INDEX IF NOT EXISTS "translation_cache_expires_idx" ON "translation_cache" ("expires_at");
