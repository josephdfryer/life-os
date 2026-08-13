import { auditLogPageContract } from "@life-os/contracts"

export function toLegacyAuditLogResponse(input: unknown, workspaceId: string) {
  const page = auditLogPageContract.parse(input)
  return {
    data: {
      logs: page.data.map(entry => ({
        ...entry,
        workspaceId,
        userId: entry.user?.id ?? null,
        apiKeyId: entry.apiKey?.id ?? null,
        personId: entry.person?.id ?? null,
      })),
    },
    limit: page.limit,
  }
}
