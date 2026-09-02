import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

const POSTGRES_URL_PREFIXES = ["postgresql://", "postgres://"]

type Environment = Record<string, string | undefined>

function parseDotEnvFile(path: string): Record<string, string> {
  const parsed: Record<string, string> = {}
  for (const rawLine of readFileSync(path, "utf8").split("\n")) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    const separator = line.indexOf("=")
    if (separator === -1) continue
    const name = line.slice(0, separator).trim()
    if (!name) continue
    const rawValue = line.slice(separator + 1).trim()
    const doubleQuoted = rawValue.startsWith('"') && rawValue.endsWith('"') && rawValue.length > 1
    const singleQuoted = rawValue.startsWith("'") && rawValue.endsWith("'") && rawValue.length > 1
    parsed[name] = doubleQuoted
      ? rawValue.slice(1, -1).replaceAll("\\n", "\n")
      : singleQuoted
        ? rawValue.slice(1, -1)
        : rawValue
  }
  return parsed
}

/** Load KEY=value files without overriding anything already in the environment. */
export function loadDotEnv(root: string, files = [".env", ".env.shared", "apps/persons/.env"]) {
  for (const relative of files) {
    const candidate = join(root, relative)
    if (!existsSync(candidate)) continue
    for (const [name, value] of Object.entries(parseDotEnvFile(candidate))) {
      if (process.env[name] !== undefined) continue
      process.env[name] = value
    }
  }
}

export function resolvePostgresDatabaseUrl(
  inherited: string | undefined,
  fileValuesInPriorityOrder: Array<string | undefined>,
): string {
  const selected = inherited ?? fileValuesInPriorityOrder.find(isPostgresUrl)
  if (!selected || !isPostgresUrl(selected)) {
    throw new Error(
      "Message collectors require a PostgreSQL DATABASE_URL; refusing to use SQLite or run without a canonical database",
    )
  }
  return selected
}

/**
 * Load collector configuration without letting packages/db/.env's local
 * SQLite URL mask the canonical Persons PostgreSQL URL. An explicitly
 * inherited DATABASE_URL always wins, then the most specific app env files.
 */
export function loadPostgresCollectorEnv(
  root: string,
  env: Environment = process.env,
) {
  const inheritedDatabaseUrl = env.DATABASE_URL
  const files = [
    ".env",
    "packages/db/.env",
    "apps/persons/.env",
    "apps/persons/.env.local",
  ]
  const parsedByFile = new Map<string, Record<string, string>>()

  for (const relative of files) {
    const candidate = join(root, relative)
    if (!existsSync(candidate)) continue
    const parsed = parseDotEnvFile(candidate)
    parsedByFile.set(relative, parsed)
    for (const [name, value] of Object.entries(parsed)) {
      if (env[name] === undefined) env[name] = value
    }
  }

  env.DATABASE_URL = resolvePostgresDatabaseUrl(inheritedDatabaseUrl, [
    parsedByFile.get("apps/persons/.env.local")?.DATABASE_URL,
    parsedByFile.get("apps/persons/.env")?.DATABASE_URL,
    parsedByFile.get(".env")?.DATABASE_URL,
    parsedByFile.get("packages/db/.env")?.DATABASE_URL,
  ])
}

function isPostgresUrl(value: string | undefined): value is string {
  return Boolean(value && POSTGRES_URL_PREFIXES.some(prefix => value.startsWith(prefix)))
}
