import { notFound, redirect } from "next/navigation"
import { auth } from "@/auth"
import { db } from "@/lib/db"
import { getWorkspaceId } from "@/lib/workspace"

export const dynamic = "force-dynamic"

export default async function GroupMeetingsPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.email) redirect("/login")
  const workspaceId = await getWorkspaceId(session.user.email)
  const { id } = await params
  const group = await db.group.findFirst({
    where: { id, workspaceId },
    include: {
      personMembers: { include: { person: { select: { id: true, first: true, last: true } } } },
      taggedEvents: {
        where: { type: "meeting" },
        orderBy: { start: "desc" },
        include: { interactions: { where: { personId: { not: null } }, select: { personId: true } }, granolaNoteLinks: { select: { id: true }, take: 1 } },
      },
    },
  })
  if (!group) notFound()

  const meetings = group.taggedEvents
  const participantIds = new Set(meetings.flatMap(meeting => meeting.interactions.flatMap(interaction => interaction.personId ? [interaction.personId] : [])))
  const averageGapDays = meetings.length > 1
    ? Math.round(meetings.slice(0, -1).reduce((sum, meeting, index) => sum + Math.abs(meeting.start.getTime() - meetings[index + 1].start.getTime()), 0) / (meetings.length - 1) / 86_400_000)
    : null

  return (
    <div style={{ maxWidth: "900px", margin: "0 auto", padding: "40px 24px" }}>
      <a href="/events" style={{ color: "var(--ink-4)", fontSize: "12px", textDecoration: "none" }}>← Events</a>
      <div style={{ margin: "22px 0 28px" }}>
        <div style={{ color: "var(--cognac)", fontSize: "11px", letterSpacing: "0.08em", textTransform: "uppercase" }}>Company meeting lens</div>
        <h1 style={{ fontFamily: "var(--font-display)", fontSize: "32px", fontWeight: 500, margin: "5px 0 8px" }}>{group.name}</h1>
        <p style={{ color: "var(--ink-3)", margin: 0 }}>A deterministic view derived from Event, Person, Interaction, and Group links.</p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "12px", marginBottom: "32px" }}>
        <Metric label="Meetings" value={String(meetings.length)} />
        <Metric label="Known people met" value={String(participantIds.size)} />
        <Metric label="Granola evidence" value={String(meetings.filter(meeting => meeting.granolaNoteLinks.length > 0).length)} />
        <Metric label="Average cadence" value={averageGapDays === null ? "Not enough data" : `${averageGapDays} days`} />
      </div>

      <h2 style={{ fontFamily: "var(--font-display)", fontSize: "21px", fontWeight: 500 }}>Meeting timeline</h2>
      <div style={{ display: "grid", gap: "10px" }}>
        {meetings.map(meeting => (
          <a key={meeting.id} href={`/events/${meeting.id}`} style={{ display: "flex", justifyContent: "space-between", gap: "18px", padding: "15px 17px", background: "var(--surface)", border: "1px solid var(--border-subtle)", borderRadius: "12px", color: "inherit", textDecoration: "none" }}>
            <span><strong style={{ fontSize: "13px", fontWeight: 500 }}>{meeting.name}</strong><span style={{ display: "block", color: "var(--ink-4)", fontSize: "11px", marginTop: "3px" }}>{meeting.interactions.length} linked participant{meeting.interactions.length === 1 ? "" : "s"}</span></span>
            <time style={{ color: "var(--ink-3)", fontSize: "12px", whiteSpace: "nowrap" }}>{meeting.start.toLocaleDateString()}</time>
          </a>
        ))}
        {meetings.length === 0 ? <div style={{ padding: "24px", color: "var(--ink-3)", background: "var(--surface)", border: "1px solid var(--border-subtle)", borderRadius: "12px" }}>No linked meetings yet.</div> : null}
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div style={{ background: "var(--surface)", border: "1px solid var(--border-subtle)", borderRadius: "12px", padding: "16px" }}><div style={{ fontFamily: "var(--font-display)", fontSize: "22px" }}>{value}</div><div style={{ color: "var(--ink-4)", fontSize: "11px", marginTop: "4px" }}>{label}</div></div>
}
