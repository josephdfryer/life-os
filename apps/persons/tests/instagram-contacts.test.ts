import test from "node:test"
import assert from "node:assert/strict"
import { parseInstagramContacts } from "@/lib/instagram-contacts"

const FOLLOWING_JSON = JSON.stringify({
  relationships_following: [
    { title: "", media_list_data: [], string_list_data: [{ href: "https://www.instagram.com/adalovelace", value: "adalovelace", timestamp: 1700000000 }] },
    { title: "", media_list_data: [], string_list_data: [{ href: "https://www.instagram.com/gracehopper", value: "gracehopper", timestamp: 1700000001 }] },
  ],
})

const FOLLOWERS_JSON = JSON.stringify([
  { title: "", media_list_data: [], string_list_data: [{ href: "https://www.instagram.com/adalovelace", value: "adalovelace", timestamp: 1700000000 }] },
])

test("parses the wrapped following.json shape", () => {
  const contacts = parseInstagramContacts(FOLLOWING_JSON, "following")
  assert.equal(contacts.length, 2)
  assert.equal(contacts[0].instagram, "adalovelace")
  assert.equal(contacts[0].first, "adalovelace")
  assert.equal(contacts[0].email, null)
  assert.equal(contacts[0].sourceId, "instagram:adalovelace")
  assert.match(contacts[0].notes ?? "", /Instagram following export/)
})

test("parses the bare-array followers_N.json shape", () => {
  const contacts = parseInstagramContacts(FOLLOWERS_JSON, "follower")
  assert.equal(contacts.length, 1)
  assert.equal(contacts[0].instagram, "adalovelace")
  assert.match(contacts[0].notes ?? "", /Instagram followers export/)
})

test("dedupes repeated usernames within one file", () => {
  const dup = JSON.stringify([
    { string_list_data: [{ value: "adalovelace" }] },
    { string_list_data: [{ value: "adalovelace" }] },
  ])
  assert.equal(parseInstagramContacts(dup, "follower").length, 1)
})

test("returns an empty list for invalid JSON rather than throwing", () => {
  assert.deepEqual(parseInstagramContacts("not json", "follower"), [])
})

test("skips entries with no username", () => {
  const missing = JSON.stringify([{ string_list_data: [{ href: "https://www.instagram.com/x" }] }])
  assert.deepEqual(parseInstagramContacts(missing, "follower"), [])
})
