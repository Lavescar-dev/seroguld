# Validation Report

| Gate | Result | Evidence |
|---|---|---|
| Frontend typecheck | PASS | `npm run typecheck` |
| Frontend Vitest | PASS | 10 files, 37 tests |
| Frontend build | PASS | Vite production build; non-blocking chunk warnings |
| Cargo check | PASS | desktop crate |
| Rust tests | PASS | 3 passed |
| Display privacy backend tests | PASS | 4 passed |
| Full backend | PARTIAL | 85 passed, 12 baseline failures |
| Browser/Playwright smoke | NOT_RUN | authenticated runtime not started |
| Live OnlyOffice | NOT_RUN | service/reference workbook environment unavailable |
| Windows runtime / dual monitor | NOT_RUN | Linux host |

The 12 backend failures are caused by missing reference workbook files, a stale migration-head assertion (`0015` vs actual `0019`), and a stale Office callback test symbol. No PASS is claimed for them.
