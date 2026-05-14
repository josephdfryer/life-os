# Codex Task: Google Maps Import

Read `docs/GOOGLE_MAPS_IMPORT_SPEC.md` for the full spec. Build the Google Maps Takeout import feature for `apps/places`:

1. **Prisma** (`packages/db/prisma/schema.prisma`): Add `ImportJob` and `ImportStagedVisit` models (full DDL in spec). Add `googlePlaceId String? @unique` to Place model. Run `prisma migrate dev --name add_google_maps_import`.

2. **Import pipeline** (`apps/places/server/domain/import.ts`):
   - `detectFormat(json)` → `'legacy_takeout' | 'device_timeline' | 'unknown'`
   - `parseFile(buffer, format)` → `RawVisit[]`
   - `normalizeConfidence(visit)` → 0–100 using spec rules
   - `processImportJob(jobId, workspaceId)` → parse → confidence filter → dedup → upsert Place → create Event
   - Auto-create at ≥70, stage for review at 30–69, discard below 30

3. **API routes** (`apps/places/app/api/import/`):
   - `POST /api/import` — multipart upload (json or zip), detect format, create ImportJob, process async
   - `GET /api/import/[jobId]` — job status + progress
   - `GET /api/import/[jobId]/staged` — paginated staged visits
   - `PATCH /api/import/[jobId]/staged/[visitId]` — accept/reject
   - `POST /api/import/[jobId]/staged/bulk` — bulk accept/reject

4. **UI** (`apps/places/app/`):
   - `/places/import` — drag-drop upload, format preview, date range filter, confidence slider, Import button
   - `/places/import/[jobId]` — live progress (created/staged/skipped)
   - `/places/import/[jobId]/review` — card UI with keyboard shortcuts: `a`=accept, `r`=reject, `s`=skip, `j`/`k`=navigate

Follow existing apps/places patterns: auth gate via `proxy.ts`, Turso via `lib/db.ts`, all routes filter by `workspaceId`.
