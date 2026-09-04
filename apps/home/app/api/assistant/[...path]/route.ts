import { NextRequest, NextResponse } from "next/server"
import { lifeOsAppUrl } from "@life-os/auth"
import { createAccessService } from "@life-os/access"
import { db } from "@life-os/db"
import { auth } from "@/auth"
import { unstable_cache } from "next/cache"

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

class AssistantAccessError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

const assistantAccess = createAccessService({
  getSession: auth,
  errors: {
    badRequest: message => new AssistantAccessError(400, message),
    forbidden: message => new AssistantAccessError(403, message ?? "Forbidden"),
    unauthorized: message => new AssistantAccessError(401, message ?? "Unauthorized"),
  },
  localReviewEnabled: () => process.env.NODE_ENV !== "production" && process.env.LIFE_OS_LOCAL_REVIEW === "1",
})

// Scoped to the chat thread for now — file ingestion endpoints proxy through
// this same shape later without any backend changes.
function isAllowed(pathname: string) {
  return pathname === "chat"
}

export async function GET(request: NextRequest, context: Params) {
  const pathname = (await context.params).path.join("/")
  if (!isAllowed(pathname)) return error("not_found", "Assistant endpoint not found.", 404)

  // History is shared data, not agent execution. Reading it in Home avoids a
  // second Vercel function cold start, a second auth pass, and a cross-app
  // network hop before four small rows can appear. Message writes and agent
  // execution still belong exclusively to the Assistant app below.
  const startedAt = Date.now()
  let actor
  try {
    actor = await assistantAccess.requireAccess("assistant.use")
  } catch (caught) {
    if (caught instanceof AssistantAccessError) return error("forbidden", caught.message, caught.status)
    return error("forbidden", "Assistant access could not be verified", 403)
  }
  const { email, workspaceId } = actor

  const requestedLimit = Number(request.nextUrl.searchParams.get("limit") ?? 4)
  const limit = Number.isInteger(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), 20)
    : 4
  const cursor = request.nextUrl.searchParams.get("cursor") || undefined
  const messages = process.env.NODE_ENV === "production"
    ? await getCachedAssistantHistory(workspaceId, email, limit, cursor)
    : await loadAssistantHistory(workspaceId, email, limit, cursor)
  const hasMore = messages.length > limit
  const page = messages.slice(0, limit)
  const durationMs = Date.now() - startedAt
  console.log(JSON.stringify({ level: "info", message: "home assistant history loaded", durationMs, count: page.length }))

  return NextResponse.json({
    messages: page.reverse(),
    nextCursor: hasMore ? page.at(-1)?.id ?? null : null,
    hasMore,
  }, {
    headers: { "Server-Timing": `assistant-history;dur=${durationMs}` },
  })
}

async function loadAssistantHistory(workspaceId: string, email: string, limit: number, cursor?: string) {
  return db.assistantMessage.findMany({
    where: { workspaceId, from: `web:${email}` },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: { id: true, role: true, content: true, createdAt: true, metadata: true },
  })
}

const getCachedAssistantHistory = unstable_cache(
  loadAssistantHistory,
  ['home-assistant-history-v1'],
  { revalidate: 30 },
)

export async function POST(request: NextRequest, context: Params) {
  return proxy(request, context)
}

async function proxy(request: NextRequest, { params }: Params) {
  const pathname = (await params).path.join("/")
  if (!isAllowed(pathname)) return error("not_found", "Assistant endpoint not found.", 404)

  const assistantUrl = lifeOsAppUrl("assistant", "http://localhost:3005")
  const target = new URL(`/api/${pathname}`, assistantUrl)
  target.search = request.nextUrl.search

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
