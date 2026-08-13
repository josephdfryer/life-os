import { authorizeDeviceToken, extractBearerToken } from "@life-os/access/device"

export function authorizeDeviceRequest(request: Request, scope: string) {
  return authorizeDeviceToken(extractBearerToken(request.headers), scope)
}
