import { createAccessService } from "@life-os/access"
import { auth } from "@/auth"
import { workspaceForHomeRequest } from "./request-access"

const access = createAccessService({
  getSession: auth,
  errors: {
    badRequest: message => new Error(message),
    forbidden: message => new Error(message ?? "Forbidden"),
    unauthorized: message => new Error(message ?? "Unauthorized"),
  },
  localReviewEnabled: () => process.env.NODE_ENV !== "production" && process.env.LIFE_OS_LOCAL_REVIEW === "1",
})

export type AdminCapabilities = {
  connections: boolean
  automation: boolean
  access: boolean
  apiKeys: boolean
  workspace: boolean
  audit: boolean
  crossTenantWorkspaces: boolean
}

function hasScope(scopes: string[], scope: string) {
  return scopes.includes("*") || scopes.includes(scope)
}

export async function loadAdminCapabilities(): Promise<AdminCapabilities | null> {
  const workspaceId = await workspaceForHomeRequest()
  if (!workspaceId) return null

  try {
    const actor = await access.requireAccess("connections.read", workspaceId)
    const scopes = actor.scopes
    const settings = hasScope(scopes, "settings.manage")
    return {
      connections: true,
      automation: hasScope(scopes, "automations.read") || hasScope(scopes, "rules.manage") || settings,
      access: settings || hasScope(scopes, "roles.manage"),
      apiKeys: settings || hasScope(scopes, "apiKeys.manage"),
      workspace: settings,
      audit: settings || hasScope(scopes, "audit.read"),
      crossTenantWorkspaces: settings && workspaceId === "default-workspace",
    }
  } catch {
    return null
  }
}

export async function requireAdminCapability(check: (capabilities: AdminCapabilities) => boolean) {
  const capabilities = await loadAdminCapabilities()
  if (!capabilities || !check(capabilities)) return null
  return capabilities
}
