import { NextRequest, NextResponse } from "next/server"
import { workspaceForHomeRequest } from "@/lib/request-access"

type Params = { params: Promise<{ path: string[] }> }

export const maxDuration = 300

export async function GET(request: NextRequest, { params }: Params) {
  const baseUrl = process.env.LIFE_OS_API_URL?.trim()
  const apiKey = process.env.PERSONS_API_KEY?.trim()
  if (!baseUrl || !apiKey) return error("connections_not_configured", "The shared connections service is not configured yet.", 503)

  // The proxied API key is shared and workspace-fixed; without this, every
  // signed-in user would see (and mutate) whatever workspace the key itself
  // belongs to, not their own — see the workspace.proxy scope's doc comment.
  const workspaceId = await workspaceForHomeRequest()
  if (!workspaceId) return error("unauthorized", "Sign in required.", 401)

  const pathname = (await params).path.join("/")
  if (!isAllowedConnectionRead(pathname)) return error("not_found", "Connections endpoint not found.", 404)

  try {
    const target = pathname === "list" ? "/v1/connections" : `/v1/connections/${pathname}`
    const incoming = request.nextUrl.search
    const response = await fetch(new URL(`${target}${incoming}`, baseUrl), {
      headers: { accept: "application/json", "x-api-key": apiKey, "x-workspace-override": workspaceId },
      cache: "no-store",
    })
    return NextResponse.json(await response.json(), { status: response.status })
  } catch {
    return error("connections_unavailable", "The shared connections service is temporarily unavailable.", 502)
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  return mutate(request, params, "POST")
}

export async function DELETE(request: NextRequest, { params }: Params) {
  return mutate(request, params, "DELETE")
}

async function mutate(request: NextRequest, paramsPromise: Params["params"], method: "POST" | "DELETE") {
  const baseUrl = process.env.LIFE_OS_API_URL?.trim()
  const apiKey = process.env.PERSONS_API_KEY?.trim()
  if (!baseUrl || !apiKey) return error("connections_not_configured", "The shared connections service is not configured yet.", 503)

  const workspaceId = await workspaceForHomeRequest()
  if (!workspaceId) return error("unauthorized", "Sign in required.", 401)

  const pathname = (await paramsPromise).path.join("/")
  const allowed = isAllowedConnectionMutation(method, pathname)
  if (!allowed) return error("not_found", "Connections endpoint not found.", 404)

  try {
    const body = method === "POST" ? await request.text() : undefined
    const response = await fetch(new URL(`/v1/connections/${pathname}`, baseUrl), {
      method,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-api-key": apiKey,
        "x-workspace-override": workspaceId,
      },
      body,
      cache: "no-store",
    })
    return NextResponse.json(await response.json(), { status: response.status })
  } catch {
    return error("connections_unavailable", "The shared connections service is temporarily unavailable.", 502)
  }
}

export function isAllowedConnectionRead(pathname: string) {
  return pathname === "list" || pathname === "oura/authorize"
}

export function isAllowedConnectionMutation(method: string, pathname: string) {
  return (method === "POST" && (pathname === "era" || pathname === "oura/callback" || pathname === "oura/sync"))
    || (method === "DELETE" && /^[-\w]+$/.test(pathname))
}

function error(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status })
}
