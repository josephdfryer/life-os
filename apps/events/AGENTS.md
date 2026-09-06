# Events App

LifeOS lens for the **Event** primitive — things that happened in the world, independent of any one participant.

## Dev

```bash
npm run dev -w events   # http://localhost:3006
```

## Model

- **Event** — shared occurrence (name, type, start/end, place, notes, transcript)
- **Interaction** — each person's relationship to that event (emotional weight, outcome, summary)

Event data lives once on the Event node. Personal layers live on Interaction edges — see manifesto §VI.

## Routes

- `/events` — timeline (today / upcoming / past / all); includes unreconciled calendar Plans
- `/events/[id]` — event detail + participant interactions
- `/events/new` — manual event creation
- `/settings/granola` — manual Granola sync and backfill (connect at Home `/admin/connections`)
- `/settings/calendar` — Google Calendar source selection, attendance defaults, and sync controls (OAuth connect at Home `/admin/connections`)
- `/groups/[id]/meetings` — deterministic company/group meeting lens
- `/api/events` — session-authenticated CRUD
- `/api/calendar/plans/[id]/attendance` — owner going / not going / did go / didn't
- `/api/event-signals/[id]` — one-click event reinforcement (not event / went / didn't)
- `/api/calendar/google/attendance-default` — per-calendar default attendance
- `/api/granola/{status,sync,disconnect}` — workspace-scoped Granola operations (connect at Home `/admin/connections`)
- `/api/cron/granola-sync` — `CRON_SECRET`-authenticated daily reconciliation

## Granola

- API credentials live only as encrypted `Connection.accessTokenEncrypted` values (`kind=meetings`, `provider=granola`). Never return or log them.
- `GranolaNoteLink` is the idempotency/provenance anchor. Provider summary and transcript live once on Event; `Event.notes` remains user-owned.
- Attendees auto-link only through one exact normalized Person email. A declined calendar RSVP is not attendance and must not create a Person Interaction. Unknown/ambiguous identities stage in `StagedInteraction`/`ReviewItem`; never create People or Groups silently.
- List Notes and transcript endpoints must follow every cursor. Oversized inline transcripts fall back to the paginated transcript endpoint.
- Verification: `npm test --workspace=events`, `npm run type-check --workspace=events`, `npm run build --workspace=events`, and root `npm run check:migrations`.
- Operational detail and secret rotation: `docs/GRANOLA_EVENTS_RUNBOOK.md`.

## Deploy

Vercel project: `life-os-events` → `events.lacollecteur.com`

Events intentionally uses Next's default traced output on Vercel. Do not add
`output: "standalone"` to `next.config.ts`: standalone copying is for
self-hosting and conflicts with Vercel's managed Next build adapter in this
monorepo (`next-server.js.nft.json` is consumed by the adapter).

```bash
npm run deploy -- --only events
```

`apps/events/vercel.json` holds the granola-sync and calendar-sync crons. Do not add a root
`vercel.json` — it overrides this file and can drop the crons. See
`docs/DEPLOY_RUNBOOK.md`.

Add Google OAuth callback: `https://home.lacollecteur.com/admin/connections/google/calendar/callback`

Google OAuth is scoped to `jdf247@gmail.com` by default. After connecting, the
Calendar settings screen lists the primary, shared, and subscribed calendars
that account can read and stores one active `CalendarConnection` per selection.
Override `GOOGLE_CALENDAR_ACCOUNT_EMAIL` only when the authenticating Google
account changes; source calendars are selected in the UI.

Set the same shared auth env vars as other apps (`AUTH_SECRET`, `AUTH_COOKIE_DOMAIN`, `DATABASE_URL`).
Granola also requires `ENCRYPTION_KEY` and the daily cron requires `CRON_SECRET`.
