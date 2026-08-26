import { NextRequest, NextResponse } from "next/server"
import { lifeOsAppUrl } from "@life-os/auth"

type Params = { params: Promise<{ path: string[] }> }

// Home never re-implements the assistant's agent — every call here is
// forwarded to apps/assistant's own API, which re-runs its own
// requireWorkspaceAccess() against the shared root-domain session cookie
// (same cookie name/domain for every Life OS app — see
// packages/auth/index.ts:sharedAuthCookies). This route is pure transport,
// not an auth boundary, and it shares one message history with the
// standalone assistant.lacollecteur.com chat since both resolve the same
// `from: "web:<email>"`.
export const maxDuration = 300

// Scoped to the chat thread for now — file ingestion endpoints proxy through
// this same shape later without any backend changes.
function isAllowed(pathname: string) {
  return pathname === "chat"
}

export async function GET(request: NextRequest, context: Params) {
  return proxy(request, context)
}

export async function POST(request: NextRequest, context: Params) {
  return proxy(request, context)
}

async function proxy(request: NextRequest, { params }: Params) {
  const pathname = (await params).path.join("/")
  if (!isAllowed(pathname)) return error("not_found", "Assistant endpoint not found.", 404)

  const assistantUrl = lifeOsAppUrl("assistant", "http://localhost:3005")
  const target = new URL(`/api/${pathname}`, assistantUrl)

  try {
    const response = await fetch(target, {
      method: request.method,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        cookie: request.headers.get("cookie") ?? "",
      },
      body: request.method === "POST" ? await request.text() : undefined,
      cache: "no-store",
    })
    return NextResponse.json(await response.json(), { status: response.status })
  } catch {
    return error("assistant_unavailable", "The assistant is temporarily unavailable.", 502)
  }
}

function error(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status })
}
