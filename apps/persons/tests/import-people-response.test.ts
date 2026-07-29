import assert from "node:assert/strict"
import test from "node:test"
import { bulkCreatePeopleContract } from "@life-os/contracts"
import { requireSuccessfulImportResponse } from "../app/import/persons/import-response"

test("bulk person imports accept a person with one name", () => {
  const result = bulkCreatePeopleContract.safeParse({
    contacts: [{ first: "Manav", last: "", phone: "555-0100" }],
  })
  assert.equal(result.success, true)
})

test("import mutations surface structured validation errors", async () => {
  const response = new Response(JSON.stringify({
    error: {
      message: "Request body failed validation",
      details: {
        issues: [{ path: "contacts.0.first", message: "Too small" }],
      },
    },
  }), {
    status: 400,
    headers: { "content-type": "application/json" },
  })

  await assert.rejects(
    requireSuccessfulImportResponse(response, "Import failed"),
    /Request body failed validation \(contacts\.0\.first: Too small\)/,
  )
})

test("import mutations return successful response data", async () => {
  const result = await requireSuccessfulImportResponse<{ created: number }>(
    Response.json({ created: 14 }),
    "Import failed",
  )
  assert.equal(result.created, 14)
})
