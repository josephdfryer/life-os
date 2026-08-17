// Compound filter model for the Persons directory (/persons). Pure — no
// React/DOM imports — so both the client toolbar and the API route share one
// definition of what a filter is and how it (de)serializes.
//
// Deliberately AND-only: every Filter in a Filter[] narrows the result set
// further. No OR, no nested groups. That's what keeps "compound filters"
// from turning into a query builder — see docs/PERSONS_ARCHITECTURE.md if
// this ever needs to grow real boolean logic.

export type FilterField =
  | "first" | "last" | "email" | "phone" | "company" | "title" | "headline"
  | "birthday" | "location" | "linkedin" | "twitter" | "website" | "facebook"
  | "instagram" | "notes" | "tags" | "group"

export type FilterOperator = "has_value" | "is_empty" | "contains" | "is_any_of"

export type Filter = {
  id: string
  field: FilterField
  operator: FilterOperator
  value: string | string[]
  // Precomputed chip label, used when `value` isn't itself human-readable
  // (e.g. group filters store group ids in `value` but display group names).
  label?: string
}

export type FieldKind = "presence" | "contains" | "multiselect"

export const FIELD_DEFS: Record<FilterField, { label: string; kind: FieldKind; group: "fields" | "details" | "organize" }> = {
  first:     { label: "First name", kind: "presence", group: "fields" },
  last:      { label: "Last name",  kind: "presence", group: "fields" },
  email:     { label: "Email",      kind: "presence", group: "fields" },
  phone:     { label: "Phone",      kind: "presence", group: "fields" },
  company:   { label: "Company",    kind: "contains",  group: "details" },
  title:     { label: "Title",      kind: "contains",  group: "details" },
  headline:  { label: "Headline",   kind: "contains",  group: "details" },
  birthday:  { label: "Birthday",   kind: "presence", group: "fields" },
  location:  { label: "Location",   kind: "contains",  group: "details" },
  linkedin:  { label: "LinkedIn",   kind: "presence", group: "fields" },
  twitter:   { label: "Twitter",    kind: "presence", group: "fields" },
  website:   { label: "Website",    kind: "presence", group: "fields" },
  facebook:  { label: "Facebook",   kind: "presence", group: "fields" },
  instagram: { label: "Instagram",  kind: "presence", group: "fields" },
  notes:     { label: "Notes",      kind: "presence", group: "fields" },
  tags:      { label: "Tags",       kind: "multiselect", group: "organize" },
  group:     { label: "Group",      kind: "multiselect", group: "organize" },
}

export const FIELD_ORDER: FilterField[] = [
  "tags", "group",
  "title", "company", "location", "headline",
  "first", "last", "email", "phone", "birthday",
  "linkedin", "twitter", "website", "facebook", "instagram", "notes",
]

// value/label pairs a presence-kind field can be filtered by.
export const PRESENCE_OPERATORS: { operator: FilterOperator; label: string }[] = [
  { operator: "has_value", label: "has a value" },
  { operator: "is_empty",  label: "is empty" },
]

export function newFilterId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `f_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

export function filtersToParam(filters: Filter[]): string {
  return JSON.stringify(filters.map(({ field, operator, value }) => ({ field, operator, value })))
}

export function filtersFromParam(raw: string | null | undefined): Filter[] {
  if (!raw) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const out: Filter[] = []
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue
    const { field, operator, value } = item as Record<string, unknown>
    if (typeof field !== "string" || !(field in FIELD_DEFS)) continue
    if (operator !== "has_value" && operator !== "is_empty" && operator !== "contains" && operator !== "is_any_of") continue
    if (operator === "contains" && typeof value !== "string") continue
    if (operator === "is_any_of" && !Array.isArray(value)) continue
    if ((operator === "has_value" || operator === "is_empty") && typeof value !== "undefined" && value !== null) {
      // presence filters carry no meaningful value; normalize to "" so the shape stays uniform
    }
    out.push({
      id: newFilterId(),
      field: field as FilterField,
      operator,
      value: operator === "is_any_of" ? (value as string[]).filter(v => typeof v === "string") : operator === "contains" ? (value as string) : "",
    })
  }
  return out
}

export function filterChipLabel(f: Filter): string {
  if (f.label) return f.label
  const def = FIELD_DEFS[f.field]
  if (f.operator === "has_value") return `Has ${def.label.toLowerCase()}`
  if (f.operator === "is_empty") return `No ${def.label.toLowerCase()}`
  if (f.operator === "contains") return `${def.label} contains "${f.value}"`
  if (f.operator === "is_any_of") {
    const values = f.value as string[]
    const preview = values.slice(0, 2).join(", ")
    const extra = values.length > 2 ? ` +${values.length - 2}` : ""
    return `${def.label}: ${preview}${extra}`
  }
  return def.label
}
