import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

/** Load KEY=value files without overriding anything already in the environment. */
export function loadDotEnv(root: string, files = [".env", ".env.shared", "apps/persons/.env"]) {
  for (const relative of files) {
    const candidate = join(root, relative)
    if (!existsSync(candidate)) continue
    for (const rawLine of readFileSync(candidate, "utf8").split("\n")) {
      const line = rawLine.trim()
      if (!line || line.startsWith("#")) continue
      const separator = line.indexOf("=")
      if (separator === -1) continue
      const name = line.slice(0, separator).trim()
      if (!name || process.env[name] !== undefined) continue
      const rawValue = line.slice(separator + 1).trim()
      const quoted = rawValue.startsWith('"') && rawValue.endsWith('"') && rawValue.length > 1
      process.env[name] = quoted ? rawValue.slice(1, -1).replaceAll("\\n", "\n") : rawValue
    }
  }
}
