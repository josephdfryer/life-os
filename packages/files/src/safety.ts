const CONSEQUENTIAL_ASSISTANT_TOOLS = new Set(["capture_note", "log_interaction"])

export function fileEvidenceAllowsAssistantTool(toolName: string, hasReturnedFileEvidence: boolean) {
  return !hasReturnedFileEvidence || !CONSEQUENTIAL_ASSISTANT_TOOLS.has(toolName)
}
