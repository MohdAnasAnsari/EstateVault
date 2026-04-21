-- Phase 7: Security & Performance migrations

-- 2FA fields on users
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "totp_secret" text,
  ADD COLUMN IF NOT EXISTS "totp_secret_pending" text,
  ADD COLUMN IF NOT EXISTS "totp_enabled" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "totp_backup_codes" text;

-- Phase 7 composite indexes: users
CREATE INDEX CONCURRENTLY IF NOT EXISTS "users_role_kyc_idx"
  ON "users" ("role", "kyc_status");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "users_tier_active_idx"
  ON "users" ("access_tier", "last_active_at");

-- Phase 7 composite indexes: listings
CREATE INDEX CONCURRENTLY IF NOT EXISTS "listings_status_visibility_city_idx"
  ON "listings" ("status", "visibility", "city");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "listings_status_type_price_idx"
  ON "listings" ("status", "asset_type", "price_amount");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "listings_status_quality_created_idx"
  ON "listings" ("status", "quality_tier", "created_at");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "listings_fraud_verif_idx"
  ON "listings" ("ai_fraud_flag", "verification_status");

-- Phase 7 composite indexes: deal_rooms
CREATE INDEX CONCURRENTLY IF NOT EXISTS "deal_rooms_buyer_status_idx"
  ON "deal_rooms" ("buyer_id", "status");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "deal_rooms_seller_lastmsg_idx"
  ON "deal_rooms" ("seller_id", "last_message_at");

-- Phase 7 composite indexes: messages
CREATE INDEX CONCURRENTLY IF NOT EXISTS "messages_room_created_idx"
  ON "messages" ("deal_room_id", "created_at");

-- Phase 7: Enable pg_stat_statements for slow query analysis (run once as superuser)
-- CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
