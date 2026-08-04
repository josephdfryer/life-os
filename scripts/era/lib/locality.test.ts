import assert from "node:assert/strict"
import { test } from "node:test"
import { parseLocality, placesQuery, stripFusedCity, namesPlausiblyMatch, SEED_CITIES } from "./locality"

test("pulls CITY ST off a normal descriptor", () => {
  assert.deepEqual(parseLocality("WHOLEFDS SUM LAS VEGAS NV"), { city: "LAS VEGAS", state: "NV" })
  assert.deepEqual(parseLocality("UNITED AIRLINES HOUSTON TX"), { city: "HOUSTON", state: "TX" })
  assert.deepEqual(parseLocality("1-800 CONTACTS, INC.DRAPER UT"), { city: "DRAPER", state: "UT" })
})

test("recovers the city even when fused to the merchant name", () => {
  // The whole reason for suffix matching: there is no seam between "CLU" and
  // "LAS VEGAS", but the text still ends with a city we know.
  assert.deepEqual(parseLocality("SUMMERLIN TENNIS CLULAS VEGAS NV"), { city: "LAS VEGAS", state: "NV" })
  assert.deepEqual(parseLocality("NENE JAPANESE CONTEMLAS VEGAS NV"), { city: "LAS VEGAS", state: "NV" })
  assert.deepEqual(parseLocality("MED CEDARS SINAI MEDLOS ANGELES CA"), { city: "LOS ANGELES", state: "CA" })
})

test("the longest matching city wins", () => {
  // "NORTH LAS VEGAS" must not be truncated to "LAS VEGAS".
  assert.deepEqual(parseLocality("SOME SHOP NORTH LAS VEGAS NV"), { city: "NORTH LAS VEGAS", state: "NV" })
})

test("refuses websites and support endpoints", () => {
  assert.equal(parseLocality("UBER EATS help.uber.com CA"), null)
  assert.equal(parseLocality("Uber Trip help.uber.com CA"), null)
  assert.equal(parseLocality("Amazon.com*X487241T3 WA"), null)
})

test("refuses an unknown city rather than guessing", () => {
  // Bias is deliberate: a wrong city resolves to a real storefront in the
  // wrong town, and the error is invisible once stored.
  assert.equal(parseLocality("SOME SHOP NOWHEREVILLE NV"), null)
})

test("refuses a trailing token that is not a real state code", () => {
  assert.equal(parseLocality("SOME MERCHANT LAS VEGAS ZZ"), null)
  assert.equal(parseLocality("MERCHANT NAME QQ"), null)
})

test("drops a trailing reference number before the locality", () => {
  assert.deepEqual(parseLocality("CURRY - YA 436845560 LAS VEGAS NV"), { city: "LAS VEGAS", state: "NV" })
})

test("accepts a caller-supplied city list", () => {
  assert.equal(parseLocality("SHOP TSUKUBA JP"), null, "JP is not a US state")
  assert.deepEqual(
    parseLocality("SOME SHOP KETCHUM ID", ["KETCHUM"]),
    { city: "KETCHUM", state: "ID" },
  )
})

test("returns null rather than guessing on empty or malformed input", () => {
  assert.equal(parseLocality(null), null)
  assert.equal(parseLocality(undefined), null)
  assert.equal(parseLocality(""), null)
  assert.equal(parseLocality("NV"), null)
})

test("the seed list has no duplicates", () => {
  assert.equal(new Set(SEED_CITIES).size, SEED_CITIES.length)
})

test("builds a Places query from merchant plus locality", () => {
  assert.equal(
    placesQuery("Sprouts Farmers Market", { city: "LAS VEGAS", state: "NV" }),
    "Sprouts Farmers Market LAS VEGAS NV",
  )
})

test("strips city fragments fused onto the merchant name", () => {
  const vegas = { city: "LAS VEGAS", state: "NV" } as const
  assert.equal(stripFusedCity("Sunrightlas", vegas), "Sunright")
  assert.equal(stripFusedCity("Yaw Farm Cofflas", vegas), "Yaw Farm Coff")
  assert.equal(stripFusedCity("Nene Japanese Contemlas", vegas), "Nene Japanese Contem")
})

test("does not amputate a name that legitimately ends in the city word", () => {
  const vegas = { city: "LAS VEGAS", state: "NV" } as const
  // A trailing whole word is not fusion residue.
  assert.equal(stripFusedCity("Vegas Golden Knights", vegas), "Vegas Golden Knights")
  assert.equal(stripFusedCity("Petco", vegas), "Petco")
  assert.equal(stripFusedCity("McDonald's", vegas), "McDonald's")
})

test("name verification accepts genuine matches", () => {
  assert.equal(namesPlausiblyMatch("Barnes & Noble", "Barnes & Noble"), true)
  assert.equal(namesPlausiblyMatch("Sunright", "Sunright Tea Studio - Summerlin"), true)
  assert.equal(namesPlausiblyMatch("Med Cedars Sinai Medlos", "Cedars-Sinai Medical Center"), true)
  assert.equal(namesPlausiblyMatch("Einstein Bros. Bagels", "Einstein Bros. Bagels"), true)
})

test("short real brands are not rejected for being short", () => {
  // A 4-character minimum silently threw away CVS, REI, H&M and BP.
  assert.equal(namesPlausiblyMatch("CVS", "CVS"), true)
  assert.equal(namesPlausiblyMatch("REI", "REI Co-op"), true)
})

test("the city must not be able to carry a match on its own", () => {
  // Comparing the full query would match this on "vegas" alone.
  assert.equal(namesPlausiblyMatch("Random Garbage", "Las Vegas Golden Steakhouse"), false)
})

test("name verification rejects a confident but wrong resolution", () => {
  // The failure this exists to catch: a garbled descriptor resolving to a real
  // business that has nothing to do with the charge.
  assert.equal(namesPlausiblyMatch("Las Vegas Natural Hilas", "Love Health & Wellness LLC"), false)
  assert.equal(namesPlausiblyMatch("Uep Dough", "Springs Preserve"), false)
})
