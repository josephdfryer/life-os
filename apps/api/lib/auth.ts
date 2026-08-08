import type { NextRequest } from "next/server"
import { authorizeApiKey, extractApiKey, type AccessActor, type ApiKeyAuthResult } from "@life-os/access"

export async function authorizeRequest(
  req: NextRequest,
  requiredScopes: string | string[] = [],
): Promise<ApiKeyAuthResult | null> {
  return authorizeApiKey(extractApiKey(req.headers), requiredScopes)
}

/**
 * A few shared domain commands (rules CRUD in @life-os/automation, moved
 * from apps/persons/server/domain/rules.ts) still take the fuller
 * AccessActor shape rather than the raw ApiKeyAuthResult apps/api normally
 * works with. userId/workspaceName have no API-key equivalent — same
 * synthesized values apps/persons/app/api/v1/rules already uses for its own
 * API-key callers.
 */
export function toAccessActor(auth: ApiKeyAuthResult): AccessActor {
  return {
    userId: null as unknown as string,
    email: auth.actor.label ?? "api-key",
    workspaceId: auth.workspaceId,
    workspaceName: "API Workspace",
    actor: auth.actor,
    scopes: auth.scopes,
  }
}
