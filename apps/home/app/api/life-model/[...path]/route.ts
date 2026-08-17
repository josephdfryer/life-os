import { NextRequest, NextResponse } from "next/server"
import { workspaceForHomeRequest } from "@/lib/request-access"

type Params = { params: Promise<{ path: string[] }> }

export async function POST(request: NextRequest, { params }: Params) {
  const baseUrl = process.env.LIFE_OS_API_URL?.trim()
  const apiKey = process.env.PERSONS_API_KEY?.trim()
  if (!baseUrl || !apiKey) return unavailable("intelligence_not_configured", "The shared intelligence service is not configured yet.", 503)

  const workspaceId = await workspaceForHomeRequest()
  if (!workspaceId) return unavailable("unauthorized", "Sign in required.", 401)

  const { path } = await params
  const pathname = path.join("/")
  if (!isAllowedLifeModelPath(pathname)) {
    return unavailable("not_found", "Intelligence endpoint not found.", 404)
  }

  const target = new URL(`/v1/life-model/${pathname}`, baseUrl)
  try {
    const body = pathname === "regenerate" ? undefined : await request.text()
    const response = await fetch(target, {
      method: "POST",
      body,
      headers: { accept: "application/json", "content-type": "application/json", "x-api-key": apiKey, "x-workspace-override": workspaceId },
      cache: "no-store",
    })
    return NextResponse.json(await response.json(), { status: response.status })
  } catch {
    return unavailable("intelligence_unavailable", "The shared intelligence service is temporarily unavailable.", 502)
  }
}

export function isAllowedLifeModelPath(pathname: string) {
  return pathname === "regenerate" || /^claims\/[^/]+\/feedback$/.test(pathname)
}

function unavailable(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status })
}
