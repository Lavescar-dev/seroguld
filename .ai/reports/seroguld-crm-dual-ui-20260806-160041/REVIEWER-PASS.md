# Reviewer Pass

The read-only reviewer identified two medium risks:

1. Second-display pages did not explicitly expose the selected variant. Resolution: both public display wrappers now stamp `data-display-ui-variant`; the root provider reads the validated display-route `?ui=` value and the modern display token override cascades through the existing safe DTO renderer.
2. Alış switching did not explicitly flush dirty/autosave state. Resolution: `useAlisMakeState` now exposes dynamic pending-sync inspection and its existing flush operation; the transition registry returns `settling`, awaits the flush, and re-inspects before applying the variant. Finalize/customer/cancel operations remain blocking.

After the fixes, frontend build and all 37 Vitest tests pass. The reviewer found no concrete regression in public PII scrubbing, Tauri diagnostic sanitization, or artifact metadata.
