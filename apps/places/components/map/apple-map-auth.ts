export const MAPKIT_LIBRARIES = ["full-map", "annotations"] as const

export type MapKitAuthTarget = {
  addEventListener(type: string, listener: (event: Event) => void): void
  removeEventListener(type: string, listener: (event: Event) => void): void
}

export function sanitizeMapKitToken(token?: string | null): string | undefined {
  const value = token?.replace(/\s+/g, "")
  return value || undefined
}

/** MapKit JS tokens are JWTs. Dashboard names, Maps IDs, and wrapped pastes are not. */
export function isMapKitJsToken(token?: string | null): token is string {
  const value = sanitizeMapKitToken(token)
  if (!value) return false
  const parts = value.split(".")
  return parts.length === 3 && parts.every(part => part.length > 0)
}

export function mapKitLoadOptions(token: string) {
  return {
    token,
    language: "en-US",
    libraries: [...MAPKIT_LIBRARIES],
  }
}

export function configurationEventStatus(event: Event): string | undefined {
  const record = event as Event & { status?: string; detail?: { status?: string } }
  return record.status ?? record.detail?.status
}

export function mapKitErrorMessage(status?: string): string {
  switch (status) {
    case "Unauthorized":
    case "Bad Request":
      return "Apple rejected the Maps token. Confirm it is a MapKit JS token restricted to places.lacollecteur.com, then reload."
    case "Too Many Requests":
      return "Apple Maps rate-limited this token. Wait a moment and reload."
    case "Network Error":
      return "Apple Maps could not reach Apple's servers. Check the connection and any blocker for *.apple-mapkit.com, then reload."
    default:
      return "Apple Maps could not load. Check the Maps token and its allowed domains, then reload."
  }
}

export function subscribeMapKitErrors(mapkit: MapKitAuthTarget, onError: (message: string) => void): () => void {
  const listener = (event: Event) => {
    onError(mapKitErrorMessage(configurationEventStatus(event)))
  }
  mapkit.addEventListener("error", listener)
  return () => mapkit.removeEventListener("error", listener)
}
