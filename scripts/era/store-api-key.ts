#!/usr/bin/env tsx
// Encrypt the Era API key into EraConnection.accessTokenEncrypted.
//
// The key lives in .env for CLI scripts, but anything running as the deployed
// app reads it from the database instead. Storing it encrypted at rest means an
// exfiltrated database yields ciphertext rather than a working credential
// (packages/db/src/crypto.ts, same envelope used for Google OAuth tokens).
//
//   npx tsx scripts/era/store-api-key.ts          # reads ERA_API_KEY from env
//
// Idempotent: re-running replaces the stored ciphertext with a fresh
// encryption of the current key. Never prints the key.

import fs from "node:fs"
import path from "node:path"
import { mirrorEraConnection } from "./connection-mirror"

const REPO_ROOT = path.resolve(import.meta.dirname, "../..")
for (const candidate of [path.join(REPO_ROOT, ".env"), path.join(REPO_ROOT, "apps/persons/.env")]) {
  if (!fs.existsSync(candidate)) continue
  for (const line of fs.readFileSync(candidate, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2]
  }
}

const WORKSPACE_ID = "default-workspace"

async function main() {
  const apiKey = process.env.ERA_API_KEY?.trim()
  if (!apiKey) throw new Error("ERA_API_KEY is not set (add it to apps/persons/.env)")

  const { db } = await import("@life-os/db")
  const { encrypt, decrypt } = await import("@life-os/db/crypto")

  const connection = await db.eraConnection.findFirst({
    where: { workspaceId: WORKSPACE_ID },
    select: { id: true, accountEmail: true },
  })
  if (!connection) throw new Error("No EraConnection for this workspace")

  const ciphertext = encrypt(apiKey)

  // Prove the round-trip before persisting: a key that cannot be decrypted is
  // worse than no key, because the failure surfaces at sync time instead.
  if (decrypt(ciphertext) !== apiKey) throw new Error("encrypt/decrypt round-trip failed — refusing to store")

  await db.$transaction(async tx => {
    const updated = await tx.eraConnection.update({
      where: { id: connection.id },
      data: {
        accessTokenEncrypted: ciphertext,
        scope: "api-key",
        status: "active",
        lastError: null,
      },
    })
    await mirrorEraConnection(tx, updated)
  })

  console.log(`Stored encrypted Era API key on EraConnection ${connection.id}`)
  console.log(`  ciphertext length: ${ciphertext.length} chars (iv:authTag:payload)`)
  console.log(`  round-trip verified; plaintext never logged`)
}

main().then(() => process.exit(0)).catch(e => { console.error(e.message); process.exit(1) })
