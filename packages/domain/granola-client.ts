const GRANOLA_API_BASE = "https://public-api.granola.ai/v1"

export type GranolaPerson = { name?: string | null; email?: string | null }

export type GranolaTranscriptItem = {
  text?: string | null
  start_time?: number | string | null
  end_time?: number | string | null
  speaker?: {
    name?: string | null
    attribution?: string | null
    diarization_label?: string | null
  } | null
}

export type GranolaNote = {
  id: string
  title?: string | null
  owner?: GranolaPerson | null
  created_at?: string | null
  updated_at?: string | null
  web_url?: string | null
  calendar_event?: {
    event_title?: string | null
    invitees?: GranolaPerson[] | null
    organiser?: GranolaPerson | null
    calendar_event_id?: string | null
    scheduled_start_time?: string | null
    scheduled_end_time?: string | null
  } | null
  attendees?: GranolaPerson[] | null
  folder_membership?: unknown
  summary_text?: string | null
  summary_markdown?: string | null
  transcript?: GranolaTranscriptItem[] | null
}

type Page<T> = {
  notes?: T[]
  transcript?: T[]
  hasMore?: boolean
  has_more?: boolean
  cursor?: string | null
  next_cursor?: string | null
}

export class GranolaApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message)
    this.name = "GranolaApiError"
  }
}

export class GranolaClient {
  constructor(
    private readonly apiKey: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly baseUrl = GRANOLA_API_BASE,
  ) {}

  async validate(): Promise<void> {
    await this.request<Page<GranolaNote>>("/notes?page_size=1")
  }

  async listAllNotes(input: { updatedAfter?: Date; createdAfter?: Date } = {}): Promise<GranolaNote[]> {
    const notes: GranolaNote[] = []
    let cursor: string | null = null

    do {
      const params = new URLSearchParams({ page_size: "30" })
      if (cursor) params.set("cursor", cursor)
      if (input.updatedAfter) params.set("updated_after", input.updatedAfter.toISOString())
      if (input.createdAfter) params.set("created_after", input.createdAfter.toISOString())
      const page = await this.request<Page<GranolaNote>>(`/notes?${params.toString()}`)
      notes.push(...(page.notes ?? []))
      cursor = hasMore(page) ? page.cursor ?? page.next_cursor ?? null : null
      if (hasMore(page) && !cursor) throw new Error("Granola returned hasMore without a cursor")
    } while (cursor)

    return notes
  }

  async getNote(noteId: string): Promise<GranolaNote> {
    try {
      return await this.request<GranolaNote>(`/notes/${encodeURIComponent(noteId)}?include=transcript`)
    } catch (error) {
      if (!(error instanceof GranolaApiError) || (error.status !== 413 && error.code !== "TRANSCRIPT_TOO_LARGE")) {
        throw error
      }
      const note = await this.request<GranolaNote>(`/notes/${encodeURIComponent(noteId)}`)
      return { ...note, transcript: await this.getAllTranscript(noteId) }
    }
  }

  async getAllTranscript(noteId: string): Promise<GranolaTranscriptItem[]> {
    const transcript: GranolaTranscriptItem[] = []
    let cursor: string | null = null
    do {
      const params = new URLSearchParams({ page_size: "100" })
      if (cursor) params.set("cursor", cursor)
      const page = await this.request<Page<GranolaTranscriptItem>>(
        `/notes/${encodeURIComponent(noteId)}/transcript?${params.toString()}`,
      )
      transcript.push(...(page.transcript ?? []))
      cursor = hasMore(page) ? page.cursor ?? page.next_cursor ?? null : null
      if (hasMore(page) && !cursor) throw new Error("Granola returned transcript hasMore without a cursor")
    } while (cursor)
    return transcript
  }

  private async request<T>(path: string): Promise<T> {
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${this.apiKey}`, Accept: "application/json" },
      cache: "no-store",
    })
    const body = await response.json().catch(() => ({})) as Record<string, unknown>
    if (!response.ok) {
      const error = body.error as Record<string, unknown> | undefined
      const message = String(error?.message ?? body.message ?? `Granola API request failed (${response.status})`)
      const code = typeof error?.code === "string" ? error.code : typeof body.code === "string" ? body.code : undefined
      throw new GranolaApiError(message, response.status, code)
    }
    return body as T
  }
}

function hasMore(page: Page<unknown>) {
  return page.hasMore === true || page.has_more === true
}

export function formatGranolaTranscript(items: GranolaTranscriptItem[] | null | undefined): string | null {
  const lines = (items ?? [])
    .map((item) => {
      const text = item.text?.trim()
      if (!text) return null
      const speaker = item.speaker?.name?.trim()
        || item.speaker?.attribution?.trim()
        || item.speaker?.diarization_label?.trim()
        || "Speaker"
      return `${speaker}: ${text}`
    })
    .filter((line): line is string => Boolean(line))
  return lines.length ? lines.join("\n\n") : null
}
