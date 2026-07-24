import { decrypt } from "@life-os/db/crypto"
import { db } from "@/lib/db"
import { readStoredFile } from "@/lib/media-storage"

export const DEFAULT_WARDROBE_MODEL = "openai/gpt-5.4-mini"
const PROMPT_VERSION = "wardrobe-garments-v1"

export type GarmentProposal = {
  name: string
  garmentType: string
  category: string
  colors: string[]
  material: string | null
  pattern: string | null
  season: string[]
  formality: string | null
  brand: string | null
  confidence: number
}

const RESPONSE_SCHEMA = {
  name: "wardrobe_garments",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["garments"],
    properties: {
      garments: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "garmentType", "category", "colors", "material", "pattern", "season", "formality", "brand", "confidence"],
          properties: {
            name: { type: "string" },
            garmentType: { type: "string" },
            category: { type: "string" },
            colors: { type: "array", items: { type: "string" } },
            material: { type: ["string", "null"] },
            pattern: { type: ["string", "null"] },
            season: { type: "array", items: { type: "string" } },
            formality: { type: ["string", "null"] },
            brand: { type: ["string", "null"] },
            confidence: { type: "number", minimum: 0, maximum: 1 },
          },
        },
      },
    },
  },
}

export async function analyzeGarments(workspaceId: string, sourceFileId: string) {
  const [credential, sourceFile] = await Promise.all([
    db.aiProviderCredential.findUnique({
      where: { workspaceId_provider: { workspaceId, provider: "vercel-ai-gateway" } },
    }),
    db.importedFile.findFirst({ where: { id: sourceFileId, workspaceId } }),
  ])
  if (!credential || credential.status !== "active") {
    throw new Error("Connect a Vercel AI Gateway key before running garment analysis.")
  }
  if (!sourceFile) throw new Error("Photograph not found.")

  const run = await db.aiAnalysisRun.create({
    data: {
      workspaceId,
      credentialId: credential.id,
      sourceFileId,
      provider: credential.provider,
      modelId: credential.modelId,
      status: "running",
      promptVersion: PROMPT_VERSION,
    },
  })

  try {
    const image = await readStoredFile(sourceFile.filePath)
    const response = await fetch("https://ai-gateway.vercel.sh/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${decrypt(credential.apiKeyEncrypted)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: credential.modelId,
        messages: [{
          role: "user",
          content: [
            {
              type: "text",
              text: "Identify every clearly visible garment in this photograph. Describe only visible evidence. Use concise, human-editable names. Do not identify people or infer sensitive traits.",
            },
            {
              type: "image_url",
              image_url: { url: `data:${sourceFile.mimeType ?? "image/jpeg"};base64,${image.toString("base64")}` },
            },
          ],
        }],
        response_format: { type: "json_schema", json_schema: RESPONSE_SCHEMA },
      }),
    })

    const payload = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>
      usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number }
      error?: { message?: string }
    }
    if (!response.ok) throw new Error(payload.error?.message ?? `AI Gateway returned ${response.status}.`)

    const content = payload.choices?.[0]?.message?.content
    if (!content) throw new Error("AI Gateway returned no garment analysis.")
    const parsed = JSON.parse(content) as { garments: GarmentProposal[] }

    await db.$transaction([
      db.aiAnalysisRun.update({
        where: { id: run.id },
        data: {
          status: "completed",
          completedAt: new Date(),
          output: JSON.stringify(parsed),
          inputTokens: payload.usage?.prompt_tokens,
          outputTokens: payload.usage?.completion_tokens,
          estimatedCost: payload.usage?.cost,
        },
      }),
      db.aiProviderCredential.update({
        where: { id: credential.id },
        data: { lastUsedAt: new Date() },
      }),
    ])

    return { runId: run.id, garments: parsed.garments, usage: payload.usage ?? null }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Garment analysis failed."
    await db.aiAnalysisRun.update({
      where: { id: run.id },
      data: { status: "failed", completedAt: new Date(), error: message },
    })
    throw error
  }
}
