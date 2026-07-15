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

// Money is stored as integer minor units (cents). These convert at the
// application boundary so callers keep working with dollar floats.
export function centsToDollars(cents: number | null | undefined): number | null {
  if (cents === null || cents === undefined) return null
  return Math.round(cents) / 100
}

export function dollarsToCents(dollars: unknown): number | null {
  if (dollars === null || dollars === undefined || dollars === "") return null
  const value = Number(dollars)
  if (!Number.isFinite(value)) return null
  return Math.round(value * 100)
}

// Canonical phone comparison key: strip everything but digits, then drop a
// US country-code "1" prefix if present, leaving the bare national number.
// Phones get captured in whatever format the source gives ("+17085341552"
// from iMessage, "7085341552" typed by hand) — comparing on this bare form
// means "+1" or no "+1" never causes a real match to be missed.
export function normalizePhoneDigits(value: string): string | null {
  let digits = value.replace(/\D/g, "")
  if (digits.length < 7) return null
  digits = digits.replace(/^00/, "") // international dialing prefix, equivalent to a leading "+"
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1)
  return digits
}

export function phoneNumbersMatch(a: string, b: string): boolean {
  const na = normalizePhoneDigits(a)
  const nb = normalizePhoneDigits(b)
  return na !== null && na === nb
}
