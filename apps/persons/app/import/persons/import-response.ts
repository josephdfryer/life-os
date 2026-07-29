type ApiErrorBody = {
  error?: string | {
    message?: string
    details?: {
      issues?: Array<{ path?: string; message?: string }>
    } | null
  }
}

export async function requireSuccessfulImportResponse<T>(
  response: Response,
  fallback: string,
): Promise<T> {
  const body = await response.json().catch(() => null) as (ApiErrorBody & T) | null
  if (response.ok) return (body ?? {}) as T

  const error = body?.error
  if (typeof error === "string" && error.trim()) throw new Error(error)
  if (error && typeof error === "object") {
    const issue = error.details?.issues?.[0]
    const issueSuffix = issue?.message
      ? ` (${[issue.path, issue.message].filter(Boolean).join(": ")})`
      : ""
    if (error.message?.trim()) throw new Error(`${error.message}${issueSuffix}`)
  }
  throw new Error(fallback)
}
