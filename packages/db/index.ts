import { PrismaClient } from "./generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

export { Prisma } from "./generated/prisma/client";
export * from "./generated/prisma/client";

// Attaching context to an Interaction after the fact — the supported way to
// enrich a record that already landed. See docs/FINANCE_INTERACTION_MODEL_PLAN.md.
export {
  attachContext,
  detachContext,
  markEnriched,
  type AttachContextInput,
  type AttachContextResult,
  type EnrichmentBand,
  type EnrichmentEntityType,
  type EnrichmentRole,
} from "./src/enrich";

function createClient(): PrismaClient {
  const log = ["error"] as const;
  const url = process.env.DATABASE_URL;
  if (
    !url ||
    (!url.startsWith("postgresql://") && !url.startsWith("postgres://"))
  ) {
    throw new Error(
      "@life-os/db requires a PostgreSQL DATABASE_URL. For local development, start the docker-compose Postgres service; for Vercel, link the Neon resource.",
    );
  }

  const adapter = new PrismaPg({ connectionString: url });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new PrismaClient({ adapter, log: log as any });
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Lazily constructed on first property access. Importing `db` stays free — a
// module that pulls it in transitively but never queries (pure-logic helpers,
// their unit tests) does not need a configured database. The first real call
// triggers createClient(), which is where a missing/invalid DATABASE_URL
// surfaces. Also lets `prisma migrate` / `prisma generate` import this package
// without a live connection string.
function resolveClient(): PrismaClient {
  return (globalForPrisma.prisma ??= createClient());
}

export const db: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property, receiver) {
    const client = resolveClient();
    const value = Reflect.get(client as object, property, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
  has(_target, property) {
    return property in (resolveClient() as object);
  },
});

// Money is stored as integer minor units (cents). These convert at the
// application boundary so callers keep working with dollar floats.
export function centsToDollars(
  cents: number | null | undefined,
): number | null {
  if (cents === null || cents === undefined) return null;
  return Math.round(cents) / 100;
}

export function dollarsToCents(dollars: unknown): number | null {
  if (dollars === null || dollars === undefined || dollars === "") return null;
  const value = Number(dollars);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

// Canonical phone comparison key: strip everything but digits, then drop a
// US country-code "1" prefix if present, leaving the bare national number.
// Phones get captured in whatever format the source gives ("+17085341552"
// from iMessage, "7085341552" typed by hand) — comparing on this bare form
// means "+1" or no "+1" never causes a real match to be missed.
export function normalizePhoneDigits(value: string): string | null {
  let digits = value.replace(/\D/g, "");
  if (digits.length < 7) return null;
  digits = digits.replace(/^00/, ""); // international dialing prefix, equivalent to a leading "+"
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits;
}

export function phoneNumbersMatch(a: string, b: string): boolean {
  const na = normalizePhoneDigits(a);
  const nb = normalizePhoneDigits(b);
  return na !== null && na === nb;
}
