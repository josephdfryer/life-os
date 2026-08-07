// Moved to @life-os/domain (packages/domain/interaction-stream.ts) so apps/api
// can serve /v1/stream and /v1/stream/aggregate from the exact same
// implementation this app already proved out in production, rather than a
// rewrite. packages/domain throws a generic InteractionStreamError (it can't
// depend on this app's AppError/HTTP shape) — this shim translates that back
// so apps/persons/app/api/v1/interactions/**'s existing handleRouteError
// keeps producing the same 400 responses it always has.

import { badRequest } from "@/server/api/errors"
import {
  streamInteractions as sharedStreamInteractions,
  aggregateInteractions as sharedAggregateInteractions,
  InteractionStreamError,
  type StreamParams,
} from "@life-os/domain"

export type { StreamParams }
export { encodeCursor, decodeCursor } from "@life-os/domain"

function translate<T>(fn: () => Promise<T>): Promise<T> {
  return fn().catch(error => {
    if (error instanceof InteractionStreamError) throw badRequest(error.message, { field: "query" })
    throw error
  })
}

export function streamInteractions(params: StreamParams, workspaceId: string) {
  return translate(() => sharedStreamInteractions(params, workspaceId))
}

export function aggregateInteractions(
  params: StreamParams & { groupBy?: string | null; metric?: string | null },
  workspaceId: string,
) {
  return translate(() => sharedAggregateInteractions(params, workspaceId))
}
