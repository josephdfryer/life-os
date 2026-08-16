import { NextResponse } from "next/server"
import { errorEnvelopeContract } from "@life-os/contracts"
import { InteractionError, InteractionStreamError, AcceptStagedInteractionError, PersonError, PlanError, EventPrimitiveError, ReviewItemError, StateError, CaptureValidationError } from "@life-os/domain"
import { LifeModelError, TheoryError } from "@life-os/intelligence"
import { RuleError } from "@life-os/automation"
import { AccessError } from "@life-os/access"
import { WorkoutCommandError } from "@life-os/level-up"
import { PeopleApiError } from "./people"
import { PlansApiError } from "./plans"
import { EventsApiError } from "./events"
import { AuditLogApiError } from "./audit-log"
import { NotesApiError } from "./notes"
import { OuraError } from "./oura"

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
  if (error instanceof InteractionError) return errorResponse(error.code === "not_found" ? 404 : 400, error.code, error.message)
  if (error instanceof AcceptStagedInteractionError) {
    return errorResponse(error.code === "not_found" ? 404 : 400, error.code, error.message)
  }
  if (error instanceof ReviewItemError) {
    return errorResponse(error.code === "not_found" ? 404 : 400, error.code, error.message)
  }
  if (error instanceof StateError) {
    return errorResponse(error.code === "not_found" ? 404 : 400, error.code, error.message)
  }
  if (error instanceof PersonError || error instanceof PeopleApiError) {
    return errorResponse(error.code === "not_found" ? 404 : 400, error.code, error.message)
  }
  if (error instanceof PlanError || error instanceof PlansApiError) {
    return errorResponse(error.code === "not_found" ? 404 : 400, error.code, error.message)
  }
  if (error instanceof EventPrimitiveError || error instanceof EventsApiError) {
    return errorResponse(error.code === "not_found" ? 404 : 400, error.code, error.message)
  }
  if (error instanceof CaptureValidationError || error instanceof NotesApiError) {
    return errorResponse(error.code === "not_found" ? 404 : 400, error.code, error.message)
  }
  if (error instanceof AuditLogApiError) {
    return errorResponse(400, error.code, error.message)
  }
  if (error instanceof TheoryError) {
    const status = error.code === "not_found" ? 404 : error.code === "conflict" ? 409 : error.code === "provider" ? 502 : 400
    return errorResponse(status, error.code, error.message)
  }
  if (error instanceof LifeModelError) {
    const status = error.code === "not_found" ? 404 : error.code === "conflict" ? 409 : error.code === "provider" ? 502 : 400
    return errorResponse(status, error.code, error.message)
  }
  if (error instanceof RuleError) {
    return errorResponse(error.code === "not_found" ? 404 : 400, error.code, error.message)
  }
  if (error instanceof AccessError) {
    return errorResponse(error.code === "not_found" ? 404 : 400, error.code, error.message)
  }
  if (error instanceof WorkoutCommandError) {
    return errorResponse(error.code === "not_found" ? 404 : 409, error.code, error.message)
  }
  if (error instanceof OuraError) {
    const status = error.code === "not_configured" ? 503 : error.code === "forbidden" || error.code === "revoked" ? 403 : 400
    return errorResponse(status, error.code, error.message)
  }
  console.error("[apps/api] unhandled route error", error)
  return errorResponse(500, "internal_error", "Internal server error")
}
