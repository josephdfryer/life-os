# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

Places is a standalone Life OS app. Keep it in `apps/places`; do not add Places routes back into `apps/persons`.

Use the shared database package at `packages/db` for all graph reads/writes. Place stats such as visits, people, groups, photos, spend, and map marker sizing are derived from the graph and must not be stored as aggregate fields.
