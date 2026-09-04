import { auth } from "@/auth"
import { createAccessService } from "@life-os/access"

export class AccessError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = "AccessError"
    this.status = status
  }
}

export type WorkspaceAccess = { userId: string; email: string; workspaceId: string; workspaceName: string; scopes: string[] }

const access = createAccessService({
  getSession: auth,
  errors: {
    badRequest: message => new AccessError(400, message),
    forbidden: message => new AccessError(403, message ?? "Forbidden"),
    unauthorized: message => new AccessError(401, message ?? "Unauthorized"),
  },
  localReviewEnabled: () => process.env.NODE_ENV !== "production" && process.env.LIFE_OS_LOCAL_REVIEW === "1",
})

export async function requireWorkspaceAccess(): Promise<WorkspaceAccess> {
  return access.requireAccess("assistant.use")
}

export function accessErrorResponse(error: unknown) {
  if (error instanceof AccessError) {
    return { error: error.message, status: error.status }
  }
  return { error: error instanceof Error ? error.message : "Unexpected error", status: 500 }
}
