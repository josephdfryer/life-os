# Applications

Each app is independently deployable but remains part of one modular monolith and one Life OS graph. Apps communicate through shared package contracts or HTTP—not imports from another app's internals.

| App | Public surface | Core invariants |
|---|---|---|
| `persons` | People, inbox, rules, Gmail, v1 API | Workspace isolation; human review for uncertain identity; writes use domain commands and audit |
| `places` | Place map, profiles, import/review API | Place statistics are derived from graph relationships; unresolved visits remain staged |
| `events` | Events, calendar views and Google Calendar settings | Events remain the primitive; provider records link to rather than redefine Events |
| `stuff` | Items and assemblies | Item identity and graph relationships remain canonical in shared DB |
| `home` | Cross-domain overview | Read-oriented composition; no competing primitive definitions |
| `assistant` | Conversational graph tools | Tool calls honor workspace access and domain write boundaries |
| `theory-of` | Derived theory views | Derived interpretations never overwrite primitive facts |

Read the nearest `AGENTS.md`, relevant architecture document, and `docs/MANIFESTO.md` before changing an app contract.
