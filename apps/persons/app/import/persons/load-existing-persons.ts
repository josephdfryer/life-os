import type { Person } from "@/types"

const MATCH_PAGE_SIZE = 200
const MAX_MATCH_PAGES = 500

type MinimalPersonsPage = {
  persons?: Person[]
  hasMore?: boolean
}

export async function loadAllExistingPersons(
  fetcher: typeof fetch = fetch,
): Promise<Person[]> {
  const people = new Map<string, Person>()

  for (let page = 0; page < MAX_MATCH_PAGES; page++) {
    const response = await fetcher(
      `/api/persons?minimal=true&limit=${MATCH_PAGE_SIZE}&page=${page}&sort=name`,
    )
    if (!response.ok) {
      throw new Error(`Could not load existing people for duplicate checking (${response.status}).`)
    }

    const body = await response.json() as MinimalPersonsPage | Person[]
    const rows = Array.isArray(body) ? body : body.persons ?? []
    for (const person of rows) people.set(person.id, person)

    if (Array.isArray(body) || !body.hasMore) return Array.from(people.values())
    if (rows.length === 0) {
      throw new Error("Duplicate checking stopped because an expected people page was empty.")
    }
  }

  throw new Error("Duplicate checking exceeded the safe pagination limit.")
}
