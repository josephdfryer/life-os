// Pulling a locality out of raw card-processor text.
//
// Card networks pad the descriptor to a fixed width and append "CITY ST", often
// with no separator: "SUMMERLIN TENNIS CLULAS VEGAS NV" is
// "Summerlin Tennis Clu" + "LAS VEGAS" + "NV" run together. There is no
// detectable seam between merchant and city, so any rule that counts trailing
// words is guessing — it reads "TENNIS CLULAS VEGAS" as the city.
//
// The way out is to stop guessing where the city starts and instead ask which
// KNOWN city the text ends with. Suffix matching handles the fused case
// correctly ("...CLULAS VEGAS" ends with "LAS VEGAS") and refuses anything it
// does not recognise, which is the right bias: a wrong city sends the Places
// lookup to a real storefront in the wrong town, and that error is invisible
// once stored.

const STATE_CODES = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC","PR","VI","GU","AS","MP",
])

/** A "city" of help.uber.com is a website; these must never reach the API. */
const NON_PHYSICAL = [
  /\.(com|net|org|io|co)\b/i,
  /\b(help|support|www|http)\b/i,
  /\bamzn\b/i,
]

export type Locality = { city: string; state: string }

/**
 * Cities to match against. Callers pass the set derived from Places already in
 * the graph plus this seed list, so coverage grows as the location graph does.
 */
export const SEED_CITIES = [
  "LAS VEGAS", "HENDERSON", "SUMMERLIN", "NORTH LAS VEGAS", "RENO",
  "LOS ANGELES", "SAN FRANCISCO", "SAN DIEGO", "SAN JOSE", "OAKLAND", "BERKELEY",
  "SANTA MONICA", "MARINA DEL REY", "BEVERLY HILLS", "PASADENA", "BURBANK", "CULVER CITY",
  "WEST HOLLYWOOD", "LONG BEACH", "SAN BRUNO", "FREMONT", "PALO ALTO", "MOUNTAIN VIEW",
  "SACRAMENTO", "IRVINE", "ANAHEIM", "TORRANCE", "GLENDALE",
  "NEW YORK", "BROOKLYN", "QUEENS", "MANHATTAN",
  "HOUSTON", "DALLAS", "AUSTIN", "SAN ANTONIO", "EL PASO", "FORT WORTH",
  "DENVER", "BOULDER", "LAKEWOOD", "COLORADO SPRINGS", "AURORA",
  "SALT LAKE CITY", "DRAPER", "ALPINE", "PROVO", "PARK CITY", "OGDEN",
  "SEATTLE", "BELLEVUE", "PORTLAND", "BOISE",
  "CHICAGO", "MIAMI", "ORLANDO", "TAMPA", "SARASOTA", "WINTER PARK", "JACKSONVILLE",
  "ATLANTA", "BOSTON", "PHILADELPHIA", "WASHINGTON", "PHOENIX", "SCOTTSDALE", "TUCSON",
  "NASHVILLE", "CHARLOTTE", "MINNEAPOLIS", "DETROIT", "HAMMONTON",
]

/**
 * Extract a locality from a raw processor descriptor.
 *
 * @param knownCities upper-cased city names; the longest suffix match wins, so
 *                    "NORTH LAS VEGAS" beats "LAS VEGAS" on the same text.
 */
export function parseLocality(
  rawDescription: string | null | undefined,
  knownCities: Iterable<string> = SEED_CITIES,
): Locality | null {
  if (!rawDescription) return null
  const text = rawDescription.trim().replace(/\s+/g, " ")
  if (NON_PHYSICAL.some(pattern => pattern.test(text))) return null

  const match = /^(.*?)\s*([A-Za-z]{2})$/.exec(text)
  if (!match) return null
  const state = match[2].toUpperCase()
  if (!STATE_CODES.has(state)) return null

  // Drop a trailing reference number sitting between merchant and locality.
  const head = match[1].trim().replace(/\s+[#*]?\d{4,}$/, "").trim().toUpperCase()
  if (!head) return null

  let best: string | null = null
  for (const city of knownCities) {
    const candidate = city.toUpperCase()
    if (!head.endsWith(candidate)) continue
    if (!best || candidate.length > best.length) best = candidate
  }
  if (!best) return null

  return { city: best, state }
}

/**
 * The same fusion that corrupts the city also corrupts the merchant name: Era's
 * cleaned description for "SUNRIGHT TEA STUDIOLAS VEGAS NV" comes through as
 * "Sunrightlas". Strip a trailing fragment that is a prefix of the city, so the
 * Places query asks about "Sunright" rather than "Sunrightlas".
 */
export function stripFusedCity(merchantName: string, locality: Locality): string {
  const city = locality.city.replace(/\s+/g, "")
  const name = merchantName.trim()
  // Try the longest fragment first so "…lasvegas" loses all of it, not just "las".
  for (let length = Math.min(city.length, name.length - 2); length >= 3; length -= 1) {
    const fragment = city.slice(0, length)
    const tail = name.slice(-length)
    if (tail.toLowerCase() !== fragment.toLowerCase()) continue
    const stripped = name.slice(0, -length).trim()
    // Only accept if a real name remains and we did not cut a whole word that
    // legitimately matches — "Vegas Golden Knights" must keep "Vegas".
    if (stripped.length >= 3 && !/\s$/.test(name.slice(0, -length + 1))) return stripped
  }
  return name
}

/** Merchant name carries identity; the locality disambiguates the branch. */
export function placesQuery(merchantName: string, locality: Locality): string {
  return `${stripFusedCity(merchantName, locality)} ${locality.city} ${locality.state}`
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Does Google's answer plausibly correspond to what we asked about?
 *
 * Garbled descriptors resolve confidently to the wrong business — "Las Vegas
 * Natural Hilas" came back as "Love Health & Wellness LLC". Requiring a shared
 * meaningful token (or a prefix relationship) catches that, and the ones it
 * cannot verify are recorded as suggestions rather than silently trusted.
 */
export function namesPlausiblyMatch(queried: string, resolved: string): boolean {
  // Compare the MERCHANT name only — never the full query. The query carries
  // the city, so "Random Garbage LAS VEGAS NV" would otherwise "match" any
  // business with Las Vegas in its name, on the city alone.
  const tokens = (value: string) => value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    // 3, not 4: real brands are this short — CVS, H&M, REI, BP.
    .filter(token => token.length >= 3)

  const a = tokens(queried)
  const b = tokens(resolved)
  if (a.length === 0 || b.length === 0) return false

  // A shared substantial token is the strongest cheap signal.
  if (a.some(token => b.includes(token))) return true
  // Truncated descriptors: "Sunright" vs "Sunright Tea Studio".
  return a.some(x => b.some(y => x.startsWith(y) || y.startsWith(x)))
}
