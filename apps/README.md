# Applications

Each app is independently deployable but remains part of one modular monolith and one LifeOS graph. Apps communicate through shared package contracts or HTTP—not imports from another app's internals.

| App | Public surface | Core invariants |
|---|---|---|
| `persons` | People, inbox, rules, Gmail, v1 API | Workspace isolation; human review for uncertain identity; writes use domain commands and audit |
| `places` | Place map, profiles, import/review API | Place statistics are derived from graph relationships; unresolved visits remain staged |
| `events` | Events, calendar views and Google Calendar settings | Events remain the primitive; provider records link to rather than redefine Events |
| `stuff` | Items and assemblies | Item identity and graph relationships remain canonical in shared DB |
| `home` | Cross-domain overview | Read-oriented composition; no competing primitive definitions |
| `assistant` | Conversational graph tools | Tool calls honor workspace access and domain write boundaries |
| `api` | Integration/device API (events, plans, people, files, health, workouts, rules, audit log) | External and device-facing surface; same domain-command and workspace-access rules as the UI apps |
| `level-up` | Fitness and workout tracking | Uses `@life-os/level-up` for shared domain logic; workouts and readiness are graph-derived, not duplicated state |
| `companion` | Native macOS/iOS app (Swift/Xcode, not an npm workspace) | Lives outside the Node toolchain; see `apps/companion/README.md` for its own build process |

Read the nearest `AGENTS.md`, relevant architecture document, and `docs/MANIFESTO.md` before changing an app contract.
