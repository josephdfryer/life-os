import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { formatSchemaGaps, parsePrismaModels, schemaGaps } from "./prisma-models"

const fixture = `
model Person {
  id        String   @id
  first     String
  last      String
  workspace Workspace @relation(fields: [workspaceId], references: [id])
  workspaceId String
  notes     Note[]
  enabled   Boolean  @default(false)
  @@index([last, first])
}

model Note {
  id String @id
  body String?
  person Person @relation(fields: [personId], references: [id])
  personId String
}

enum Status {
  active
  archived
}
`

test("parsePrismaModels keeps scalar columns and drops relations", () => {
  const models = parsePrismaModels(fixture)
  assert.deepEqual(models.get("Person"), ["id", "first", "last", "workspaceId", "enabled"])
  assert.deepEqual(models.get("Note"), ["id", "body", "personId"])
  assert.equal(models.has("Status"), false)
})

test("parsePrismaModels ignores // comments including those that mention types", () => {
  const models = parsePrismaModels(`
    model Item {
      id String @id
      // name String
      sku String
    }
  `)
  assert.deepEqual(models.get("Item"), ["id", "sku"])
})

test("schemaGaps reports missing tables and columns only, not extras", () => {
  const models = parsePrismaModels(fixture)
  const live = new Map([
    ["Person", ["id", "first", "last", "workspaceId", "legacy"]],
    ["Extra", ["id"]],
  ])
  const gap = schemaGaps(models, live)
  assert.deepEqual(gap.missingTables, ["Note"])
  assert.deepEqual(gap.missingColumns, [{ table: "Person", column: "enabled" }])
  assert.match(formatSchemaGaps(gap), /missing table Note/)
  assert.match(formatSchemaGaps(gap), /missing column Person.enabled/)
})

test("the committed schema parses and Person has the public profile columns", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "../..")
  const schema = readFileSync(join(root, "packages/db/prisma/schema.prisma"), "utf8")
  const models = parsePrismaModels(schema)
  assert.ok(models.size > 40)
  const person = models.get("Person") ?? []
  assert.ok(person.includes("first"))
  assert.ok(person.includes("publicProfileEnabled"))
  assert.ok(person.includes("publicSlug"))
  assert.ok(!person.includes("workspace"))
  assert.ok(!person.includes("interactions"))
})
