export const MAPKIT_LIBRARIES = ["full-map", "annotations"] as const

type MapKitAuthEvent = { status?: string }

export type MapKitAuthTarget = {
  addEventListener: (type: string, listener: (event: MapKitAuthEvent) => void) => void
  removeEventListener: (type: string, listener: (event: MapKitAuthEvent) => void) => void
}

export function sanitizeMapKitToken(token?: string | null): string | undefined {
  const value = token?.trim()
  return value || undefined
}

export function mapKitErrorMessage(status?: string): string {
  switch (status) {
    case "Unauthorized":
    case "Bad Request":
      return "Apple rejected the Maps token. Confirm it is a MapKit JS token restricted to places.lacollecteur.com, then reload."
    case "Too Many Requests":
      return "Apple Maps rate-limited this token. Wait a moment and reload."
    case "Network Error":
    case "Timeout":
      return "Apple Maps could not reach Apple's servers. Check the connection and any blocker for *.apple-mapkit.com, then reload."
    default:
      return "Apple Maps could not load. Check the Maps token and its allowed domains, then reload."
  }
}

export type MapKitInitializable = MapKitAuthTarget & {
  init: (options: {
    authorizationCallback: (done: (token: string) => void) => void
    language?: string
    libraries?: string[]
  }) => void
}

export function initializeMapKit(mapkit: MapKitInitializable, token: string, timeoutMs = 15_000): Promise<void> {
  const configured = waitForMapKitConfiguration(mapkit, timeoutMs)
  mapkit.init({
    authorizationCallback: done => done(token),
    language: "en-US",
    libraries: [...MAPKIT_LIBRARIES],
  })
  return configured
}

export function waitForMapKitConfiguration(mapkit: MapKitAuthTarget, timeoutMs = 15_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const onChange = (event: MapKitAuthEvent) => {
      if (event.status === "Initialized" || event.status === "Refreshed") {
        cleanup()
        resolve()
      }
    }
    const onError = (event: MapKitAuthEvent) => {
      cleanup()
      reject(new Error(mapKitErrorMessage(event.status)))
    }
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error(mapKitErrorMessage("Timeout")))
    }, timeoutMs)
    const cleanup = () => {
      clearTimeout(timer)
      mapkit.removeEventListener("configuration-change", onChange)
      mapkit.removeEventListener("error", onError)
    }
    mapkit.addEventListener("configuration-change", onChange)
    mapkit.addEventListener("error", onError)
  })
}
