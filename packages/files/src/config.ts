export type FileIntelligenceFlags = {
  ingestion: boolean
  reviewProposals: boolean
  safeAuto: boolean
  nightlyTheory: boolean
}

function enabled(name: string, fallback = false) {
  const value = process.env[name]
  if (value == null) return fallback
  return value === "1" || value.toLowerCase() === "true"
}

export function fileIntelligenceFlags(): FileIntelligenceFlags {
  return {
    ingestion: enabled("FILE_INTELLIGENCE_INGESTION", true),
    reviewProposals: enabled("FILE_INTELLIGENCE_REVIEW_PROPOSALS"),
    safeAuto: enabled("FILE_INTELLIGENCE_SAFE_AUTO"),
    nightlyTheory: enabled("FILE_INTELLIGENCE_NIGHTLY_THEORY"),
  }
}
