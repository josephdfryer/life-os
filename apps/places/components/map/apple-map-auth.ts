export const MAPKIT_LIBRARIES = ["full-map", "annotations"] as const

type MapKitAuthEvent = { status?: string; detail?: { status?: string } }

export type MapKitAuthTarget = {
  addEventListener: (type: string, listener: (event: MapKitAuthEvent) => void) => void
  removeEventListener: (type: string, listener: (event: MapKitAuthEvent) => void) => void
}

export function sanitizeMapKitToken(token?: string | null): string | undefined {
  const value = token?.trim()
  return value || undefined
}

export function mapKitLoadOptions(token: string) {
  return {
    token,
    language: "en-US",
    libraries: [...MAPKIT_LIBRARIES],
  }
}

export function configurationEventStatus(event: MapKitAuthEvent): string | undefined {
  return event.status ?? event.detail?.status
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
  const listener = (event: MapKitAuthEvent) => {
    onError(mapKitErrorMessage(configurationEventStatus(event)))
  }
  mapkit.addEventListener("error", listener)
  return () => mapkit.removeEventListener("error", listener)
}
