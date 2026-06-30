import { PrismaClient } from "./generated/prisma/client"

export { Prisma } from "./generated/prisma/client"
export * from "./generated/prisma/client"

function createClient(): PrismaClient {
  const log = ["error"] as const

  if (process.env.TURSO_DATABASE_URL) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
    const { PrismaLibSql } = require("@prisma/adapter-libsql") as any

    // Embedded replica: local SQLite file synced from remote Turso (~8ms reads vs ~150ms HTTP)
    if (process.env.TURSO_SYNC_URL) {
      const adapter = new PrismaLibSql({
        url: "file:replica.db",
        syncUrl: process.env.TURSO_SYNC_URL,
        authToken: process.env.TURSO_AUTH_TOKEN ?? undefined,
        syncInterval: 60,
      })
      return new PrismaClient({ adapter, log: log as any })
    }

    // Production: Turso (hosted libSQL / SQLite-compatible)
    const adapter = new PrismaLibSql({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN ?? undefined,
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return new PrismaClient({ adapter, log: log as any })
  }

  // Local dev: SQLite file
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PrismaBetterSqlite3 } = require("@prisma/adapter-better-sqlite3") as typeof import("@prisma/adapter-better-sqlite3")
  const url = process.env.DATABASE_URL ?? "file:./life-os.db"
  const adapter = new PrismaBetterSqlite3({ url })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new PrismaClient({ adapter, log: log as any })
}

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined }

export const db = globalForPrisma.prisma ?? createClient()

globalForPrisma.prisma = db
