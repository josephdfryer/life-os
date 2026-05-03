import { NextRequest, NextResponse } from "next/server"
import { createHash } from "crypto"
import { db } from "@/lib/db"
import type { DomainActor } from "@/server/domain/audit"

export type ApiAuthResult = {
  actor: DomainActor
  scopes: string[]
}

export async function authorizeApiRequest(
  req: NextRequest,
  requiredScopes: string | string[] = [],
): Promise<ApiAuthResult | null> {
  const provided =
    req.headers.get("x-api-key") ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "")
  if (!provided) return null

  const scopes = Array.isArray(requiredScopes) ? requiredScopes : [requiredScopes]
  const legacyKey = process.env.API_KEY
  if (legacyKey && provided === legacyKey) {
    return {
      actor: { type: "api_key", id: "env", label: "legacy-env-api-key" },
      scopes: ["*"],
    }
  }

  const hashed = hashApiKey(provided)
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
    console.warn("[api-auth] failed to update lastUsedAt", error)
  })

  return {
    actor: {
      type: "api_key",
      id: apiKey.id,
      label: apiKey.name,
    },
    scopes: granted,
  }
}

export async function validateApiKey(req: NextRequest): Promise<boolean> {
  return Boolean(await authorizeApiRequest(req))
}

export function unauthorized() {
  return NextResponse.json({ error: "Unauthorized. Pass your key as X-Api-Key header or Authorization: Bearer <key>." }, { status: 401 })
}

export function forbidden(requiredScopes: string | string[]) {
  const scopes = Array.isArray(requiredScopes) ? requiredScopes : [requiredScopes]
  return NextResponse.json({ error: `Forbidden. Required scope: ${scopes.join(" or ")}` }, { status: 403 })
}

function hashApiKey(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

function hasScopes(granted: string[], required: string[]) {
  if (required.length === 0) return true
  if (granted.includes("*")) return true
  return required.every(scope =>
    granted.includes(scope) || granted.includes(`${scope.split(".")[0]}.*`)
  )
}
