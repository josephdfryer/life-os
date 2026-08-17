import { NextRequest, NextResponse } from "next/server"
import { workspaceForHomeRequest } from "@/lib/request-access"

type Params = { params: Promise<{ path: string[] }> }
type Method = "GET" | "POST" | "PATCH" | "DELETE"

export async function GET(request: NextRequest, context: Params) {
  return proxyAutomation(request, context, "GET")
}

export async function POST(request: NextRequest, context: Params) {
  return proxyAutomation(request, context, "POST")
}

export async function PATCH(request: NextRequest, context: Params) {
  return proxyAutomation(request, context, "PATCH")
}

export async function DELETE(request: NextRequest, context: Params) {
  return proxyAutomation(request, context, "DELETE")
}

async function proxyAutomation(request: NextRequest, { params }: Params, method: Method) {
  const baseUrl = process.env.LIFE_OS_API_URL?.trim()
  const apiKey = process.env.PERSONS_API_KEY?.trim()
  if (!baseUrl || !apiKey) return unavailable("automation_not_configured", "The shared automation service is not configured yet.", 503)

  // See connections proxy's identical comment: the shared key is
  // workspace-fixed, so every request must carry the current session's own
  // workspace or it silently acts on whichever workspace the key belongs to.
  const workspaceId = await workspaceForHomeRequest()
  if (!workspaceId) return unavailable("unauthorized", "Sign in required.", 401)

  const { path } = await params
  const pathname = path.join("/")
  if (!isAllowed(method, pathname)) {
    return unavailable("not_found", "Automation endpoint not found.", 404)
  }

  const target = new URL(`/v1/automations/${pathname}`, baseUrl)
  target.search = request.nextUrl.search
  try {
    const body = method === "GET" || method === "DELETE" ? undefined : await request.text()
    const response = await fetch(target, {
      method,
      body,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-api-key": apiKey,
        "x-workspace-override": workspaceId,
      },
      cache: "no-store",
    })
    if (response.status === 204) return new NextResponse(null, { status: 204 })
    return NextResponse.json(await response.json(), { status: response.status })
  } catch {
    return unavailable("automation_unavailable", "The shared automation service is temporarily unavailable.", 502)
  }
}

export function isAllowed(method: Method, pathname: string) {
  if (method === "GET") return pathname === "rules" || pathname === "runs"
  if (method === "POST") return pathname === "rules" || pathname === "runs/apply" || /^rules\/[^/]+\/test$/.test(pathname)
  if (method === "PATCH" || method === "DELETE") return /^rules\/[^/]+$/.test(pathname)
  return false
}

function unavailable(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status })
}
