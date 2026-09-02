# persons

People CRM — contacts, inbox, rules, Gmail integration, and the v1 public API. See `apps/README.md` for how this app fits into the LifeOS monorepo, and `apps/persons/AGENTS.md` for app-specific development notes (design system, architecture map, Vercel output settings).

## Development

From the repo root:

```bash
npm ci
npm run dev -w persons
```

Set `LIFE_OS_LOCAL_REVIEW=1` in this app's `.env` to bypass Google OAuth locally — see the root `AGENTS.md` for details. Local `.env` files typically point at the production database even with auth bypassed, so treat local runs as touching real data.

Architecture: `docs/PERSONS_ARCHITECTURE.md`. Keep it updated alongside changes to inputs, outputs, APIs, domain command flow, or data models.
