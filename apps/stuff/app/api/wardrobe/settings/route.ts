import { NextResponse } from "next/server"
import { encrypt } from "@life-os/db/crypto"
import { db } from "@/lib/db"
import { requireStuffAccess } from "@/lib/access"
import { DEFAULT_WARDROBE_MODEL } from "@/lib/garment-analysis"

const PROVIDER = "vercel-ai-gateway"

export async function GET() {
  const access = await requireStuffAccess()
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const credential = await db.aiProviderCredential.findUnique({
    where: { workspaceId_provider: { workspaceId: access.workspaceId, provider: PROVIDER } },
    select: { label: true, modelId: true, status: true, lastUsedAt: true },
  })
  return NextResponse.json({
    connected: Boolean(credential?.status === "active"),
    label: credential?.label ?? null,
    modelId: credential?.modelId ?? DEFAULT_WARDROBE_MODEL,
    lastUsedAt: credential?.lastUsedAt ?? null,
  })
}

export async function PUT(request: Request) {
  const access = await requireStuffAccess()
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const body = await request.json() as { apiKey?: string; modelId?: string }
  const apiKey = body.apiKey?.trim()
  const modelId = body.modelId?.trim() || DEFAULT_WARDROBE_MODEL
  if (!apiKey) return NextResponse.json({ error: "An AI Gateway API key is required." }, { status: 400 })
  if (!modelId.includes("/")) return NextResponse.json({ error: "Use a gateway model ID such as openai/gpt-5.4-mini." }, { status: 400 })

  await db.aiProviderCredential.upsert({
    where: { workspaceId_provider: { workspaceId: access.workspaceId, provider: PROVIDER } },
    create: {
      workspaceId: access.workspaceId,
      provider: PROVIDER,
      label: "Wardrobe analysis",
      apiKeyEncrypted: encrypt(apiKey),
      modelId,
    },
    update: {
      apiKeyEncrypted: encrypt(apiKey),
      modelId,
      status: "active",
    },
  })
  return NextResponse.json({ connected: true, modelId })
}
