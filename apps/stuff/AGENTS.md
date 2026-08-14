# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

Stuff uses Vercel's managed Next.js builder. Keep the monorepo `outputFileTracingRoot`, but do not set `output: "standalone"`; that mode is for self-hosted servers and breaks Vercel output finalization.
