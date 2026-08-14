export const MAX_FILE_BYTES = 100 * 1024 * 1024
export const UPLOAD_URL_TTL_SECONDS = 10 * 60
export const FILE_PROCESSOR_VERSION = "file-intelligence-v1"

export const PERSON_ROLES = [
  "subject", "author", "sender", "recipient", "signer",
  "participant", "issuer", "owner", "mentioned",
] as const

export type PersonRole = typeof PERSON_ROLES[number]
export type FileFinalState = "ready" | "partial" | "store_only" | "failed"

export type SourceLocator = {
  page?: number
  section?: string
  sheet?: string
  cellRange?: string
  imageRegion?: { x: number; y: number; width: number; height: number }
  startSeconds?: number
  endSeconds?: number
  lineStart?: number
  lineEnd?: number
}

export type ExtractedChunk = {
  ordinal: number
  content: string
  locatorType: "page" | "section" | "cell" | "image_region" | "audio_timestamp" | "line"
  locator: SourceLocator
}

export type ExtractedFile = {
  chunks: ExtractedChunk[]
  complete: boolean
  warning?: string
  extractionMethod: string
}

export type ProposedMention = {
  chunkOrdinal: number
  entityType: "Person" | "Place" | "Item" | "Group"
  sourceText: string
  role: string
  exactQuote: string
  confidence: number
  email?: string
  phone?: string
  externalId?: string
  employer?: string
  group?: string
  address?: string
}

export type ProposedClaim = {
  chunkOrdinal: number
  assertion: string
  classification: "explicit" | "inferred"
  claimType?: string
  exactQuote: string
  confidence: number
  subjectMentionIndexes: number[]
  subjectRoles: string[]
  occurredAt?: string
  structuredValue?: Record<string, unknown>
  proposedGraphAction?:
    | { kind: "event"; name: string; eventType: string; occurredAt: string }
    | { kind: "state"; entityMentionIndex: number; stateType: string; stateValue: string; severity?: number }
    | { kind: "none" }
}
