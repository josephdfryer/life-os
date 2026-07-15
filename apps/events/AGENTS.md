# Events App

Life OS lens for the **Event** primitive — things that happened in the world, independent of any one participant.

## Dev

```bash
npm run dev -w events   # http://localhost:3006
```

## Model

- **Event** — shared occurrence (name, type, start/end, place, notes, transcript)
- **Interaction** — each person's relationship to that event (emotional weight, outcome, summary)

Event data lives once on the Event node. Personal layers live on Interaction edges — see manifesto §VI.

## Routes

- `/events` — timeline (today / upcoming / past / all)
- `/events/[id]` — event detail + participant interactions
- `/events/new` — manual event creation
- `/api/events` — session-authenticated CRUD

## Deploy

Vercel project: `life-os-events` → `events.lacollecteur.com`

```bash
cp apps/events/.vercel/project.json .vercel/project.json   # after linking
vercel --prod
cp apps/persons/.vercel/project.json .vercel/project.json  # restore default
```

Add Google OAuth callback: `https://events.lacollecteur.com/api/calendar/google/callback`

Google OAuth is scoped to `jdf247@gmail.com` by default. After connecting, the
Calendar settings screen lists the primary, shared, and subscribed calendars
that account can read and stores one active `CalendarConnection` per selection.
Override `GOOGLE_CALENDAR_ACCOUNT_EMAIL` only when the authenticating Google
account changes; source calendars are selected in the UI.

Set the same shared auth env vars as other apps (`AUTH_SECRET`, `AUTH_COOKIE_DOMAIN`, Turso vars).
