import type { ParsedContact } from "./vcard"

export type InstagramRelationship = "follower" | "following"

type InstagramEntry = {
  string_list_data?: { href?: string; value?: string; timestamp?: number }[]
}

/**
 * Instagram's export shape has drifted over time: `following.json` wraps its
 * list under `relationships_following`, while `followers_N.json` is often a
 * bare top-level array. Rather than pin to one exact shape, find the first
 * array anywhere in the parsed JSON — every version puts the entries in one.
 */
function extractEntries(json: unknown): InstagramEntry[] {
  if (Array.isArray(json)) return json as InstagramEntry[]
  if (json && typeof json === "object") {
    for (const value of Object.values(json as Record<string, unknown>)) {
      if (Array.isArray(value)) return value as InstagramEntry[]
    }
  }
  return []
}

/**
 * Parse one of Instagram's "Download Your Information" JSON files —
 * followers_1.json (or _2, _3, ...) or following.json.
 *
 * Instagram's export carries only a username and profile URL, never a real
 * name, email, or phone. That means there is no safe strong-key signal to
 * auto-merge on (see docs/IOS_PLATFORM_PLAN.md §6.2) — every contact here
 * needs a human glance before it's trusted as a match, which the shared
 * review queue already forces since these rows carry no matchable identity
 * beyond a name-shaped guess.
 */
export function parseInstagramContacts(raw: string, relationship: InstagramRelationship): ParsedContact[] {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return []
  }

  const seen = new Set<string>()
  const contacts: ParsedContact[] = []

  for (const entry of extractEntries(json)) {
    const data = entry.string_list_data?.[0]
    const username = data?.value?.trim()
    if (!username || seen.has(username)) continue
    seen.add(username)

    contacts.push({
      first: username,
      last: "",
      fullName: username,
      title: null,
      headline: null,
      company: null,
      email: null,
      phone: null,
      emails: [],
      phones: [],
      birthday: null,
      notes: `Imported from Instagram ${relationship === "follower" ? "followers" : "following"} export — Instagram doesn't include a real name, so "${username}" is the handle. Confirm the name before saving.`,
      location: null,
      linkedin: null,
      twitter: null,
      website: null,
      facebook: null,
      instagram: username,
      sourceId: `instagram:${username}`,
    })
  }

  return contacts
}
