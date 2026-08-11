import assert from "node:assert/strict"
import { test } from "node:test"
import {
  appleDateToDate,
  buildPersonMatchIndexes,
  contactFromMessage,
  matchPersonForContact,
  phoneFromJid,
  stableSourceId,
  type WhatsAppMessageRow,
} from "./whatsapp-sync"

function message(overrides: Partial<WhatsAppMessageRow> = {}): WhatsAppMessageRow {
  return {
    messageId: 42,
    stanzaId: "stanza-42",
    text: "hello",
    appleDate: 0,
    isFromMe: 0,
    fromJid: "14155551212@s.whatsapp.net",
    toJid: null,
    chatJid: "14155551212@s.whatsapp.net",
    partnerName: "Ada Lovelace",
    groupInfoId: null,
    messageType: 0,
    ...overrides,
  }
}

test("extracts a normalized phone from a direct WhatsApp JID", () => {
  assert.equal(phoneFromJid("14155551212:3@s.whatsapp.net"), "14155551212")
  assert.equal(phoneFromJid("120363000000@g.us"), null)
  assert.equal(phoneFromJid("123456789@lid"), null)
})

test("uses the one-to-one chat identity for incoming and outgoing messages", () => {
  assert.deepEqual(contactFromMessage(message()), {
    phone: "14155551212",
    displayName: "Ada Lovelace",
    direction: "inbound",
  })
  assert.equal(contactFromMessage(message({ isFromMe: 1 }))?.direction, "outbound")
})

test("rejects group conversations", () => {
  assert.equal(contactFromMessage(message({ chatJid: "120363000000@g.us" })), null)
  assert.equal(contactFromMessage(message({ groupInfoId: 9 })), null)
})

test("prefers WhatsApp stanza IDs for durable deduplication", () => {
  assert.equal(stableSourceId(message()), "stanza-42")
  assert.equal(stableSourceId(message({ stanzaId: null })), "42")
})

test("converts WhatsApp Core Data timestamps from the Apple epoch", () => {
  assert.equal(appleDateToDate(0).getTime() > 0, true)
  assert.equal(appleDateToDate(60).toISOString(), "2001-01-01T00:01:00.000Z")
})

test("matches a WhatsApp contact by a unique exact Person name when the phone is not stored", () => {
  const qin = { id: "qin", first: "Qin", last: "Fryer", phones: "[]" }
  const indexes = buildPersonMatchIndexes([qin], normalizePhone)

  assert.equal(matchPersonForContact({ phone: "17025550000", displayName: "  QIN   Fryer " }, indexes)?.id, "qin")
})

test("does not trust an exact name shared by multiple People", () => {
  const indexes = buildPersonMatchIndexes([
    { id: "one", first: "Alex", last: "Smith", phones: "[]" },
    { id: "two", first: "Alex", last: "Smith", phones: "[]" },
  ], normalizePhone)

  assert.equal(matchPersonForContact({ phone: "17025550000", displayName: "Alex Smith" }, indexes), null)
})

test("does not trust a phone number shared by multiple People", () => {
  const indexes = buildPersonMatchIndexes([
    { id: "one", first: "One", last: "Person", phones: '["+1 702 555 0000"]' },
    { id: "two", first: "Two", last: "Person", phones: '["+1 702 555 0000"]' },
  ], normalizePhone)

  assert.equal(matchPersonForContact({ phone: "17025550000", displayName: "Unknown" }, indexes), null)
})

function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, "")
  return digits || null
}
