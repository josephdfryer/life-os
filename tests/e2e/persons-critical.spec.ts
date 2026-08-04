import { expect, test } from "@playwright/test"

test.describe.serial("Persons critical journeys", () => {
  test("People create, read, update, and delete through the browser/API boundary", async ({ page, request }, testInfo) => {
    // Unique per attempt. The test deletes its Person at the end, but a failed
    // attempt leaves it behind — so a retry matched two elements and failed on
    // a strict-mode violation instead of on whatever actually broke.
    const surname = `Person${testInfo.retry || ""}${Date.now().toString().slice(-6)}`
    const fullName = `E2E ${surname}`

    // "/persons" is canonical; "/people" has been a redirect stub since the
    // rename in 05c7ce2. Go straight to the real route.
    await page.goto("/persons")
    await page.getByRole("button", { name: "Add person", exact: true }).click()
    await page.locator('input[placeholder="Marcus"]').fill("E2E")
    await page.locator('input[placeholder="Chen"]').fill(surname)
    await page.getByRole("button", { name: "Add Person", exact: true }).click()
    await expect(page.getByText(fullName, { exact: true })).toBeVisible()

    const link = page.getByRole("link", { name: new RegExp(fullName) }).first()
    const href = await link.getAttribute("href")
    expect(href).toMatch(/^\/persons\//)
    const id = href!.split("/").pop()!

    const update = await request.patch(`/api/persons/${id}`, {
      data: { first: "Updated", last: "Person" },
    })
    expect(update.ok()).toBeTruthy()
    const read = await request.get(`/api/persons/${id}`)
    expect((await read.json()).first).toBe("Updated")
    expect((await request.delete(`/api/persons/${id}`)).status()).toBe(204)
    expect((await request.get(`/api/persons/${id}`)).status()).toBe(404)
  })

  test("workspace isolation hides a foreign Person", async ({ request }) => {
    expect((await request.get("/api/persons/e2e-foreign-person")).status()).toBe(404)
  })

  test("merge preserves related interactions", async ({ request }) => {
    const merge = await request.post("/api/contacts/merge", {
      data: { keepId: "e2e-keeper", deleteId: "e2e-loser" },
    })
    expect(merge.ok()).toBeTruthy()
    expect((await request.get("/api/persons/e2e-loser")).status()).toBe(404)
    const keeper = await (await request.get("/api/persons/e2e-keeper")).json()
    expect(keeper.interactions).toEqual(expect.arrayContaining([
      expect.objectContaining({ summary: "Interaction that must survive merge" }),
    ]))
  })

  test("staged Inbox acceptance creates a canonical interaction", async ({ request }) => {
    const accepted = await request.patch("/api/inbox/e2e-staged", {
      data: { action: "accept", personId: "e2e-keeper" },
    })
    expect(accepted.ok()).toBeTruthy()
    const keeper = await (await request.get("/api/persons/e2e-keeper")).json()
    expect(keeper.interactions).toEqual(expect.arrayContaining([
      expect.objectContaining({ summary: expect.stringContaining("Staged interaction acceptance") }),
    ]))
  })

  test("invalid merge payload returns a stable validation error", async ({ request }) => {
    const response = await request.post("/api/contacts/merge", {
      data: { keepId: "same", deleteId: "same" },
    })
    expect(response.status()).toBe(400)
    const body = await response.json()
    expect(body.error.code).toBe("bad_request")
    expect(body.error.details.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "deleteId" }),
    ]))
  })
})
