# Dual UI Architecture

Canonical detail: `docs/DUAL_UI_ARCHITECTURE.md`.

`UiVariantProvider` selects `classic | modern` from `seroguld.ui.variant.v1`; invalid values fall back to classic. `AppShell` mounts the unchanged `MakeRoot` for classic and `ModernRootShell` for modern. Route wrappers reuse existing hooks. A transition registry blocks unsafe switches, and a modern-only error boundary persists classic and writes a bounded Tauri diagnostic. Customer-display variant is carried only in the second webview route query.
