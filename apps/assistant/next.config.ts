import type { NextConfig } from "next"
import path from "path"
import { withWorkflow } from "workflow/next"

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.resolve(__dirname, "../.."),
  serverExternalPackages: [
    "twilio",
    "better-sqlite3",
    "@prisma/adapter-better-sqlite3",
    "@prisma/adapter-libsql",
    "@libsql/client",
  ],
}

export default withWorkflow(nextConfig)
