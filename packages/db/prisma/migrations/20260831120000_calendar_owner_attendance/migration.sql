-- Per-calendar inference for whether the owner is going, plus a per-Plan
-- override. Presence is still assumed unless a calendar opts out.
ALTER TABLE "CalendarConnection" ADD COLUMN "ownerAttendanceDefault" TEXT NOT NULL DEFAULT 'going';
ALTER TABLE "Plan" ADD COLUMN "ownerAttendance" TEXT;
