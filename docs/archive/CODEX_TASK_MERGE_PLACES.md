# Task: Merge `apps/places` into `apps/persons` as a "Places" tab

## Why
- Every Vercel app needs its own `AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and a separate Google OAuth callback URL registered in the Google Console. Having two apps = double the env vars, double the auth config surface, double the debugging.
- Auth.js v5 on Vercel only needs THREE env vars per deployment:
  1. `AUTH_SECRET` — required, min 32 chars, no quotes
  2. `AUTH_GOOGLE_ID` (or `GOOGLE_CLIENT_ID`) — passed to the Google provider
  3. `AUTH_GOOGLE_SECRET` (or `GOOGLE_CLIENT_SECRET`) — passed to the Google provider
  - `AUTH_TRUST_HOST` is auto-inferred on Vercel (don't set it)
  - `AUTH_URL` is NOT needed in v5 on Vercel (host inferred from request headers)
  - The Google OAuth callback URL must be registered: `https://<domain>/api/auth/callback/google`
- By merging into one app, we get one domain, one auth setup, zero sync issues.

## Goal
Move all Places functionality into `apps/persons` as a new `/places` section with a "Places" nav tab. The standalone `apps/places` app will no longer be deployed to Vercel (keep files for now, just stop deploying).

---

## What to copy into `apps/persons`

### 1. App routes — copy verbatim
From `apps/places/app/` → into `apps/persons/app/`:
- `places/page.tsx` → `places/page.tsx`
- `places/PlacesClient.tsx` → `places/PlacesClient.tsx`
- `places/[id]/page.tsx` → `places/[id]/page.tsx`
- `places/[id]/PlaceProfileClient.tsx` → `places/[id]/PlaceProfileClient.tsx`
- `places/import/page.tsx` → `places/import/page.tsx`
- `places/import/ImportUploadClient.tsx` → `places/import/ImportUploadClient.tsx`
- `places/import/[jobId]/page.tsx` → `places/import/[jobId]/page.tsx`
- `places/import/[jobId]/ImportProgressClient.tsx` → `places/import/[jobId]/ImportProgressClient.tsx`
- `places/import/[jobId]/review/page.tsx` → `places/import/[jobId]/review/page.tsx`
- `places/import/[jobId]/review/ImportReviewClient.tsx` → `places/import/[jobId]/review/ImportReviewClient.tsx`

### 2. API routes — copy verbatim
From `apps/places/app/api/` → into `apps/persons/app/api/`:
- `places/map/route.ts`
- `places/[id]/favorite/route.ts`
- `places/[id]/notes/route.ts`
- `places/[id]/notes/[noteId]/route.ts`
- `places/[id]/profile/route.ts`
- `import/route.ts`
- `import/[jobId]/route.ts`
- `import/[jobId]/staged/route.ts`
- `import/[jobId]/staged/bulk/route.ts`
- `import/[jobId]/staged/[visitId]/route.ts`

### 3. Server domain files — copy verbatim
From `apps/places/server/` → into `apps/persons/server/`:
- `domain/places.ts`
- `domain/import.ts`
- `api/errors.ts` (if not already in persons — check first)
- `api/respond.ts` (if not already in persons — check first)
- `domain/access.ts` → **DO NOT COPY** — persons already has its own `server/domain/access.ts`
- `domain/audit.ts` → **DO NOT COPY** — persons already has its own `server/domain/audit.ts`

### 4. Tests
From `apps/places/tests/places.test.ts` → `apps/persons/tests/places.test.ts`

---

## Import path fixes (important)

The copied files use `@/auth`, `@/lib/db`, `@/server/domain/access`, etc. These should already resolve correctly in `apps/persons` since it has the same alias setup. Verify by checking `apps/persons/tsconfig.json` for the `@` path alias.

### redirect fix
In the copied pages, change any:
```
redirect("/login?callbackUrl=...")
```
to keep the same form — `apps/persons` uses the same `/login` route.

### access.ts path
The places `server/domain/places.ts` and `server/domain/import.ts` import from `@/server/domain/access`. In persons, `server/domain/access.ts` exists but may have a slightly different export shape. Check that `requireAccess` and `AccessActor` are compatible — they should be since both apps share the same DB schema.

---

## Nav change

In `apps/persons/components/layout/Header.tsx`, add a "Places" nav item after "Inbox":

```tsx
<NavLink href="/places" label="Places" active={pathname === "/places" || pathname.startsWith("/places/")} />
```

---

## Things to NOT do
- Do NOT copy `apps/places/auth.ts` — persons has its own
- Do NOT copy `apps/places/app/api/auth/[...nextauth]/route.ts` — persons has its own
- Do NOT copy `apps/places/app/login/` — persons has its own login page
- Do NOT copy `apps/places/app/layout.tsx` — persons has its own
- Do NOT copy `apps/places/app/globals.css` — persons has its own

---

## After the merge

1. Run `pnpm build --filter=persons` to confirm the build passes
2. Run `pnpm test --filter=persons` (if places tests were copied)
3. Deploy `apps/persons` to Vercel: `VERCEL_PROJECT_ID=<persons-project-id> VERCEL_ORG_ID=team_ftx6eq2s9NttYUc9WqQRwfa8 vercel --prod`
4. Test `/places` in an incognito window — should work with the existing persons auth session

---

## Vercel env var summary for `apps/persons` (for reference)
Already set:
- `AUTH_SECRET` — ✅ set (clean, no embedded quotes)
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — ✅ set
- `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` — ✅ set (shared DB, has Place schema)
- `ALLOWED_EMAILS` — ✅ set

The persons app already has all the env vars Places needs. The shared Turso DB already has the Place and PlaceVisit tables.
