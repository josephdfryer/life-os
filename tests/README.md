# E2E tests

Playwright specs live in `tests/e2e/`. There are two config files at the repo root, not one — this is deliberate, not accidental duplication:

| Config | Runs | App | Port | Database |
|---|---|---|---|---|
| `playwright.config.ts` | Everything in `tests/e2e/` except `home-control-plane.spec.ts` | `persons` | 3100 | `lifeos_e2e` |
| `playwright.home.config.ts` | `home-control-plane.spec.ts` only | `home` | 3200 | `lifeos_e2e_home` |

Each app under test gets its own dev server, port, and throwaway database so the two suites can run independently without colliding. `npm run e2e` runs both (`playwright test && npm run e2e:home`). If a new spec targets yet another app, prefer adding a project/config in the same pattern rather than merging these into one shared config — the separate webServer + database per app is the point.
