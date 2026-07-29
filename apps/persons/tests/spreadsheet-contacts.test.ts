import assert from "node:assert/strict"
import test from "node:test"
import ExcelJS from "exceljs"
import { parseSpreadsheetContacts } from "../lib/spreadsheet-contacts"

test("finds a people table below workbook context and keeps unmapped details in notes", async () => {
  const workbook = new ExcelJS.Workbook()
  const travel = workbook.addWorksheet("Travel Details")
  travel.addRow(["MANAV'S BACHELOR PARTY"])
  travel.addRow(["DATES:", "July 30–August 2"])
  travel.addRow([])
  travel.addRow(["Name", "Phone #", "Dietary restrictions", "Arrival Date", "Flight #"])
  travel.addRow(["Joseph Fryer", 4155551212, "Vegetarian", new Date("2026-07-30T00:00:00Z"), "UA 123"])
  travel.addRow(["Manav Patel", "415-555-9999", "", "", ""])
  workbook.addWorksheet("Events").addRow(["THURSDAY", "Dinner", "8:00 PM"])

  const buffer = Buffer.from(await workbook.xlsx.writeBuffer())
  const result = await parseSpreadsheetContacts(buffer, "Bach Party.xlsx")

  assert.equal(result.contacts.length, 2)
  assert.deepEqual(
    result.contacts.map(contact => `${contact.first} ${contact.last}`),
    ["Joseph Fryer", "Manav Patel"],
  )
  assert.equal(result.contacts[0].phone, "4155551212")
  assert.match(result.contacts[0].notes ?? "", /Dietary restrictions: Vegetarian/)
  assert.match(result.contacts[0].notes ?? "", /Arrival Date: 2026-07-30/)
  assert.match(result.contacts[0].notes ?? "", /Flight #: UA 123/)
  assert.match(result.contacts[0].notes ?? "", /MANAV'S BACHELOR PARTY/)
  assert.deepEqual(result.summary.ignoredSheets, ["Events"])
  assert.deepEqual(result.summary.peopleTables, [
    { sheet: "Travel Details", headerRow: 4, people: 2 },
  ])
})

test("supports first and last name columns and maps standard contact fields", async () => {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet("Contacts")
  sheet.addRow(["First Name", "Last Name", "Email Address", "Company", "City"])
  sheet.addRow(["Ada", "Lovelace", "ada@example.com", "Analytical Engines", "London"])

  const result = await parseSpreadsheetContacts(
    Buffer.from(await workbook.xlsx.writeBuffer()),
    "contacts.xlsx",
  )

  assert.equal(result.contacts.length, 1)
  assert.equal(result.contacts[0].email, "ada@example.com")
  assert.equal(result.contacts[0].company, "Analytical Engines")
  assert.equal(result.contacts[0].location, "London")
})
