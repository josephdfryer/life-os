# Engineering onboarding

## First hour

1. Install the repository's Node/npm versions and run `npm ci`.
2. Read `MANIFESTO.md`, `LIFE_OS_VISION.md`, and the nearest `AGENTS.md`.
3. Run `npm run agent:start -- --agent <name>` and read the catch-up brief.
4. Use `LIFE_OS_LOCAL_REVIEW=1` for local UI review; never create localhost OAuth credentials.
5. Confirm which database an `.env` targets before running an app. Local auth bypass may still point at real Turso data.

## Safe verification loop

Run `npm run lint`, `npm run type-check`, and the affected workspace tests. For schema changes, add a migration and run `npm run db:drill`. For critical browser journeys, use `npm run e2e`, which creates an isolated temporary database. Never run `prisma db push --force-reset` or bulk-delete core data.

## Finding the right boundary

- Primitive and modeling decisions: manifesto, vision, then an ADR.
- Request/persisted shapes: `@life-os/contracts`.
- Workspace permissions: `@life-os/access` plus the app domain layer.
- Database: `@life-os/db`, accessed from server/domain code.
- UI: Still design system and `@life-os/ui`.
- Cross-app behavior: shared package or versioned API, never app-internal imports.

Before handing off, update living architecture docs, the technical-debt backlog where relevant, and run `npm run agent:finish` with the result and next step.
