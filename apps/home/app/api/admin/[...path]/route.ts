import { NextRequest, NextResponse } from "next/server"
import { ADMIN_PROXY_CONFIG, proxyToLifeOsApi } from "@/lib/life-os-api-proxy"

type Params = { params: Promise<{ path: string[] }> }
type Method = "POST" | "PATCH"

export async function POST(request: NextRequest, context: Params) {
  return proxyAccess(request, context, "POST")
}

export async function PATCH(request: NextRequest, context: Params) {
  return proxyAccess(request, context, "PATCH")
}

async function proxyAccess(request: NextRequest, { params }: Params, method: Method) {
  const pathname = (await params).path.join("/")
  if (!isAllowed(method, pathname)) {
    return NextResponse.json({ error: { code: "not_found", message: "Admin endpoint not found." } }, { status: 404 })
  }

  return proxyToLifeOsApi(request, `/v1/access/${pathname}`, {
    method,
    config: ADMIN_PROXY_CONFIG,
    body: await request.text(),
  })
}

export function isAllowed(method: Method, pathname: string) {
  if (method === "POST") return pathname === "api-keys" || pathname === "roles" || pathname === "approved-emails"
  return /^api-keys\/[^/]+$/.test(pathname)
    || /^roles\/[^/]+$/.test(pathname)
    || /^users\/[^/]+\/roles$/.test(pathname)
    || /^approved-emails\/[^/]+$/.test(pathname)
    || /^workspaces\/[^/]+$/.test(pathname)
}
