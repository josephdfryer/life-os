// Moved to @life-os/domain (packages/domain/staged-interactions.ts) so the
// canonical write command (acceptStagedInteraction) and this app share one
// implementation. Note: findInteractionByExactSource's signature changed —
// it now takes an explicit Prisma.TransactionClient as its first argument
// (it must run inside the same transaction as the write it's guarding), so
// any new caller here needs to pass one rather than relying on a static db
// import. No current caller in this app uses that function directly.
export { normalizeSourceMarker, sourceMarkers, appendUniqueLine, findInteractionByExactSource } from "@life-os/domain"
