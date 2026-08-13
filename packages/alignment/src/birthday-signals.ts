// Birthday-today detection as an alignment signal — Persons' Today page and
// Home's Nudges widget both want "who needs attention", and a birthday today
// is exactly that, not a separate concern from a relationship gap. Only
// *today's* birthdays are a signal; "this week" stays an informational,
// lower-urgency list owned by Persons' own Today page.

import type { AlignmentSignal } from "./types"
import { isBirthdayToday, birthdayTurningAge } from "./birthday"

const DEFAULT_TZ = "America/Los_Angeles"

export async function getBirthdaySignals(workspaceId: string, tz = DEFAULT_TZ): Promise<AlignmentSignal[]> {
  const { db } = await import("@life-os/db")
  const persons = await db.person.findMany({
    where: {
      workspaceId,
      birthday: { not: null },
      // Exclude the self Person — your own birthday isn't a nudge to reach out.
      NOT: { tags: { contains: '"self"' } },
    },
    select: { id: true, first: true, last: true, birthday: true },
  })

  const signals: AlignmentSignal[] = []
  for (const p of persons) {
    if (!isBirthdayToday(p.birthday, tz)) continue
    const age = birthdayTurningAge(p.birthday, tz)
    signals.push({
      kind: "birthday",
      // Always exactly "due today" — a birthday doesn't graduate in
      // urgency the way a relationship gap does, so this isn't compared
      // against a threshold the way relationshipGapScore's output is.
      severity: 1,
      subject: `${p.first} ${p.last}`,
      detail: age ? `Turning ${age} today` : "Birthday today",
      personId: p.id,
    })
  }
  return signals
}
