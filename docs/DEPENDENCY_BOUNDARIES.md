# Dependency boundaries

Life OS stays a modular monorepo. Dependencies point inward toward reusable contracts and infrastructure, never outward toward an application.

## Permitted direction

```text
app routes and UI -> app domain/API -> shared packages
scripts ---------------------------> shared packages or script-local helpers
shared packages -------------------> other shared packages
```

- An app may use its own internal modules and any package's public exports.
- Apps may not import another app's internal files. Cross-app behavior belongs in a shared package or a versioned HTTP/API contract.
- Packages and repository scripts may not import app internals. A reusable function must move to a package or remain script-local.
- Client UI modules (`"use client"`) may not import `@life-os/db` or `@prisma/client` directly. Database access belongs on the server, preferably behind that app's domain boundary. Server Components and route handlers can be migrated behind domain modules incrementally without weakening the client-bundle safety gate.
- Package public entry points are the contract. Avoid deep imports unless that subpath is explicitly exported by the package.

`npm run lint` executes `scripts/check-dependency-boundaries.mjs`; CI therefore rejects new violations. Keep the checker small and deterministic so it remains a low-friction architectural test.
