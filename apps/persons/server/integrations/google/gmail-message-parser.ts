export type GmailMessage = { id: string; threadId?: string; historyId?: string; internalDate?: string; labelIds?: string[]; snippet?: string; payload?: { mimeType?: string; headers?: { name?: string; value?: string }[]; body?: { data?: string }; parts?: GmailMessage["payload"][] } }
export type EmailParty = { name: string | null; email: string }
export type ParsedMessage = { id: string; threadId: string | null; historyId: string | null; subject: string | null; from: EmailParty[]; to: EmailParty[]; cc: EmailParty[]; bcc: EmailParty[]; timestamp: Date; snippet: string | null; body: string | null; direction: string; labelIds: string[]; metadata: Record<string, unknown> }

export function parseGmailMessage(raw: GmailMessage, mailboxEmail: string | null): ParsedMessage {
  const headers = headersMap(raw.payload?.headers ?? [])
  const from = parseAddressList(headers.get("from"))
  const to = parseAddressList(headers.get("to"))
  const cc = parseAddressList(headers.get("cc"))
  const bcc = parseAddressList(headers.get("bcc"))
  const self = mailboxEmail ? normalizeEmail(mailboxEmail) : null
  const fromSelf = self ? from.some(party => normalizeEmail(party.email) === self) : Boolean(raw.labelIds?.includes("SENT"))
  const body = extractBody(raw.payload) ?? raw.snippet ?? null
  return {
    id: raw.id, threadId: raw.threadId ?? null, historyId: raw.historyId ?? null,
    subject: headers.get("subject") ?? null, from, to, cc, bcc,
    timestamp: parseTimestamp(headers.get("date") ?? null, raw.internalDate), snippet: raw.snippet ?? null, body,
    direction: fromSelf ? "outgoing" : "incoming", labelIds: raw.labelIds ?? [],
    metadata: { source: "gmail", gmailMessageId: raw.id, threadId: raw.threadId ?? null, historyId: raw.historyId ?? null, labelIds: raw.labelIds ?? [], subject: headers.get("subject") ?? null, from, to, cc, bcc, snippet: raw.snippet ?? null },
  }
}

export function parseAddressList(value: string | null | undefined): EmailParty[] {
  if (!value) return []
  return value.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(part => parseAddress(part.trim())).filter((party): party is EmailParty => Boolean(party?.email))
}
function parseAddress(value: string) {
  const bracket = value.match(/^(.*)<([^>]+)>$/)
  if (bracket) return { name: cleanName(bracket[1]), email: bracket[2].trim().toLowerCase() }
  const email = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]
  return email ? { name: cleanName(value.replace(email, "")), email: email.toLowerCase() } : null
}
function headersMap(headers: { name?: string; value?: string }[]) {
  const map = new Map<string, string>()
  for (const header of headers) if (header.name && header.value !== undefined) map.set(header.name.toLowerCase(), header.value)
  return map
}
function parseTimestamp(dateHeader: string | null, internalDate: string | undefined) {
  const fromHeader = dateHeader ? new Date(dateHeader) : null
  if (fromHeader && !Number.isNaN(fromHeader.getTime())) return fromHeader
  const millis = internalDate ? Number(internalDate) : NaN
  return Number.isFinite(millis) ? new Date(millis) : new Date()
}
function cleanName(value: string) { return value.trim().replace(/^"+|"+$/g, "").trim() || null }
function extractBody(part: GmailMessage["payload"]): string | null {
  if (!part) return null
  if (part.mimeType === "text/plain" && part.body?.data) return decodeBase64Url(part.body.data)
  for (const child of part.parts ?? []) { const text = extractBody(child); if (text) return text }
  return part.body?.data && part.mimeType?.startsWith("text/") ? decodeBase64Url(part.body.data) : null
}
function decodeBase64Url(value: string) { return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8").trim() }
function normalizeEmail(value: string) { return value.trim().toLowerCase() }
