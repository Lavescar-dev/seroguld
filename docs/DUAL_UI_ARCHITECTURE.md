# Dual UI Architecture

Date: 2026-08-06

## Overview

The dual-UI implementation keeps the canonical application in `frontend/src-v2` and adds a runtime UI-variant layer rather than creating a second router or a second frontend entrypoint.

## Runtime Flow

1. `UiVariantProvider` loads the current variant from device-local storage, unless a display route provides an explicit `?ui=` override.
2. `UiVariantBoundary` wraps the app, applies `data-ui-variant` / fingerprint attributes, and catches modern-only render failures.
3. `AppShell` selects either the classic root shell or the modern shell.
4. Route wrappers choose between classic and modern page/module renderers where safe parity exists.
5. Route-level blockers register dirty / settling state with the shared transition registry so a mode switch can wait or block safely.

## Main Components

- `frontend/src-v2/ui-variants/**`
  - persistence, confirmation, discovery banner, fallback boundary, toast bridge, guard registry
- `frontend/src-v2/components/AppShell.tsx`
  - shell switch between classic and modern
- `frontend/src-v2/modern/shell/**`
  - modern navigation, header, workspace shell
- `frontend/src-v2/modern/modules/**`
  - route modules backed by existing make-state hooks
- `frontend/src-v2/modern/adapters/**`
  - translation from existing page hook outputs into modern view models

## Desktop / Display Interaction

- Main purchase and display-control routes append `?ui=classic|modern` when opening or idling the customer display window.
- Tauri normalizes display routes and can write modern-render diagnostics as JSONL for local support inspection.
- Display entry bootstrap reads the route query first so the second screen can match the operator-selected variant without depending on shared local storage behavior between windows.

## Backend Contract Changes

- Public display outputs now preserve masked identity fields only.
- Document artifact DTOs expose checksum and revision-friendly metadata for the modern Office surface.
- No speculative backend merge engine was introduced; unresolved Office reconciliation remains a documented gap.

## Deliberate Safety Boundaries

- No new router tree was introduced.
- No classic renderer was replaced on routes where the modern surface would remove real operator actions.
- No raw CPR or identity document fallback remains in public display rendering.
- No destructive migration or opportunistic backend refactor was performed to satisfy modern visuals.
