# Modern UI Implementation Report

Date: 2026-08-06
Repo: `seroguld-crm`
Status: Partial but validated

## Finding

The dual-UI foundation is implemented and running in the canonical `frontend/src-v2` app. Core purchase routes now support a device-local `classic` / `modern` variant switch with persistence, confirmation, guard hooks, classic fallback on modern render failure, and Tauri-aware second-display propagation. Public display payloads no longer serialize raw CPR or raw identity document numbers.

## Evidence

- UI variant bootstrap and display-route override are wired in [frontend/src-v2/main.tsx](/mnt/SSD/Clients/Recai_Demir/seroguld-crm/frontend/src-v2/main.tsx:20).
- The runtime boundary and modern-failure diagnostic hook are wired in [frontend/src-v2/app.tsx](/mnt/SSD/Clients/Recai_Demir/seroguld-crm/frontend/src-v2/app.tsx:266).
- Shell-level variant selection is active in [frontend/src-v2/components/AppShell.tsx](/mnt/SSD/Clients/Recai_Demir/seroguld-crm/frontend/src-v2/components/AppShell.tsx:7).
- Settings exposes the variant switch in both classic and modern settings flows in [frontend/src-v2/pages/SettingsPage.tsx](/mnt/SSD/Clients/Recai_Demir/seroguld-crm/frontend/src-v2/pages/SettingsPage.tsx:6).
- Purchase route modern wiring and display `?ui=` propagation are active in [frontend/src-v2/pages/PosPage.tsx](/mnt/SSD/Clients/Recai_Demir/seroguld-crm/frontend/src-v2/pages/PosPage.tsx:17).
- Public display raw identity suppression is enforced in [backend/app/services/pos_display_service.py](/mnt/SSD/Clients/Recai_Demir/seroguld-crm/backend/app/services/pos_display_service.py:22).
- Artifact metadata expansion is implemented in [backend/app/schemas/document_artifact.py](/mnt/SSD/Clients/Recai_Demir/seroguld-crm/backend/app/schemas/document_artifact.py:12).
- Desktop UI diagnostics are validated and written locally in [desktop/src-tauri/src/main.rs](/mnt/SSD/Clients/Recai_Demir/seroguld-crm/desktop/src-tauri/src/main.rs:59).

## Fix

- Added `frontend/src-v2/ui-variants/**` for:
  - versioned local persistence
  - root fingerprinting
  - transition registry / blockers
  - switch confirmation
  - discovery banner
  - modern-only error boundary with forced classic fallback
- Added `frontend/src-v2/modern/**` for:
  - modern shell
  - design-system primitives
  - modern modules for Alış, Customers, Depolama, Log, Office
  - modern pages for login, dashboard, settings, reports, OPMC, display control
- Wired modern route selection for:
  - `/`
  - `/dashboard`
  - `/depolama`
  - `/log`
  - `/musteriler`
  - `/login`
  - `/musteri-ekran`
  - `/opmc`
  - `/opmc/:id`
  - `/settings`
  - `/reports`
- Preserved classic rendering for `WooCommerce`, `GDPR`, `public GDPR`, and `Uniconta` routes where the available modern page surface was not yet action-complete enough to replace the operator workflow safely.
- Sanitized frontend display merges so masked identity fields remain the only customer identity data rendered on the public screen.
- Expanded document artifact DTOs with checksum and revision-friendly metadata.
- Added a Tauri JSONL diagnostic sink for modern render failures.
- Updated local and CI validation expectations so frontend Vitest runs as part of the gate.

## Verification

- `cd frontend && npm run typecheck` ✅
- `cd frontend && npm test` ✅
- `cd frontend && npx vitest run src-v2/pages/__tests__/DisplayVariant.test.tsx src-v2/pages/__tests__/PosPage.test.tsx` ✅
- `cd frontend && npm run build` ✅
- `cd desktop/src-tauri && cargo check` ✅
- `cd backend && .venv/bin/python -m pytest backend/tests/test_pos_display_snapshot_lines.py -q` ✅
- `cd backend && .venv/bin/python -m pytest -q` ⚠️ 85 passed, 12 failed

## Reviewer Follow-up

A reviewer pass found two medium issues during this turn:

- display routes carried the variant contract implicitly rather than observably
- Alış modern blocker wiring did not receive granular autosave / dirty signals

Both were fixed before final validation:

- display pages now mark the active display variant explicitly
- `PosPage` now passes granular Alış autosave / dirty signals into the modern view-model blocker path
- focused regression tests were added for both cases
- Reviewer pass: two medium findings fixed (explicit display variant marker; Alış autosave settling/flush guard).

## Known Baseline Failures

The 12 full-suite backend failures were not introduced by this implementation. They are baseline/environment mismatches:

- missing reference workbook files under `referans/` for AFG / Depolama / Log roundtrip tests
- stale migration-head expectation (`0015...` expected, actual head `0019_log_module_audit`)
- stale OnlyOffice callback symbol expectation in `test_office_host_service`

## Residual Risk

- `WooCommerce`, `GDPR`, and `Uniconta` still need a second pass to reach safe modern parity instead of classic-in-modern-shell fallback.
- Field-level workbook conflict resolution is only scaffolded at DTO/UI-contract level; the backend does not yet provide authoritative per-field revision apply semantics.
- Windows dual-monitor behavior, OnlyOffice live runtime, and end-to-end Tauri fallback behavior were not validated on a real target machine in this turn.
- A reviewer pass eventually returned two medium findings; both were remediated and covered by focused frontend tests.
