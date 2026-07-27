import assert from "node:assert/strict"
import test from "node:test"
import { groupUnresolvedObservations } from "../components/map/unresolved-groups"

test("nearby repeated unresolved observations group by suggested identity", () => {
  const groups = groupUnresolvedObservations([
    { id: "a", latitude: 37.77, longitude: -122.42, startedAt: "2026-01-01T12:00:00Z", aiEnrichment: { placeName: "Market Cafe" } },
    { id: "b", latitude: 37.7702, longitude: -122.4202, startedAt: "2026-02-01T12:00:00Z", aiEnrichment: { placeName: "Market Cafe" } },
    { id: "c", latitude: 37.7702, longitude: -122.4202, startedAt: "2026-03-01T12:00:00Z", aiEnrichment: { placeName: "Different Place" } },
  ])

  assert.equal(groups.length, 2)
  assert.equal(groups[0].observations.length, 2)
  assert.equal(groups[0].representative.id, "b")
  assert.equal(groups[0].label, "Market Cafe")
  assert.equal(groups[1].observations.length, 1)
})
