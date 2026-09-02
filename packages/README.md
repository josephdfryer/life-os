# Shared packages

Packages expose reusable contracts and inward-facing infrastructure. They never import application internals.

| Package | Public contract | Invariants |
|---|---|---|
| `@life-os/db` | Prisma client, generated types, crypto helpers | Schema and migrations are canonical; no destructive reset against real data |
| `@life-os/contracts` | Zod request and stored-JSON schemas | Validation errors are stable; persisted structured data crosses a codec |
| `@life-os/access` | Workspace access policy | Cache keys include workspace; disabled users fail closed; local review is non-production only |
| `@life-os/auth` | Shared authentication configuration | Authentication identifies users; app domain access still authorizes workspaces/scopes |
| `@life-os/ui` | Shared Still components and tokens | Client-safe; no database or app-internal dependency |
| `@life-os/types` | Cross-package TypeScript shapes | Types do not introduce runtime coupling |
| `@life-os/alignment` | Derived relationship/plan signals | Signals are computed, not persisted primitives; `/pure` stays free of DB imports |
| `@life-os/intelligence` | Derived theory and life-model synthesis | Interpretation remains traceable to graph facts |
| `@life-os/theory` | Re-export of `@life-os/intelligence` | Compatibility alias only — **import from `@life-os/intelligence` directly in new code** |
| `@life-os/domain` | Shared domain command layer (writes, audit, business logic) | All mutations go through domain commands, never raw Prisma calls from app code |
| `@life-os/automation` | Rules engine — triggers, conditions, actions | Rules run against domain commands; no direct DB writes from rule handlers |
| `@life-os/files` | File storage and file-intelligence helpers | Raw files stay on disk/object storage; only derived signal enters the graph (see `docs/MANIFESTO.md`) |
| `@life-os/level-up` | Shared Level Up (fitness) domain logic | Consumed by `apps/level-up`; workouts and readiness are graph-derived, not duplicated state |

The default owner is defined in `.github/CODEOWNERS`. Add a package README when its public exports or invariants need more detail than this index.
