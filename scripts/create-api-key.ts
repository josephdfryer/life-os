// Provisions an ApiKey row directly against the production database — for cases
// like apps/api's first Home consumer, where no browser session exists yet
// to go through the Admin UI's own createApiKey flow. Matches that flow's
// exact format (apps/persons/server/domain/access.ts's createApiKey): a
// `pk_`-prefixed secret, sha256-hashed, keyPrefix = first 12 chars.
//
// Usage (run by the user with the production DATABASE_URL; the credential is
// Sensitive and not readable via `vercel env pull`):
//   DATABASE_URL=... npx tsx scripts/create-api-key.ts \
//     --name "Home control plane" --scopes interactions.read,stream.read,review.read,review.write
//
// Prints the raw secret exactly once. It is never stored anywhere — only
// its hash is. Losing it means creating a new key.

import { randomBytes, createHash } from "node:crypto"
import { db } from "@life-os/db"

function parseArgs() {
  const args = process.argv.slice(2)
  const get = (flag: string) => {
    const index = args.indexOf(flag)
    return index === -1 ? undefined : args[index + 1]
  }
  const name = get("--name")
  const scopesRaw = get("--scopes")
  const workspaceId = get("--workspace") ?? "default-workspace"
  const expiresAt = get("--expires-at")
  if (!name) throw new Error("--name is required")
  if (!scopesRaw) throw new Error("--scopes is required (comma-separated)")
  const scopes = scopesRaw.split(",").map(s => s.trim()).filter(Boolean)
  if (!scopes.length) throw new Error("--scopes must list at least one scope")
  return { name, scopes, workspaceId, expiresAt: expiresAt ? new Date(expiresAt) : null }
}

function hashApiKey(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

async function main() {
  const { name, scopes, workspaceId, expiresAt } = parseArgs()

  const workspace = await db.workspace.findUnique({ where: { id: workspaceId } })
  if (!workspace) throw new Error(`Workspace "${workspaceId}" does not exist`)

  const secret = `pk_${randomBytes(24).toString("base64url")}`
  const apiKey = await db.apiKey.create({
    data: {
      name,
      keyPrefix: secret.slice(0, 12),
      keyHash: hashApiKey(secret),
      status: "active",
      workspaceId,
      expiresAt,
      scopes: { create: scopes.map(scope => ({ scope })) },
    },
    include: { scopes: true },
  })

  console.log(`Created ApiKey "${apiKey.name}" (${apiKey.id}) with scopes: ${scopes.join(", ")}`)
  console.log(`Raw key (save this now — it is never shown again):\n${secret}`)
}

main()
  .finally(() => db.$disconnect())
  .catch(error => {
    console.error(error)
    process.exitCode = 1
  })
