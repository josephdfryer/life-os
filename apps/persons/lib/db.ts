import { PrismaClient } from "@/app/generated/prisma/client"

function createClient(): PrismaClient {
  const log = ["error"] as const

  if (process.env.TURSO_DATABASE_URL) {
    // Production: Turso (hosted libSQL / SQLite-compatible)
    // PrismaLibSql takes a config object directly — NOT a libsql client instance
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
    const { PrismaLibSql } = require("@prisma/adapter-libsql") as any
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
  const url = process.env.DATABASE_URL ?? "file:./persons.db"
  const adapter = new PrismaBetterSqlite3({ url })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new PrismaClient({ adapter, log: log as any })
}

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined }

export const db = globalForPrisma.prisma ?? createClient()

globalForPrisma.prisma = db
