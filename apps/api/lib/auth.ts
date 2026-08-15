import type { NextRequest } from "next/server"
import { authorizeApiKey, extractApiKey, type AccessActor, type ApiKeyAuthResult } from "@life-os/access"
import { authorizeDeviceToken, extractBearerToken } from "@life-os/access/device"

export async function authorizeRequest(
  req: NextRequest,
  requiredScopes: string | string[] = [],
): Promise<ApiKeyAuthResult | null> {
  const apiKey = await authorizeApiKey(extractApiKey(req.headers), requiredScopes)
  if (apiKey) return apiKey

  const device = await authorizeDeviceToken(extractBearerToken(req.headers))
  if (!device) return null

  const scopes = Array.isArray(requiredScopes) ? requiredScopes : [requiredScopes]
  if (!scopes.every(scope => device.scopes.includes(scope))) return null

  return {
    actor: {
      type: "system",
      id: device.deviceId,
      label: "signed-in-device",
      workspaceId: device.workspaceId,
    },
    scopes: device.scopes,
    workspaceId: device.workspaceId,
  }
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
