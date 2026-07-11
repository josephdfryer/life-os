-- Migration: place_google_id_favorite
-- Production Place table drifted from schema.prisma: missing googlePlaceId
-- (unique, used for merchant place dedup) and favorite.

ALTER TABLE "Place" ADD COLUMN "googlePlaceId" TEXT;
ALTER TABLE "Place" ADD COLUMN "favorite" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX "Place_googlePlaceId_key" ON "Place"("googlePlaceId");
