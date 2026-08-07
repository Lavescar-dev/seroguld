# Import / Export Report

Existing real export and module callbacks were preserved. Reports use the existing authenticated XLSX helper. Unsupported modern bulk historical import/scanner/physical-print actions are disabled with reasons; no fake success toasts were introduced. Modern settings import/export is intentionally not wired because current whole-config JSON export can include secrets.

Alış/Depolama existing import/export: preserved, live smoke NOT_RUN. Log complete dry-run/apply/row-error workflow: MISSING (`LOG-IMPORT-001`). Historical side-effect isolation: not reimplemented; existing service behavior only.
