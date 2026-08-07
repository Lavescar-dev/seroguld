# Modern UI Backend Gap Report

Date: 2026-08-06

## Closed In This Pass

- Public display REST / realtime output no longer exposes raw CPR or raw identity document numbers.
- Artifact DTOs now expose checksum / revision-friendly metadata fields needed by the modern Office surface.
- Desktop diagnostics can persist modern-render failure records locally for support follow-up.

## Remaining Backend Gaps

### P1: Field-level Office reconciliation is still contract-only

Evidence:

- DTOs now include `checksum_sha256`, `workbook_revision`, `base_revision`, `crm_revision`, `conflict_state`, and `field_id`.
- Current service population still returns `None` for unavailable revision/conflict fields instead of authoritative revision lineage.

Impact:

- Modern Office surfaces can show metadata, but cannot safely claim true field-level conflict resolution yet.

Needed next:

- authoritative workbook revision ids
- CRM base/current revision lineage
- per-field conflict payloads with apply semantics
- reconciliation mutation tests

### P1: Full backend test suite depends on missing reference workbooks

Evidence:

- Full `pytest -q` completed with `85 passed, 12 failed`.
- Failing areas were AFG / Depolama / Log reference-workbook tests, a stale migration-head assertion, and a stale OnlyOffice callback test.

Impact:

- Full regression confidence is limited until the expected workbook references are mounted from the canonical handoff runtime or the tests are updated.

Needed next:

- point tests at the canonical reference workbook root
- refresh stale migration-head expectation
- refresh stale OnlyOffice callback import path

### P2: Public display still trusts token routes for delivery, not scoped capabilities

Evidence:

- Sensitive fields are now removed, but display access still hinges on the existing token-based public route model.

Impact:

- Privacy exposure is reduced, but there is still no stronger capability model or short-lived route-scoped proof beyond the existing token scheme.

Needed next:

- evaluate TTL / rotation policy
- add negative tests for revoked / expired display tokens if not already covered elsewhere

### P2: Diagnostic sink is local-only

Evidence:

- Tauri writes JSONL under app log dir.

Impact:

- Support can inspect local failures, but the CRM has no upload or bundle wiring yet.

Needed next:

- support-bundle command
- retention / rotation policy
- optional export from desktop UI

## Not Implemented On Purpose

- No fake backend semantics were added for modern `WooCommerce`, `GDPR`, or `Uniconta` parity.
- No speculative field-level merge engine was invented just to satisfy modern UI visuals.
