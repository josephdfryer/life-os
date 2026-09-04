import { db } from "@life-os/db"
import { requireAdminCapability } from "@/lib/admin-access"
import { workspaceForHomeRequest } from "@/lib/request-access"
import { redirect } from "next/navigation"
import { AdminChrome } from "../AdminChrome"
import { formatAdminDate } from "../shared"

export const metadata = { title: "Assistant chats · Admin · LifeOS" }

const PAGE_SIZE = 50

export default async function AdminAssistantChatsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; cursor?: string }>
}) {
  const capabilities = await requireAdminCapability(cap => cap.assistantHistory)
  if (!capabilities) redirect("/admin")
  const workspaceId = await workspaceForHomeRequest()
  if (!workspaceId) redirect("/login")

  const params = await searchParams
  const streams = await db.assistantMessage.groupBy({
    by: ["channel", "from"],
    where: { workspaceId },
    orderBy: { _max: { createdAt: "desc" } },
    take: 100,
    _count: { _all: true },
    _max: { createdAt: true },
  })
  const selected = streams.find(stream => stream.from === params.from) ?? streams[0] ?? null

  let cursor = params.cursor
  if (cursor && selected) {
    const validCursor = await db.assistantMessage.findFirst({
      where: { id: cursor, workspaceId, from: selected.from },
      select: { id: true },
    })
    if (!validCursor) cursor = undefined
  }

  const rows = selected ? await db.assistantMessage.findMany({
    where: { workspaceId, from: selected.from },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: { id: true, role: true, content: true, createdAt: true },
  }) : []
  const hasMore = rows.length > PAGE_SIZE
  const page = rows.slice(0, PAGE_SIZE)
  const nextCursor = hasMore ? page.at(-1)?.id : null

  return (
    <AdminChrome tab="assistant-chats" capabilities={capabilities} intro="Role-gated access and workspace conversation oversight.">
      <div className="admin-chat-grid">
        <aside className="admin-control-card">
          <div className="admin-control-card-heading"><h2>Conversations</h2><span>{streams.length} streams</span></div>
          {streams.length === 0 ? <p className="admin-control-help">No Assistant conversations yet.</p> : <nav className="admin-chat-streams" aria-label="Assistant conversations">
            {streams.map(stream => <a className={stream.from === selected?.from ? "admin-chat-stream admin-chat-stream-active" : "admin-chat-stream"} href={`/admin/assistant-chats?from=${encodeURIComponent(stream.from)}`} key={`${stream.channel}:${stream.from}`}>
              <strong>{streamLabel(stream.from)}</strong>
              <span>{stream.channel} · {stream._count._all} messages</span>
              {stream._max.createdAt && <time>{formatAdminDate(stream._max.createdAt)}</time>}
            </a>)}
          </nav>}
        </aside>

        <section className="admin-control-card" aria-labelledby="assistant-chat-heading">
          <div className="admin-control-card-heading">
            <h2 id="assistant-chat-heading">{selected ? streamLabel(selected.from) : "Chat history"}</h2>
            <span>Read only</span>
          </div>
          <p className="admin-control-help">Workspace administrators can review member conversations. Members see this notice beside the Assistant composer.</p>
          {page.length === 0 ? <div className="admin-control-empty">No messages in this stream.</div> : <div className="admin-chat-messages">
            {[...page].reverse().map(message => <article className={`admin-chat-message admin-chat-message-${message.role}`} key={message.id}>
              <div><strong>{message.role === "assistant" ? "Assistant" : streamLabel(selected!.from)}</strong><time>{formatAdminDate(message.createdAt)}</time></div>
              <p>{message.content}</p>
            </article>)}
          </div>}
          {nextCursor && selected && <a className="still-button still-button-secondary admin-chat-older" href={`/admin/assistant-chats?from=${encodeURIComponent(selected.from)}&cursor=${encodeURIComponent(nextCursor)}`}>View older messages</a>}
        </section>
      </div>
    </AdminChrome>
  )
}

function streamLabel(from: string) {
  if (from.startsWith("web:")) return from.slice(4)
  if (from.startsWith("whatsapp:")) return from.slice("whatsapp:".length)
  return from
}
