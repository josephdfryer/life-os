-- Declassify an occurrence that was never an occasion (a standing 1:1 that is
-- really an ongoing interaction, a calendar block that is just a reminder).
-- Nullable and additive: set rather than deleted, so the Interactions and
-- provenance hanging off the Event survive and the judgement is reversible.
ALTER TABLE "Event" ADD COLUMN "notEventAt" TIMESTAMP(3);
