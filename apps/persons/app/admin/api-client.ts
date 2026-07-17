type ApiErrorBody = {
  error?: string | { message?: string }
}

export async function adminRequest<T>(
  input: string,
  init: RequestInit | undefined,
  fallbackMessage: string,
): Promise<T> {
  const response = await fetch(input, init)
  const data = await response.json() as T & ApiErrorBody
  if (!response.ok) {
    const apiError = typeof data.error === "string" ? data.error : data.error?.message
    throw new Error(apiError || fallbackMessage)
  }
  return data
}

export function jsonRequest(method: "POST" | "PATCH", body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }
}
