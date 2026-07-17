export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"

export type GoogleTokenResponse = { access_token: string; expires_in?: number; refresh_token?: string; scope?: string; token_type?: string }
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export function googleFetch(url: string, accessToken: string, fetchImpl: FetchLike = fetch) {
  return fetchImpl(url, { headers: { Authorization: `Bearer ${accessToken}` } })
}

export async function requestGoogleToken(
  params: Record<string, string>,
  fetchImpl: FetchLike = fetch,
): Promise<GoogleTokenResponse> {
  const response = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  })
  if (!response.ok) throw new Error(`Google token request failed (${response.status})`)
  return await response.json() as GoogleTokenResponse
}

export async function googleJson<T>(url: string, accessToken: string, fetchImpl: FetchLike = fetch): Promise<T> {
  const response = await googleFetch(url, accessToken, fetchImpl)
  if (!response.ok) throw new Error(`Google API request failed (${response.status})`)
  return await response.json() as T
}
