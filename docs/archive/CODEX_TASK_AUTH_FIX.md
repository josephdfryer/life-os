# Fix: places auth 500 error

The places app at life-os-places.vercel.app crashes with 500 on all /api/auth/* routes. Root cause: `apps/places/next.config.ts` has a `turbopack: { root: ... }` setting that breaks serverless function bundling on Vercel. The persons app (which works) has a minimal next.config.ts with no turbopack config.

## Fix

1. Replace `apps/places/next.config.ts` with the minimal version matching persons:
```ts
import type { NextConfig } from "next"

const nextConfig: NextConfig = {}

export default nextConfig
```

2. Deploy to Vercel production:
```bash
VERCEL_PROJECT_ID=prj_pVxCcqG3ob1Qe47FyAKE87hcW9qB VERCEL_ORG_ID=team_ftx6eq2s9NttYUc9WqQRwfa8 vercel --prod
```
