import { createHash } from "node:crypto"
import type { DomainActor } from "./index"

// Shared, framework-agnostic API-key auth. Mirrors the scope/hash logic
// apps/persons/lib/api-auth.ts already proved out in production (hashed
// ApiKey lookup, expiry + status checks, wildcard/prefix scope matching) —
// this is the version apps/api uses so a second control-plane app doesn't
// grow its own copy on day one. apps/persons' own copy is untouched; nothing
// here changes its behavior.

export type ApiKeyAuthResult = {
  actor: DomainActor
  scopes: string[]
  workspaceId: string
}

/**
 * `providedKey` is whatever the caller sent in `X-Api-Key` or
 * `Authorization: Bearer <key>` — resolve that header yourself, this stays
 * decoupled from any particular request type (Next's NextRequest, Node's
 * IncomingMessage, etc).
 */
export async function authorizeApiKey(
  providedKey: string | null | undefined,
  requiredScopes: string | string[] = [],
): Promise<ApiKeyAuthResult | null> {
  if (!providedKey) return null
  const { db } = await import("@life-os/db")

  const scopes = Array.isArray(requiredScopes) ? requiredScopes : [requiredScopes]
  const hashed = hashApiKey(providedKey)
  const apiKey = await db.apiKey.findUnique({
    where: { keyHash: hashed },
    include: { scopes: true },
  })

  if (!apiKey || apiKey.status !== "active") return null
  if (apiKey.expiresAt && apiKey.expiresAt.getTime() < Date.now()) return null

  const granted = apiKey.scopes.map(scope => scope.scope)
  if (!hasScopes(granted, scopes)) return null

  await db.apiKey.update({
    where: { id: apiKey.id },
    data: { lastUsedAt: new Date() },
  }).catch(error => {
    console.warn("[access/api-key] failed to update lastUsedAt", error)
  })

  return {
    actor: {
      type: "api_key",
      id: apiKey.id,
      label: apiKey.name,
      workspaceId: apiKey.workspaceId,
    },
    scopes: granted,
    workspaceId: apiKey.workspaceId,
  }
}

export function extractApiKey(headers: { get(name: string): string | null }): string | null {
  return headers.get("x-api-key") ?? headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null
}

function hashApiKey(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

function hasScopes(granted: string[], required: string[]) {
  if (required.length === 0) return true
  if (granted.includes("*")) return true
  return required.every(scope => granted.includes(scope) || granted.includes(`${scope.split(".")[0]}.*`))
}
