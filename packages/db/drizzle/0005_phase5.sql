-- Phase 5: AI Matching Engine, Market Intelligence, Investment Calculator,
--          AI Concierge, Comparable Sales, Deal Health Score

CREATE TABLE IF NOT EXISTS "user_matches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "listing_id" uuid NOT NULL REFERENCES "listings"("id") ON DELETE CASCADE,
  "score" integer NOT NULL,
  "explanation" text,
  "dismissed" boolean DEFAULT false NOT NULL,
  "expressed_interest" boolean DEFAULT false NOT NULL,
  "saved" boolean DEFAULT false NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_matches_unique_idx" ON "user_matches" ("user_id", "listing_id");
CREATE INDEX IF NOT EXISTS "user_matches_user_idx" ON "user_matches" ("user_id");
CREATE INDEX IF NOT EXISTS "user_matches_listing_idx" ON "user_matches" ("listing_id");
CREATE INDEX IF NOT EXISTS "user_matches_expires_idx" ON "user_matches" ("expires_at");

CREATE TABLE IF NOT EXISTS "support_tickets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "email" varchar(255),
  "subject" varchar(255) NOT NULL,
  "body" text NOT NULL,
  "resolved" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "support_tickets_user_idx" ON "support_tickets" ("user_id");
CREATE INDEX IF NOT EXISTS "support_tickets_resolved_idx" ON "support_tickets" ("resolved");

CREATE TABLE IF NOT EXISTS "saved_calculations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "listing_id" uuid REFERENCES "listings"("id") ON DELETE SET NULL,
  "label" varchar(255),
  "inputs" jsonb DEFAULT '{}' NOT NULL,
  "results" jsonb DEFAULT '{}' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "saved_calculations_user_idx" ON "saved_calculations" ("user_id");
