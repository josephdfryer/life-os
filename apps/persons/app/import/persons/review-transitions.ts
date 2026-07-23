import type { ContactAction, ReviewContact } from "./matching"

export function setSelectedAt(contacts: ReviewContact[], indices: Iterable<number>, selected: boolean) {
  const targets = new Set(indices)
  return contacts.map((contact, index) => targets.has(index) ? { ...contact, selected } : contact)
}
export function clearSelection(contacts: ReviewContact[]) { return contacts.map(contact => contact.selected ? { ...contact, selected: false } : contact) }
export function skipAt(contacts: ReviewContact[], indices: Iterable<number>) {
  const targets = new Set(indices)
  return contacts.map((contact, index) => targets.has(index) ? { ...contact, skip: true, selected: false } : contact)
}
export function setActionAt(contacts: ReviewContact[], indices: Iterable<number>, action: ContactAction) {
  const targets = new Set(indices)
  return contacts.map((contact, index) => targets.has(index) ? { ...contact, action, selected: false } : contact)
}
export function keepOnly(contacts: ReviewContact[], indices: Iterable<number>) {
  const keep = new Set(indices)
  return contacts.map((contact, index) => contact.skip ? contact : keep.has(index) ? { ...contact, selected: false } : { ...contact, skip: true })
}
export function skipWhere(contacts: ReviewContact[], predicate: (contact: ReviewContact) => boolean) {
  return contacts.map(contact => !contact.skip && predicate(contact) ? { ...contact, skip: true } : contact)
}
