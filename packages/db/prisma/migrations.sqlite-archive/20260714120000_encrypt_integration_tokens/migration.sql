-- Migration: encrypt_integration_tokens
-- Renames plaintext OAuth token columns to an `_encrypted` (camelCase) suffix
-- so the column name itself documents that the value is AES-256-GCM
-- ciphertext (packages/db/src/crypto.ts), not a usable token.
--
-- This migration only renames columns — it does NOT encrypt existing data.
-- On a fresh/local database these columns are typically empty. For an
-- environment with existing plaintext values already in these columns
-- (e.g. production Turso, which is migrated by hand — see
-- packages/db/turso-migrate-encrypt-tokens.ts), the values must be
-- encrypted in place with a one-time script after this rename, or the
-- rename+encrypt must happen atomically. Do not deploy this schema to an
-- environment with unencrypted data still under the old column names
-- without running that migration script first.

-- CalendarConnection
ALTER TABLE "CalendarConnection" RENAME COLUMN "accessToken" TO "accessTokenEncrypted";
ALTER TABLE "CalendarConnection" RENAME COLUMN "refreshToken" TO "refreshTokenEncrypted";
ALTER TABLE "CalendarConnection" RENAME COLUMN "syncToken" TO "syncTokenEncrypted";

-- GmailConnection
ALTER TABLE "GmailConnection" RENAME COLUMN "accessToken" TO "accessTokenEncrypted";
ALTER TABLE "GmailConnection" RENAME COLUMN "refreshToken" TO "refreshTokenEncrypted";

-- EraConnection
ALTER TABLE "EraConnection" RENAME COLUMN "accessToken" TO "accessTokenEncrypted";
ALTER TABLE "EraConnection" RENAME COLUMN "refreshToken" TO "refreshTokenEncrypted";
