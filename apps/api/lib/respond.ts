import { NextResponse } from "next/server"
import { errorEnvelopeContract } from "@life-os/contracts"
import { InteractionStreamError, AcceptStagedInteractionError } from "@life-os/domain"

// Every error apps/api returns uses one shape — { error: { code, message,
// details? } } — validated against packages/contracts' errorEnvelopeContract
// so this is the shape every future /v1 route inherits automatically, rather
// than each route inventing its own.

export function errorResponse(status: number, code: string, message: string, details?: unknown) {
  const body = errorEnvelopeContract.parse({ error: { code, message, ...(details !== undefined ? { details } : {}) } })
  return NextResponse.json(body, { status })
}

export function unauthorizedResponse() {
  return errorResponse(401, "unauthorized", "Unauthorized. Pass your key as X-Api-Key header or Authorization: Bearer <key>.")
}

export function forbiddenResponse(requiredScopes: string | string[]) {
  const scopes = Array.isArray(requiredScopes) ? requiredScopes : [requiredScopes]
  return errorResponse(403, "forbidden", `Forbidden. Required scope: ${scopes.join(" or ")}`)
}

export function handleRouteError(error: unknown) {
  // packages/domain's command errors are generic (they can't know about any
  // one app's HTTP shape) — this is the one place apps/api translates them,
  // the same pattern apps/persons/server/domain/inbox.ts uses for its own
  // AppError shape.
  if (error instanceof InteractionStreamError) return errorResponse(400, "validation", error.message)
  if (error instanceof AcceptStagedInteractionError) {
    return errorResponse(error.code === "not_found" ? 404 : 400, error.code, error.message)
  }
  console.error("[apps/api] unhandled route error", error)
  return errorResponse(500, "internal_error", "Internal server error")
}
