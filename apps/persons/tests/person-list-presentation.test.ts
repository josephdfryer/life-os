import assert from "node:assert/strict"
import test from "node:test"
import {
  interactionSourceLabel,
  personContext,
  relationshipStatus,
} from "../lib/person-list-presentation"

test("relationship status explains overdue cadence instead of exposing a score", () => {
  assert.deepEqual(relationshipStatus({
    activePlan: null,
    attentionScore: 1.5,
    daysSinceLast: 15,
    lastInteractionDate: "2026-07-27T00:00:00.000Z",
    closeness: 4,
  }), {
    label: "Due for a touch",
    detail: "5d past usual",
    tone: "attention",
  })
})

test("an active plan is surfaced as the actionable relationship state", () => {
  assert.deepEqual(relationshipStatus({
    activePlan: { id: "plan-1", text: "Ask about the new role", dueOn: null },
    attentionScore: 0.4,
    daysSinceLast: 8,
    lastInteractionDate: "2026-08-03T00:00:00.000Z",
    closeness: 3,
  }), {
    label: "Active follow-up",
    detail: "Ask about the new role",
    tone: "plan",
  })
})

test("a close person without history gets a clear first-touch state", () => {
  assert.deepEqual(relationshipStatus({
    activePlan: null,
    attentionScore: 999,
    daysSinceLast: null,
    lastInteractionDate: null,
    closeness: 4,
  }), {
    label: "First touch due",
    detail: null,
    tone: "attention",
  })
})

test("person context prefers lived history and falls back to useful contact data", () => {
  assert.equal(personContext({
    latestInteraction: { id: "ix-1", source: "whatsapp", type: "message", timestamp: "2026-08-10T00:00:00.000Z", summary: "Discussed plans for the weekend" },
    title: "Designer",
    headline: null,
    company: "Acme",
    location: "London",
    emails: ["person@example.com"],
    phones: [],
  }), "Discussed plans for the weekend")

  assert.equal(personContext({
    latestInteraction: null,
    title: "Designer",
    headline: null,
    company: "Acme",
    location: "London",
    emails: ["person@example.com"],
    phones: [],
  }), "Designer at Acme")
})

test("interaction source labels are human-readable", () => {
  assert.equal(interactionSourceLabel("whatsapp", "message"), "WhatsApp")
  assert.equal(interactionSourceLabel("gmail", "message"), "Email")
})
