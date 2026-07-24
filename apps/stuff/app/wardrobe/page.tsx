import { redirect } from "next/navigation"
import { db } from "@/lib/db"
import { requireStuffAccess } from "@/lib/access"
import WardrobeClient from "./wardrobe-client"

export const dynamic = "force-dynamic"

export default async function WardrobePage() {
  const access = await requireStuffAccess()
  if (!access) redirect("/login")

  const [items, persons, places, recentWears, credential] = await Promise.all([
    db.item.findMany({
      where: {
        workspaceId: access.workspaceId,
        OR: [{ attributes: { not: null } }, { category: "Clothing" }],
      },
      include: {
        primaryImageFile: { select: { id: true } },
        itemInteractions: {
          where: { interaction: { type: "outfit_worn" } },
          include: { interaction: { select: { timestamp: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    db.person.findMany({
      where: { workspaceId: access.workspaceId },
      select: { id: true, first: true, last: true },
      orderBy: [{ first: "asc" }, { last: "asc" }],
      take: 250,
    }),
    db.place.findMany({
      where: { workspaceId: access.workspaceId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
      take: 250,
    }),
    db.interaction.findMany({
      where: { workspaceId: access.workspaceId, type: "outfit_worn" },
      include: {
        person: { select: { first: true, last: true } },
        sourceFile: { select: { id: true } },
        itemInteractions: { include: { item: { select: { id: true, name: true } } } },
      },
      orderBy: { timestamp: "desc" },
      take: 8,
    }),
    db.aiProviderCredential.findUnique({
      where: {
        workspaceId_provider: {
          workspaceId: access.workspaceId,
          provider: "vercel-ai-gateway",
        },
      },
      select: { status: true, modelId: true },
    }),
  ])

  return (
    <WardrobeClient
      initialItems={items.map((item) => {
        const wears = item.itemInteractions
          .map(({ interaction }) => interaction.timestamp)
          .sort((a, b) => b.getTime() - a.getTime())
        return {
          id: item.id,
          name: item.name,
          assetId: item.assetId,
          category: item.category,
          color: item.color,
          imageUrl: item.primaryImageFile ? `/api/wardrobe/media/${item.primaryImageFile.id}` : null,
          wearCount: wears.length,
          lastWorn: wears[0]?.toISOString() ?? null,
          costPerWear: item.purchasePrice != null && wears.length > 0
            ? item.purchasePrice / 100 / wears.length
            : null,
        }
      })}
      persons={persons.map((person) => ({
        id: person.id,
        name: `${person.first} ${person.last ?? ""}`.trim(),
      }))}
      places={places}
      recentWears={recentWears.map((wear) => ({
        id: wear.id,
        timestamp: wear.timestamp.toISOString(),
        summary: wear.summary,
        personName: wear.person ? `${wear.person.first} ${wear.person.last ?? ""}`.trim() : null,
        imageUrl: wear.sourceFile ? `/api/wardrobe/media/${wear.sourceFile.id}` : null,
        items: wear.itemInteractions.map(({ item }) => item),
      }))}
      defaultPersonId={access.user.personId}
      initialTimestamp={localInputDateTime(new Date())}
      aiConnected={credential?.status === "active"}
      aiModelId={credential?.modelId ?? "openai/gpt-5.4-mini"}
    />
  )
}

function localInputDateTime(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}
