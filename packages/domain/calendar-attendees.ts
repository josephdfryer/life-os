// Calendar RSVP is the explicit "I was not involved" signal. The manifesto
// assumes presence unless stated otherwise; a declined invitation is that
// statement. Expected-attendee references and participant Interactions must
// not treat a declined invitee as if they attended.

export type CalendarAttendee = {
  email?: string | null
  displayName?: string | null
  responseStatus?: string | null
  self?: boolean
}

export function attendeeDeclined(responseStatus?: string | null): boolean {
  return responseStatus?.trim().toLowerCase() === "declined"
}

export function normalizeAttendeeEmail(value?: string | null): string | null {
  const email = value?.trim().toLowerCase()
  return email && email.includes("@") ? email : null
}

export function declinedAttendeeEmails(
  attendees: CalendarAttendee[] | null | undefined,
): Set<string> {
  const emails = new Set<string>()
  for (const attendee of attendees ?? []) {
    const email = normalizeAttendeeEmail(attendee.email)
    if (email && attendeeDeclined(attendee.responseStatus)) emails.add(email)
  }
  return emails
}

export function participatingAttendeeEmails(item: {
  attendees?: CalendarAttendee[] | null
  organizer?: { email?: string | null } | null
  creator?: { email?: string | null } | null
}): string[] {
  const declined = declinedAttendeeEmails(item.attendees)
  const seen = new Set<string>()
  const emails: string[] = []
  for (const raw of [
    ...(item.attendees ?? []).map(attendee => attendee.email),
    item.organizer?.email,
    item.creator?.email,
  ]) {
    const email = normalizeAttendeeEmail(raw)
    if (!email || declined.has(email) || seen.has(email)) continue
    seen.add(email)
    emails.push(email)
  }
  return emails
}

export function calendarAttendeesFromSignals(raw: string | null | undefined): CalendarAttendee[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as { attendees?: unknown }
    if (!Array.isArray(parsed?.attendees)) return []
    return parsed.attendees.flatMap(value => {
      if (!value || typeof value !== "object") return []
      const attendee = value as CalendarAttendee
      return [{
        email: typeof attendee.email === "string" ? attendee.email : null,
        displayName: typeof attendee.displayName === "string" ? attendee.displayName : null,
        responseStatus: typeof attendee.responseStatus === "string" ? attendee.responseStatus : null,
        self: Boolean(attendee.self),
      }]
    })
  } catch {
    return []
  }
}

export function personEmailsFromJson(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap(value => {
      const email = typeof value === "string" ? normalizeAttendeeEmail(value) : null
      return email ? [email] : []
    })
  } catch {
    return []
  }
}

export function personDeclinedInvite(emailsJson: string | null | undefined, declinedEmails: Set<string>): boolean {
  if (declinedEmails.size === 0) return false
  return personEmailsFromJson(emailsJson).some(email => declinedEmails.has(email))
}
