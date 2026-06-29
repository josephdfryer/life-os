# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

# Theory of Person

This app is a **derived lens over the Life OS graph**, not a new system and not a new
primitive. See `README.md`. The canonical truth stays in the Life OS primitives
(Person · Note · Event · Plan · State · Interaction). `TheorySnapshot` /
`TheorySnapshotSource` are app-layer cache/versioning only.

Synthesis logic lives in the shared `@life-os/theory` package, not in this app.
