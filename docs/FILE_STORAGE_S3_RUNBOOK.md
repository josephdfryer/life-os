# File Intelligence S3 Runbook

This runbook provisions the private original-file store used by Assistant. It does not replace Stuff media storage.

## Required AWS controls

1. Create a dedicated S3 bucket in the deployment region.
2. Enable Block Public Access, object versioning, and default encryption. Do not add a public bucket policy.
3. Add a lifecycle policy for noncurrent versions only after choosing a recovery period. Archive in Life OS is logical: the application does not delete the S3 object.
4. Create a narrow IAM role for the Assistant Vercel project. Its trust policy must accept Vercel OIDC only for the intended team, project, and production environment. Follow the current [Vercel OIDC AWS guide](https://vercel.com/docs/oidc/aws) when constructing claim conditions.
5. Grant the role only `s3:PutObject` and `s3:GetObject` for `arn:aws:s3:::BUCKET/workspaces/*`. Add checksum and encryption conditions where AWS policy support permits them.

   Do **not** try to grant `s3:HeadObject` — it is not a distinct IAM action. The `HeadObject`
   call this pipeline makes to verify a completed upload is authorized by `s3:GetObject`.
   Adding `s3:ListBucket` is optional but worth it: without it, a `HeadObject` against a missing
   key returns `403 Forbidden` instead of `404 Not Found`, which makes a failed upload look like
   a permissions problem.
6. Configure the bucket CORS policy to allow `PUT` from the exact Assistant production origin with `content-type`, `x-amz-checksum-sha256`, `x-amz-meta-life-os-sha256`, and `x-amz-server-side-encryption` request headers.

## Vercel environment

Set these values on the Assistant project with `vercel env`; no static AWS access key is used:

```text
FILE_STORAGE_PROVIDER=s3
AWS_REGION=...
AWS_ROLE_ARN=arn:aws:iam::ACCOUNT:role/...
S3_BUCKET_NAME=...
FILE_INTELLIGENCE_INGESTION=true
FILE_INTELLIGENCE_REVIEW_PROPOSALS=false
FILE_INTELLIGENCE_SAFE_AUTO=false
```

Set `FILE_INTELLIGENCE_NIGHTLY_THEORY=false` on Theory until cited evidence has been reviewed in production.

File extraction uses `ANTHROPIC_API_KEY` directly — no AI Gateway credentials are
needed for OCR, image description, or claim extraction. Theory synthesis is a
separate pipeline (`packages/intelligence`) that still reads an encrypted provider
credential from the database, unchanged by this.

## Verification order

1. Upload a small text file and confirm the completed `HeadObject` matches size, MIME type, and SHA-256.
2. Download through the authenticated file route; ensure the bucket object itself is not public.
3. Upload one synthetic multi-person PDF, spreadsheet, image, and audio fixture.
4. Confirm exact chunk locators, identity resolution, claims, and Home proposals before enabling review proposals.
5. Enable `FILE_INTELLIGENCE_REVIEW_PROPOSALS`, then safe-auto only after idempotency and Undo are verified.
6. Enable nightly Theory last. The job runs at 10:00 UTC and leaves unprocessed People stale when its per-run budget is exhausted.

Run `npm run files:backfill-preview` for a read-only count of older `ImportedFile` rows. Never run a write backfill without separate confirmation.

## Known dependency advisories (accepted)

`npm audit` reports 16 advisories (14 high, 2 moderate). Every one of them resolves to two
transitive packages inside the Workflow DevKit tree, and nothing else in the monorepo pulls
the affected versions:

| Package | Installed | Advisory range | Reached via |
| --- | --- | --- | --- |
| `nanoid` | 5.1.6 | `>=4.0.0 <5.1.16` | `workflow > @workflow/core` |
| `undici` | 7.28.0 | `>=7.0.0 <7.29.0` | `workflow > @workflow/cli > @workflow/world-{local,vercel}` |

The root `nanoid@3.3.18` (via `next > postcss`) is outside the advisory range, and
`@ai-sdk/gateway` already resolves `undici@7.29.0`.

These are accepted rather than fixed, for three reasons:

1. `workflow@4.8.2` is the latest stable release; there is no patched version to move to.
   The only newer line is `5.0.0-beta.*`, which is not appropriate for production.
2. `npm audit fix --force` resolves this by downgrading `workflow` to `2.0.6` — a major
   downgrade that removes the API this project's workflows are written against.
3. `overrides` entries do not take effect against the existing lockfile; forcing them
   requires regenerating `package-lock.json` in full, which re-resolves all ~664 packages.
   That belongs in its own dedicated change, not bundled with a feature.

Reachability is limited: the `nanoid` issue needs an attacker-controlled negative size, and
the `undici` issues concern requests to attacker-influenced hosts, whereas the `world-*`
adapters call Vercel's own API. Re-check `npm audit` when `workflow` publishes past 4.8.2 and
drop this section once the tree is clean.
