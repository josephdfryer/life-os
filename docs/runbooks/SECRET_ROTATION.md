# Secret rotation runbook

1. Identify the provider, affected environments, and dependent apps without printing the current value.
2. Create a replacement in the provider and add it to the intended local OS environment or Vercel environment. Never place it in git, chat, logs, screenshots, fixtures, or memory.
3. Redeploy/restart consumers and verify a read-only health operation.
4. Revoke the old credential only after the replacement is confirmed.
5. Review logs for failed authentication and record the rotation date, owner, and affected variable names—not values.

For suspected exposure, revoke first, then replace. Rotate paired values together when a provider requires both client ID/secret or signing-key versions.
