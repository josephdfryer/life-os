// Untrusted file content must not be able to talk the assistant into changing
// the graph. Once a tool has returned file evidence into the turn, anything with
// side effects is refused for the rest of that turn.
//
// This used to work by naming the consequential tools:
//
//   const CONSEQUENTIAL = new Set(["capture_note", "log_interaction"])
//
// which meant every write tool added later was permitted by default — the guard
// failed OPEN, and was safe only because the assistant could barely write. It now
// keys off the tool's declared capability, so the default is refusal and a tool
// nobody classified is treated as the most dangerous kind.
export type GuardedCapability = "read" | "write" | "destructive"

export function fileEvidenceAllowsCapability(
  capability: GuardedCapability,
  hasReturnedFileEvidence: boolean,
): boolean {
  if (!hasReturnedFileEvidence) return true
  return capability === "read"
}

// Callers resolve a tool name against their own registry; an unknown name must
// resolve to "destructive" so a typo or a stale registry cannot open a hole.
export function capabilityOrMostRestrictive(
  capability: GuardedCapability | undefined | null,
): GuardedCapability {
  return capability ?? "destructive"
}
