export type RawItem = {
  source: "whatsapp" | "calls" | "imessage" | "gmail" | "calendar"
  id: string
  timestamp: string
  body: string
  participants: Array<{ name?: string; identifier: string }>
  durationSeconds?: number
  archivePath?: string
  dbInteractionId?: string
}

export type TriagedItem = RawItem & {
  worthExtracting: boolean
  triageReason: string
}

export type ActionItem = {
  description: string
  deadline?: string
}

export type ExtractedParticipant = {
  name: string
  email?: string
  phone?: string
  emotional_weight?: -2 | -1 | 0 | 1 | 2
  outcomes?: string[]
  action_items?: ActionItem[]
}

export type Extraction = {
  event: {
    type: "meeting" | "call" | "email_thread" | "message_thread"
    title: string
    date: string
    duration_minutes?: number
    status: "completed" | "upcoming"
    notes?: string
    raw_archive_path: string
  }
  participants: ExtractedParticipant[]
  places_mentioned?: string[]
  plans_mentioned?: string[]
  my_action_items?: ActionItem[]
}

export type ResolvedParticipant = ExtractedParticipant & {
  personId?: string
}

export type ResolvedExtraction = Omit<Extraction, "participants"> & {
  rawItem: RawItem
  participants: ResolvedParticipant[]
  resolvedPlaceIds: string[]
  resolvedPlanIds: string[]
}

export type SynthesisState = {
  lastProcessedDate: string
  updatedAt: string
}

export type CaptureState = {
  whatsapp?: { lastMessageId: number; updatedAt: string }
  calls?: { lastCallId: number; updatedAt: string }
  synthesis?: SynthesisState
}
