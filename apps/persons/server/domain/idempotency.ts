import { db } from "@/lib/db"

export function normalizeSourceMarker(source: string, sourceId: string) {
  return `${source}:${sourceId}`
}

export function sourceMarkers(notes: string | null | undefined) {
  return (notes ?? "")
    .split(/\s+/)
    .map(part => part.trim())
    .filter(part => /^[a-z0-9_-]+:.+/i.test(part))
}

export async function findInteractionByExactSource(source: string, sourceId: string, personId?: string | null, workspaceId = "default-workspace") {
  const marker = normalizeSourceMarker(source, sourceId)
  const candidates = await db.interaction.findMany({
    where: {
      ...(personId ? { personId } : {}),
      workspaceId,
      notes: { contains: marker },
    },
    select: { id: true, notes: true },
    take: 20,
  })

  return candidates.find(candidate => sourceMarkers(candidate.notes).includes(marker)) ?? null
}

export function appendUniqueLine(existing: string | null | undefined, next: string) {
  const clean = existing?.trim()
  if (!clean) return next
  if (clean.split(/\n+/).map(line => line.trim()).includes(next.trim())) return clean
  return `${clean}\n${next}`
}
