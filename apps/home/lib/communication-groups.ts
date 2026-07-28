const ONE_HOUR_MS = 60 * 60 * 1000

export type CommunicationRow = {
  id: string
  source: string
  contactName: string | null
  contactEmail: string | null
  contactPhone: string | null
  summary: string | null
  body: string | null
  timestamp: Date
  direction: string | null
  priority: number
  candidatePersonId: string | null
  candidatePerson: { first: string; last: string | null } | null
}

export type CommunicationGroup = {
  id: string
  ids: string[]
  source: string
  contact: string
  summary: string
  body: string | null
  timestamp: string
  direction: string | null
  candidatePersonId: string | null
  candidatePersonName: string | null
  messageCount: number
  priority: number
}

export function groupCommunications(rows: CommunicationRow[]): CommunicationGroup[] {
  const sessions: CommunicationRow[][] = []
  const messagesByPhone = new Map<string, CommunicationRow[]>()

  for (const row of rows) {
    const phone = row.source === "imessage" ? normalizePhone(row.contactPhone) : null
    if (!phone) {
      sessions.push([row])
      continue
    }
    const messages = messagesByPhone.get(phone) ?? []
    messages.push(row)
    messagesByPhone.set(phone, messages)
  }

  for (const messages of messagesByPhone.values()) {
    const chronological = messages.toSorted((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
    let session: CommunicationRow[] = []
    let sessionStartedAt = 0
    for (const message of chronological) {
      if (session.length === 0 || message.timestamp.getTime() - sessionStartedAt <= ONE_HOUR_MS) {
        if (session.length === 0) sessionStartedAt = message.timestamp.getTime()
        session.push(message)
      } else {
        sessions.push(session)
        session = [message]
        sessionStartedAt = message.timestamp.getTime()
      }
    }
    if (session.length) sessions.push(session)
  }

  return sessions
    .map(toGroup)
    .toSorted((a, b) => a.priority - b.priority || Date.parse(b.timestamp) - Date.parse(a.timestamp))
}

function toGroup(messages: CommunicationRow[]): CommunicationGroup {
  const chronological = messages.toSorted((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
  const latest = chronological.at(-1)!
  const candidateIds = new Set(chronological.map(message => message.candidatePersonId))
  const candidatePersonId = candidateIds.size === 1 ? latest.candidatePersonId : null
  const candidatePersonName = candidatePersonId && latest.candidatePerson
    ? `${latest.candidatePerson.first} ${latest.candidatePerson.last ?? ""}`.trim()
    : null
  const latestText = latest.summary || latest.body || "No preview available"

  return {
    id: latest.id,
    ids: chronological.map(message => message.id),
    source: latest.source,
    contact: latest.contactName || latest.contactEmail || latest.contactPhone || "Unknown sender",
    summary: chronological.length > 1 ? `${chronological.length} messages · ${latestText}` : latestText,
    body: chronological.length > 1
      ? chronological.map(formatMessage).join("\n\n")
      : latest.body,
    timestamp: latest.timestamp.toISOString(),
    direction: chronological.every(message => message.direction === latest.direction) ? latest.direction : "mixed",
    candidatePersonId,
    candidatePersonName,
    messageCount: chronological.length,
    priority: Math.min(...chronological.map(message => message.priority)),
  }
}

function formatMessage(message: CommunicationRow) {
  const time = message.timestamp.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
  const direction = message.direction ? ` · ${message.direction}` : ""
  return `${time}${direction}\n${message.summary || message.body || "(no text)"}`
}

function normalizePhone(value: string | null) {
  const digits = value?.replace(/\D/g, "") ?? ""
  if (digits.length < 7) return null
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits
}
