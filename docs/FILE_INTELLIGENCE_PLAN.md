# LifeOS File Intelligence and Multi-Person Evidence Plan

**Status:** Approved for implementation · August 13, 2026

## Goal

Build a Joseph-first, workspace-safe file intelligence system in which private source files enrich the shared LifeOS graph without becoming new primitives or corrupting canonical truth. Originals live in private, versioned object storage. Faithful extraction becomes a source-linked `Note` plus exact chunks. AI may propose cited mentions and atomic claims, but every conclusion remains traceable to the original passage.

One file may provide evidence about many existing People. A mention is not automatically an `Interaction`; incidental or ambiguous mentions remain searchable and never influence Theory.

## Storage and upload contract

- Keep Stuff media unchanged. Add a shared file-storage adapter used by Assistant, with local and S3 implementations.
- Authenticate AWS from Vercel with OIDC and `AWS_ROLE_ARN`; do not add static AWS credentials.
- Create one-use `FileUploadIntent` records and ten-minute presigned `PUT` URLs that bind MIME type and SHA-256 checksum.
- Use immutable keys: `workspaces/{workspaceId}/files/{uploadIntentId}/{safeFilename}`.
- After upload, verify the object with `HeadObject` before creating the `ImportedFile` row.
- Accept non-executable files up to 100 MB. Preserve unsupported files as `store_only`.
- Archive instead of deleting. Archived files leave retrieval and future synthesis but remain recoverable from versioned S3.

## Supporting records

These models are operational support, not LifeOS primitives:

- `FileUploadIntent`: one-use authorization and verified upload metadata.
- `FileProcessingRun`: durable status, version, summary/error, and Workflow run ID.
- `FileChunk`: immutable extracted text plus page, section, cell, image-region, or audio-time locator.
- `FileEntityMention`: every Person, Place, Item, or Group mention, its role, citation, confidence, resolution state, and resolved entity.
- `EvidenceClaim`: an atomic explicit or inferred assertion with dates/value, confidence, exact supporting span, lifecycle status, and graph result.
- `EvidenceClaimSubject`: many-to-many claim subjects, preserving each subject's role and relevance.
- `AiAnalysisRun.processingRunId` and `purpose` for auditable model work.
- `AssistantMessage.metadata` for file attachments and returned citations.

Person roles are `subject`, `author`, `sender`, `recipient`, `signer`, `participant`, `issuer`, `owner`, and `mentioned`. A joint assertion remains one claim with multiple subjects.

## Durable processing

After upload finalization, start a Vercel Workflow DevKit workflow. Each step is independently retryable and idempotent:

1. Verify object, checksum, size, and MIME type.
2. Extract faithful source content and locators.
3. Create or reuse the immutable source-linked `Note`.
4. Create versioned chunks and update workspace-filtered SQLite/Turso FTS5.
5. Extract entity mentions, roles, claims, and proposed graph actions.
6. Reject any quotation that cannot be found in stored source text.
7. Resolve entity mentions conservatively.
8. Calculate claim-to-person Theory relevance.
9. Apply safe automation or dual-write `ReviewItem` proposals.
10. Make affected Theory snapshots derivably stale.
11. Finish as `ready`, `partial`, `store_only`, or `failed`.

Supported extraction covers PDF (including OCR), DOCX/text, CSV/XLSX with cell citations, and JPEG/PNG/WebP/HEIC with OCR/description. Unknown, encrypted, oversized, archived, executable, and video files produce no unsupported claims.

**Audio is preserved but not transcribed.** Extraction runs on `ANTHROPIC_API_KEY`
rather than the AI Gateway, and Anthropic has no speech-to-text endpoint, so
MP3/M4A/WAV uploads complete as `partial` carrying an explicit warning: the
original is stored and the row exists, but there are no chunks and therefore no
claims. Restoring timestamped transcription requires deliberately choosing a
speech-to-text provider; it should not return as an implicit dependency.

## Identity resolution

Resolve progressively:

1. Exact email or phone.
2. Existing external identifier.
3. Unique full name plus employer, group, address, or known-participant corroboration.
4. Unique full name alone (suggestion only).
5. Ambiguous or incomplete name (unresolved).

Only levels 1-3 auto-resolve. Ambiguous mentions remain searchable, never affect Theory, and create a review proposal to connect or create a Person. Resolution correction supersedes the old link and makes both old and new People's theories stale.

## Theory evidence rules

- Canonical accepted evidence weight: `1.0`.
- Validated explicit file claim: `0.75`.
- Contextual participation: `0.50`.
- Inferred claim: `0.35`, allowed only under Inferred or Hypotheses.
- Incidental mention: `0.0`, excluded.
- Unresolved, dismissed, superseded, reversed, or archived evidence is excluded.

The Theory source loader must join `FileEntityMention` and `EvidenceClaimSubject`; it must not use metadata substring matching. Add `evidence_claim` as a source type. Snapshot sources retain claim ID, contribution, weight, classification/review state, and exact file/chunk provenance.

Theory staleness is derived: relevant evidence changed after the current snapshot's `synthesizedAt`. New evidence appears immediately on Person and Theory surfaces, while the existing manual Regenerate action remains available.

A nightly workflow at `10:00 UTC` keyset-paginates every stale Person, regenerates cost-bounded batches, preserves prior snapshots, and leaves budget-deferred People stale and reachable on the next run. Editing extraction creates a correction `Note` and superseding claim; machine evidence is never overwritten.

## Graph promotion

Safe automatic writes are limited to explicit, non-sensitive past Events with unambiguous dates and duplicate protection, and explicit non-sensitive States on existing entities. They use registered domain commands, provenance, idempotency keys, atomic `GraphEvent`s, and Undo.

Always review new entities, Plans/commitments, Interactions/relationship meaning, sensitive domains, ambiguous identities/dates, contradictions, and inferred claims. Assistant, Persons, Theory, and Home read the same underlying resolution status; actionable proposals are dual-written to Home's existing review inbox.

## Product surfaces and APIs

Assistant gains Chat/Files navigation, upload progress/retry/Store Only, a library and detail view, file-scoped or library-wide cited chat, connected People, claims/proposals, and a post-processing summary for every affected Person.

Tools: `search_file_chunks`, `get_file_context`, `list_file_claims`, `list_file_people`, `get_person_file_evidence`. Answers may cite only chunk IDs returned by these tools; invalid citations are removed.

Persons gains a File evidence panel with roles, claims, citations, resolution confidence/status, identity correction, and Theory inclusion. Theory gains current/stale state, new-evidence count/list, weights/classifications, and an exact evidence trail.

Authenticated routes cover upload intent/finalization, file list/detail/download/reprocess/archive/restore, Person evidence, mention resolution/correction, claim review/correction, and Theory stale/new-evidence state. Chat accepts at most ten workspace-owned file IDs and returns `{ reply, citations }`.

## Rollout and safety

Feature flags independently gate ingestion, review proposals, safe-auto promotion, and nightly Theory refresh. Initial rollout enables ingestion with safe-auto off, verifies synthetic multi-person PDF/sheet/image/audio fixtures, then enables proposals, safe-auto, and nightly refresh in that order.

Existing files receive a read-only backfill preview only. No backfill runs without separate confirmation. No migration may truncate or reset core LifeOS tables.

## Verification bar

Tests must cover multi-person/multi-role files, shared claims, repeated mentions, same-name ambiguity, unresolved/incidental exclusion from Theory, explicit versus inferred Theory placement, identity correction, archive behavior, dismissal/correction, derived staleness, keyset nightly batching and budget exhaustion, exact citation validation, workspace isolation, prompt-injection containment, and safe-auto idempotency/Undo.

Database tests explicitly set `TURSO_DATABASE_URL=""` and `TURSO_AUTH_TOKEN=""` and use a scratch `DATABASE_URL`.

The initiative is complete when one private multi-person upload can be faithfully extracted, connect distinct cited evidence to every correctly resolved Person, keep ambiguous/incidental references out of Theory, surface evidence immediately, regenerate versioned theories overnight, promote only safe or reviewed graph writes, and trace every Theory statement through claim, chunk, Note, and original file.
