-- Migration: add_facebook_instagram
-- Adds Facebook and Instagram URL fields to Person

ALTER TABLE "Person" ADD COLUMN "facebook" TEXT;
ALTER TABLE "Person" ADD COLUMN "instagram" TEXT;
