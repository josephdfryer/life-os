import { execFileSync } from "node:child_process"
import { join } from "node:path"

// Before the migration to PostgreSQL, production SQLite had no `_prisma_migrations`
// table, so this gate reflected the live column set back against the Prisma
// models to catch "prod is missing schema the client will select". Postgres +
// `prisma migrate deploy` tracks applied migrations properly, so the check is
// now the standard one: does production have every committed migration applied?

function requireProdDatabaseUrl(): string {
  const url = process.env.DATABASE_URL
  if (!url || !/^postgres(ql)?:\/\//.test(url)) {
    throw new Error(
      "DATABASE_URL is not set to a PostgreSQL URL. Load .env / pull the Neon " +
        "connection string, or pass --skip-migrations.",
    )
  }
  return url
}

/** Apply any pending committed migrations before we ship code that depends on them. */
export async function applyProdMigrations(root: string): Promise<string> {
  requireProdDatabaseUrl()
  const dbPackage = join(root, "packages/db")
  execFileSync(
    "npx",
    ["prisma", "migrate", "deploy", "--schema", "prisma/schema.prisma"],
    { cwd: dbPackage, encoding: "utf8", stdio: "inherit" },
  )
  return "Applied pending Prisma migrations to production."
}

export async function assertProdSchema(root: string): Promise<string> {
  requireProdDatabaseUrl()

  const dbPackage = join(root, "packages/db")
  let output: string
  try {
    output = execFileSync(
      "npx",
      ["prisma", "migrate", "status", "--schema", "prisma/schema.prisma"],
      { cwd: dbPackage, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    )
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message?: string }
    const detail = (err.stdout ?? "") + (err.stderr ?? "") || err.message || ""
    throw new Error(
      "Production database is not in sync with the committed migrations. " +
        "Run `prisma migrate deploy` against it before deploying, or the first " +
        "query on the new schema 500s.\n\n" +
        detail.trim(),
    )
  }

  if (!/Database schema is up to date/i.test(output)) {
    throw new Error(
      "`prisma migrate status` did not confirm production is up to date:\n\n" +
        output.trim(),
    )
  }

  const applied = output.match(/(\d+)\s+migrations?\s+found/i)?.[1] ?? "the committed"
  return `Production has ${applied} migrations applied and is up to date.`
}
