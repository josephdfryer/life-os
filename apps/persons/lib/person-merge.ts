import type { Person } from "@/types"

export type MergeChoice = "a" | "b" | "both"

export type MergePerson = Person & {
  interactionCount: number
  planCount: number
}

export const MERGE_FIELDS: { key: keyof Person; label: string; multiline?: boolean }[] = [
  { key: "first", label: "First name" },
  { key: "last", label: "Last name" },
  { key: "nickname", label: "Nickname" },
  { key: "title", label: "Title" },
  { key: "headline", label: "Headline" },
  { key: "company", label: "Company" },
  { key: "location", label: "Location" },
  { key: "birthday", label: "Birthday" },
  { key: "closeness", label: "Closeness" },
  { key: "linkedin", label: "LinkedIn" },
  { key: "twitter", label: "Twitter" },
  { key: "website", label: "Website" },
  { key: "facebook", label: "Facebook" },
  { key: "instagram", label: "Instagram" },
  { key: "notes", label: "Notes", multiline: true },
]

export function initialMergeChoices(a: Person, b: Person): Record<string, MergeChoice> {
  const choices: Record<string, MergeChoice> = {}
  for (const { key } of MERGE_FIELDS) {
    const aValue = a[key]
    const bValue = b[key]
    if (key === "notes" && aValue && bValue) {
      choices[key] = "both"
    } else if (aValue && !bValue) {
      choices[key] = "a"
    } else if (!aValue && bValue) {
      choices[key] = "b"
    } else if (key === "closeness") {
      choices[key] = a.closeness >= b.closeness ? "a" : "b"
    } else if (typeof aValue === "string" && typeof bValue === "string") {
      choices[key] = aValue.length >= bValue.length ? "a" : "b"
    } else {
      choices[key] = "a"
    }
  }
  return choices
}

export function buildMergeFields(
  a: Person,
  b: Person,
  choices: Record<string, MergeChoice>,
) {
  const fields: Record<string, unknown> = {}
  for (const { key } of MERGE_FIELDS) {
    const aValue = a[key]
    const bValue = b[key]
    const choice = choices[key] ?? "a"
    fields[key] = key === "notes" && choice === "both"
      ? [aValue, bValue].filter(Boolean).join("\n\n---\n\n")
      : choice === "a" ? aValue : bValue
  }

  for (const key of ["tags", "values", "emails", "phones"] as const) {
    const aValues = Array.isArray(a[key]) ? a[key] as string[] : []
    const bValues = Array.isArray(b[key]) ? b[key] as string[] : []
    fields[key] = [...new Set([...aValues, ...bValues])]
  }
  return fields
}
