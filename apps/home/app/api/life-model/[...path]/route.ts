import { NextRequest, NextResponse } from "next/server"
import { INTELLIGENCE_PROXY_CONFIG, proxyToLifeOsApi } from "@/lib/life-os-api-proxy"

type Params = { params: Promise<{ path: string[] }> }

export async function POST(request: NextRequest, { params }: Params) {
  const pathname = (await params).path.join("/")
  if (!isAllowedLifeModelPath(pathname)) {
    return NextResponse.json({ error: { code: "not_found", message: "Intelligence endpoint not found." } }, { status: 404 })
  }

  const body = pathname === "regenerate" ? undefined : await request.text()
  return proxyToLifeOsApi(request, `/v1/life-model/${pathname}`, {
    method: "POST",
    config: INTELLIGENCE_PROXY_CONFIG,
    body,
  })
}

export function isAllowedLifeModelPath(pathname: string) {
  return pathname === "regenerate" || /^claims\/[^/]+\/feedback$/.test(pathname)
}
