# ADR 0001: Keep LifeOS a boundary-enforced modular monolith

- Status: accepted
- Date: 2026-07-16
- Owners: @josephdfryer

## Context

LifeOS is a medium-sized TypeScript/Next.js platform maintained by a solo developer or small team. Its apps share one graph and frequently require transactional changes across primitives. Independent services would add deployment, consistency, and operational cost before there is measured scaling or ownership pressure.

## Decision

Keep independently deployable apps and shared packages in one monorepo and database. Enforce dependency direction with `npm run lint`: packages and scripts cannot import app internals, apps cannot import one another's internals, and client UI cannot import Prisma. Cross-app reuse moves to a package or an explicit API contract.

## Alternatives considered

- Backend microservices: rejected until extraction criteria are met.
- Micro-frontends beyond existing app deployments: rejected while one team owns the experience and shared navigation/design remain coupled.
- Unenforced conventions: rejected because architectural drift is already measurable.

## Consequences

Local changes and transactions stay simple. Package contracts and module ownership require discipline. A future service can be extracted behind an existing boundary without changing the eight primitives.

## Verification and rollback

CI runs dependency, type, test, migration, E2E, build, and performance gates. Boundary rules can be changed through a superseding ADR, not a one-off import exception.
