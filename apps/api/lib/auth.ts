import type { NextRequest } from "next/server"
import { authorizeApiKey, extractApiKey, type ApiKeyAuthResult } from "@life-os/access"

export async function authorizeRequest(
  req: NextRequest,
  requiredScopes: string | string[] = [],
): Promise<ApiKeyAuthResult | null> {
  return authorizeApiKey(extractApiKey(req.headers), requiredScopes)
}
