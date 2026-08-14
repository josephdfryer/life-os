// Shared client-side upload flow, used by both the Files page and the chat
// composer. Kept in one place because the sequence is load-bearing: the intent
// binds MIME type, size, and SHA-256, the PUT must send back exactly the signed
// headers, and only the finalize call verifies the stored object and creates the
// ImportedFile row. A second copy of this would drift.

export type UploadedFile = {
  id: string
  filename: string
  processingState: string
}

export type UploadProgress = (stage: "hashing" | "authorizing" | "uploading" | "verifying", filename: string) => void

// Read a JSON body only after confirming the response is OK. A failing route can
// return an HTML error page, and calling .json() on that throws the parser's own
// message — which surfaced to the user as Safari's "The string did not match the
// expected pattern" instead of the actual 500. Report the status we got.
async function readJson(response: Response, fallback: string) {
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(body?.error ?? `${fallback} (HTTP ${response.status})`)
  return body
}

export async function uploadFile(
  file: File,
  options: { storeOnly?: boolean; onProgress?: UploadProgress } = {},
): Promise<UploadedFile> {
  const { storeOnly = false, onProgress } = options

  onProgress?.("hashing", file.name)
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer())
  const checksumSha256 = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("")

  onProgress?.("authorizing", file.name)
  const intentResponse = await fetch("/api/files/upload-intents", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      checksumSha256,
      storeOnly,
    }),
  })
  const intent = await readJson(intentResponse, "Upload authorization failed")

  onProgress?.("uploading", file.name)
  const uploadResponse = await fetch(intent.upload.url, { method: "PUT", headers: intent.upload.headers, body: file })
  if (!uploadResponse.ok) throw new Error(`Upload failed (${uploadResponse.status})`)

  onProgress?.("verifying", file.name)
  const completeResponse = await fetch(`/api/files/upload-intents/${intent.intentId}/complete`, { method: "POST" })
  const completed = await readJson(completeResponse, "Upload verification failed")

  return completed.file as UploadedFile
}
