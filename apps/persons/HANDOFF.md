# Persons App — Agent Handoff

This is a personal CRM built as a Next.js app inside an npm workspace monorepo. Everything below is what an agent needs to pick up and continue development.

---

## Repository layout

```
life-os/                          ← monorepo root (npm workspaces)
├── apps/
│   └── persons/                  ← the CRM app (this is your working directory)
│       ├── app/                  ← Next.js App Router
│       │   ├── api/              ← all route handlers
│       │   ├── contacts/         ← people list + detail pages
│       │   ├── contacts/[id]/    ← person detail page
│       │   ├── contacts/merge/   ← dedupe UI
│       │   ├── import/           ← transcript import flow
│       │   └── today/            ← daily dashboard
│       ├── components/           ← shared React components
│       ├── lib/                  ← utils, db client, attention scoring
│       ├── types/                ← TypeScript types
│       ├── auth.ts               ← NextAuth v5 Google OAuth config
│       └── prisma/               ← not here — schema is in packages/db
└── packages/
    ├── db/
    │   ├── prisma/schema.prisma  ← THE schema (edit here)
    │   └── generated/prisma/     ← Prisma client output
    └── ui/                       ← shared design system (@life-os/ui)
```

---

## Stack

| Concern | Technology |
|---------|-----------|
| Framework | Next.js 16 (App Router, Turbopack) |
| Language | TypeScript |
| Database | PostgreSQL on Neon — production via Vercel env vars |
| ORM | Prisma 7 (provider = "postgresql", `@prisma/adapter-pg`, `DATABASE_URL`) |
| Auth | NextAuth v5 — Google OAuth, allowed emails list |
| AI | Anthropic SDK direct (`claude-sonnet-4-20250514`) — used for import analysis |
| Deploy | Vercel — monorepo, build command: `npx turbo run build --filter=persons` |
| Build | Turborepo |
| UI tokens | `@life-os/ui` — CSS custom properties (`var(--accent)`, `var(--ink)`, etc.) |

---

## Environment variables

These live in `apps/persons/.env` and must also be set in Vercel (they already are in production). For local dev, the `.env` file has all values.

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Local SQLite path (dev only) |
| `DATABASE_URL` | Production Postgres connection string |
| `ANTHROPIC_API_KEY` | Claude API key for import analysis |
| `API_KEY` | Internal API key for v1 endpoints |
| `AUTH_SECRET` | NextAuth session secret |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `ALLOWED_EMAILS` | Comma-separated list of emails allowed to log in |
| `UPLOAD_DIR` | Local file upload path (dev only) |

**Get these from:** `apps/persons/.env` (local dev) or Vercel dashboard → persons project → Settings → Environment Variables (production).

---

## Key data model

```prisma
model Person {
  id        String  @id @default(cuid())
  first     String
  last      String
  headline  String?
  emails    String  @default("[]")   // JSON array of strings
  phones    String  @default("[]")   // JSON array of strings
  closeness Int     @default(1)      // 1=Acquaintance 2=Nurture 3=Friend 4=Inner Circle
  tags      String  @default("[]")   // JSON array
  values    String  @default("[]")   // JSON array
  notes     String?
  // ...color, social links, etc
  interactions Interaction[]
  plans        Plan[]
}

model Interaction {
  id            String   @id @default(cuid())
  personId      String?
  eventId       String?
  type          String   // call|meeting|message|email|dinner|other
  timestamp     DateTime
  summary       String?
  emotionalWeight String? // Energizing|Positive|Neutral|Draining|Stressful
  outcome       String?  // Complete|Follow-up needed|Action required|Open
  actionItems   String?  // JSON array
  sourceFileId  String?  // links to ImportedFile
}
```

---

## Closeness levels (4-level system — migrated May 2026)

| Value | Label | Contact cadence |
|-------|-------|-----------------|
| 1 | Acquaintance | Never — no urgency |
| 2 | Nurture | 90 days — professional contacts, former execs, mentors |
| 3 | Friend | 21 days |
| 4 | Inner Circle | 10 days |

The urgency bar on `PersonCard` fills and turns red as relationships go overdue relative to these cadences.

---

## Deployment

**Always deploy from the monorepo root** (`/Users/josephfryer/life-os`), never from a subdirectory:

```bash
cd /Users/josephfryer/life-os
vercel --prod
```

The Vercel project is named `persons`, linked via `.vercel/project.json` at the root.

After deploying, run any pending data migrations by calling the endpoint from the browser console (since it requires auth):

```js
// Run from browser console on persons-azure.vercel.app
fetch('/api/admin/migrate-closeness', { method: 'POST' }).then(r => r.json()).then(console.log)
```

---

## Important patterns and conventions

### No comments unless non-obvious
Don't add explanatory comments. Only comment hidden constraints, workarounds, or surprising invariants.

### JSON array fields
`emails`, `phones`, `tags`, `values`, `actionItems` are stored as JSON strings in SQLite. Always use `parseTags()` from `lib/utils.ts` to parse them. Always `JSON.stringify(array)` when writing.

### Prisma schema location
The schema lives in `packages/db/prisma/schema.prisma`, NOT in `apps/persons`. Run `prisma generate` from the `packages/db` directory. Migrations live under `packages/db/prisma/migrations` and are applied with `prisma migrate deploy`; CI replays the history against a fresh Postgres before deploy.

### Search
The minimal API (`/api/persons?minimal=true`) tokenizes the search query and requires each token to match across first/last/emails/company/headline/notes/location via `contains`. Used for the contacts list and the import resolve modal.

### Import flow
1. User drops a file → text is read client-side
2. `POST /api/import/analyze` — sends text + filename + existing contacts to Claude, returns `ImportedPerson[]`
3. Jaro-Winkler fuzzy match runs client-side (threshold 0.95 for auto-match)
4. User resolves ambiguous matches in the resolve modal (API-backed search, not limited to 200 contacts)
5. `POST /api/import/confirm` — creates/links people and interactions in DB

### Dedupe
`/contacts/merge` uses `MergeDuplicatesUI`. Cluster merge endpoint at `/api/contacts/merge-cluster` uses union-find to merge N contacts into 1 in a single transaction.

### Attention scoring
`lib/attention.ts` — computes `attentionScore` = `daysSinceLast / cadenceThreshold`. Score ≥ 1.0 = overdue. Used for the urgency bar and the Today page.

### Auth
NextAuth v5 with Google OAuth. The `authorized` callback in `auth.ts` gates all routes. Unauthenticated requests redirect to `/login`.

---

## Active API routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/persons` | GET | List (minimal=true) or full load with attention enrichment |
| `/api/persons` | POST | Create person |
| `/api/persons/[id]` | GET/PATCH/DELETE | Person CRUD |
| `/api/interactions` | GET/POST | List/create interactions |
| `/api/interactions/[id]` | DELETE | Delete interaction |
| `/api/import/analyze` | POST | Claude analysis of transcript |
| `/api/import/confirm` | POST | Write import results to DB |
| `/api/contacts/duplicates` | GET | Fetch scored duplicate pairs |
| `/api/contacts/merge-cluster` | POST | Merge N contacts via union-find |
| `/api/plans` | GET/POST | Plans CRUD |
| `/api/plans/[id]` | PATCH | Update plan status |
| `/api/admin/migrate-closeness` | POST | One-time 3→4 level migration (idempotent) |

---

## Recent work (May 2026 session)

- **Import flow overhaul**: Jaro-Winkler matching (0.95 threshold), filename parsing for date/type/participant context, resolve modal uses live API search (not limited to 200 contacts), `needsReview` clears on match, ResultCard shows blue "attaching to existing contact" banner for matched contacts
- **Dedupe**: Filter view (same email / very similar / similar name), multi-select + cluster merge, union-find backend
- **Contacts list**: Urgency bar replaces closeness bar, last interaction date now fetched in minimal API via 1-row join
- **4-level closeness**: Added Nurture (level 2, 90-day cadence) between Acquaintance and Friend; ran migration shifting old 2→3 and 3→4
- **Interaction delete**: DELETE `/api/interactions/[id]`, `×` button on InteractionCard

---

## Things to be careful about

- **Never commit `apps/persons/package-lock.json`** — it's in `.gitignore`. The workspace root `package-lock.json` is the one that matters. A nested lock file breaks Vercel's npm install.
- **Prisma migrations**: `npx prisma migrate dev` in `packages/db` creates a migration; CI replays the history against a fresh Postgres and applies it to production before deploy.
- **`parseTags` for all array fields**: Never read `person.emails` as a string. Always run through `parseTags()`.
- **Vercel deploy from root**: Always `cd /path/to/life-os && vercel --prod`. Never from `apps/persons`.
