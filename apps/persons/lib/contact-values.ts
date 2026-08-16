// Moved to packages/domain/contact-matching.ts (Track C-adjacent — the
// device contacts-sync ingest handler in apps/api needs the exact same
// normalization apps/persons' CSV/vCard import already uses, and apps/api
// cannot import apps/persons' internals). Thin re-export shim so every
// existing caller here keeps working unchanged.
export {
  normalizeEmailForMatch,
  normalizePhoneForMatch,
  dedupeEmails,
  dedupePhones,
  emailKeys,
  phoneKeys,
  sharesAny,
} from "@life-os/domain"
