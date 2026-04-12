import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { assignColor } from "@/lib/colors"
import { storeFile } from "@/lib/file-storage"
import type { ImportedPerson } from "@/types"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { results, fileData }: { results: ImportedPerson[]; fileData?: { name: string; format: string; content: string } } = body

    // Store the imported file if provided
    let importedFileId: string | null = null
    if (fileData) {
      const importedFile = await storeFile(fileData.name, fileData.format, fileData.content)
      importedFileId = importedFile.id
    }

    // Count existing persons for color assignment
    const existingCount = await db.person.count()

    const created: { personId: string; name: string; interactionCount: number }[] = []

    for (let i = 0; i < results.length; i++) {
      const result = results[i]

      // Use explicit match from the resolve step, or fall back to name lookup
      let personId: string | null = null
      if (result.matchedPersonId) {
        // User manually confirmed this match during the resolve step
        const existing = await db.person.findUnique({ where: { id: result.matchedPersonId } })
        if (existing) personId = existing.id
      } else if (!result.isNew) {
        // Fallback: try exact name match
        const nameParts = result.name.split(" ")
        const first = nameParts[0]
        const last = nameParts.slice(1).join(" ")
        const existing = await db.person.findFirst({
          where: { first: { equals: first }, last: { equals: last } },
        })
        if (existing) personId = existing.id
      }

      // Create new person if needed
      if (!personId) {
        const nameParts = result.name.split(" ")
        const first = nameParts[0] || result.name
        const last = nameParts.slice(1).join(" ") || "—"
        const { color, colorSoft } = assignColor(existingCount + i)

        const person = await db.person.create({
          data: {
            first,
            last,
            headline: result.guessedHeadline || null,
            closeness: result.guessedCloseness ?? 2,
            tags: JSON.stringify(result.guessedTags ?? []),
            values: JSON.stringify([]),
            color,
            colorSoft,
          },
        })
        personId = person.id
      }

      // Create interactions
      for (const ix of result.interactions) {
        const timestamp = parseDate(ix.date)

        // Create event
        const event = await db.event.create({
          data: {
            name: ix.summary?.slice(0, 80) ?? `${ix.eventType} with ${result.name}`,
            type: ix.eventType,
            timestamp,
          },
        })

        // Create interaction
        await db.interaction.create({
          data: {
            personId,
            eventId: event.id,
            type: ix.eventType,
            timestamp,
            summary: ix.summary || null,
            emotionalWeight: ix.emotionalWeight || null,
            outcome: ix.outcome || null,
            actionItems: ix.keyTopics?.length ? JSON.stringify(ix.keyTopics) : null,
            sourceFileId: importedFileId,
          },
        })
      }

      created.push({ personId, name: result.name, interactionCount: result.interactions.length })
    }

    return NextResponse.json({ created })
  } catch (error) {
    console.error("Import confirm error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    )
  }
}

function parseDate(dateStr: string): Date {
  if (!dateStr) return new Date()
  // Handle "YYYY-MM-DD" or approximate descriptions
  const match = dateStr.match(/(\d{4})-(\d{2})-(\d{2})/)
  if (match) return new Date(dateStr)
  // Fallback to now
  return new Date()
}
