-- Migration: place_google_id_favorite
-- Production Place table drifted from schema.prisma: missing googlePlaceId
-- (unique, used for merchant place dedup) and favorite.
--
-- On a clean migration replay, both columns and the unique index are
-- already created by 20260513010000_add_google_maps_import (googlePlaceId)
-- and 20260512224500_add_place_notes (favorite), which precede this
-- migration chronologically. SQLite has no conditional ALTER TABLE ADD
-- COLUMN, so the ADD COLUMN statements (redundant by this point in any
-- consistent migration history) have been removed; the index create is
-- guarded with IF NOT EXISTS.

CREATE UNIQUE INDEX IF NOT EXISTS "Place_googlePlaceId_key" ON "Place"("googlePlaceId");
