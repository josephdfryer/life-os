type LinkedEvent = {
  id: string
  name: string
  transcript: string | null
  metadata: Record<string, unknown> | null
}

export type GranolaMeetingDetails = {
  eventId: string
  name: string
  summary: string
  hasTranscript: boolean
}

export function granolaMeetingDetails(event: LinkedEvent | null | undefined): GranolaMeetingDetails | null {
  if (!event?.metadata || typeof event.metadata !== "object") return null
  const granola = event.metadata.granola
  if (!granola || typeof granola !== "object" || Array.isArray(granola)) return null
  const summary = (granola as Record<string, unknown>).summary
  if (typeof summary !== "string" || !summary.trim()) return null

  return {
    eventId: event.id,
    name: event.name,
    summary: summary.trim(),
    hasTranscript: Boolean(event.transcript?.trim()),
  }
}
