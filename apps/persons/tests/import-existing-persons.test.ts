import assert from "node:assert/strict"
import test from "node:test"
import type { Person } from "../types"
import { loadAllExistingPersons } from "../app/import/persons/load-existing-persons"

function person(id: string): Person {
  return {
    id,
    first: id,
    last: "",
    emails: [],
    phones: [],
  } as unknown as Person
}

test("duplicate matching loads every paginated person before resolving", async () => {
  const requested: string[] = []
  const pages = [
    { persons: [person("a"), person("b")], hasMore: true },
    { persons: [person("b"), person("manav")], hasMore: false },
  ]
  const fetcher = async (input: string | URL | Request) => {
    const url = String(input)
    requested.push(url)
    const page = Number(new URL(url, "https://persons.test").searchParams.get("page"))
    return Response.json(pages[page])
  }

  const result = await loadAllExistingPersons(fetcher as typeof fetch)

  assert.deepEqual(result.map(value => value.id), ["a", "b", "manav"])
  assert.deepEqual(requested, [
    "/api/persons?minimal=true&limit=200&page=0&sort=name",
    "/api/persons?minimal=true&limit=200&page=1&sort=name",
  ])
})

test("duplicate matching rejects a failed page instead of using a partial list", async () => {
  let page = 0
  const fetcher = async () => {
    page++
    return page === 1
      ? Response.json({ persons: [person("a")], hasMore: true })
      : Response.json({ error: "failed" }, { status: 500 })
  }

  await assert.rejects(
    loadAllExistingPersons(fetcher as typeof fetch),
    /Could not load existing people for duplicate checking \(500\)/,
  )
})
