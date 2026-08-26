# Architecture decision records

ADRs preserve decisions that affect primitives, package direction, persistence, security, deployment, or operational guarantees.

1. Copy `0000-template.md` to the next numbered file.
2. Keep the decision concise; link evidence and alternatives.
3. Use `proposed`, `accepted`, `superseded`, or `deprecated` status.
4. A service extraction ADR must satisfy `docs/SERVICE_EXTRACTION_CRITERIA.md`.

## Index

| ADR | Status | Decision |
|---|---|---|
| [0001](0001-modular-monolith.md) | accepted | Keep LifeOS a boundary-enforced modular monolith |
| [0002](0002-graph-event-spine.md) | accepted | Add a GraphEvent ledger as the automation and intelligence spine |
| [0003](0003-connection-model.md) | accepted | A unified Connection model for third-party account integrations |
| [0004](0004-customer-life-vault.md) | proposed | A customer-owned local Life Vault as the commercial storage boundary |
