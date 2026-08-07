# Modern UI Screen Matrix

Date: 2026-08-06

| Route | Classic | Modern | Status | Notes |
|---|---|---|---|---|
| `/login` | Yes | Yes | Live | Modern login uses real auth state. |
| `/` | Yes | Yes | Live | Modern Alış module uses real purchase hook state. |
| `/dashboard` | Yes | Yes | Live | Modern dashboard uses real summary data. |
| `/depolama` | Yes | Yes | Live | Modern Depolama module uses real inventory hook state. |
| `/log` | Yes | Yes | Live | Modern Log module uses real log hook state. |
| `/musteriler` | Yes | Yes | Live | Modern Customers module uses real customer hook state. |
| `/musteri-ekran` | Yes | Yes | Live | Modern control page plus `?ui=` propagation to second display. |
| `/display/idle` | Yes | Yes | Live | Variant selected from route query for display windows. |
| `/display/:token` | Yes | Yes | Live | Variant selected from route query for display windows. |
| `/opmc` | Yes | Yes | Live | Modern list page uses real OPMC data. |
| `/opmc/:id` | Yes | Yes | Live | Modern detail page uses real OPMC data. |
| `/settings` | Yes | Yes | Live | Variant controls available in both modes. |
| `/reports` | Yes | Yes | Live | Modern reports page uses real report endpoints. |
| `/uniconta` | Yes | No | Held | Modern page exists but was not wired because it drops too many current operator controls. |
| `/woocommerce` | Yes | No | Held | Modern page exists but is read-only compared with live classic workflow. |
| `/gdpr` | Yes | No | Held | Modern cockpit exists but does not yet preserve live approval / execution actions. |
| `/gdpr/privacy` | Yes | No | Held | Public route intentionally kept classic to avoid dropping live request-form behavior. |
| `/gdpr/cookies` | Yes | No | Held | Public route intentionally kept classic. |
| `/gdpr/request` | Yes | No | Held | Public route intentionally kept classic because modern public page is informational only. |
| `/gdpr/request/:token` | Yes | No | Held | Public route intentionally kept classic. |

Legend:

- `Live`: modern route is active behind the variant switch.
- `Held`: modern surface exists or is planned, but classic rendering was preserved for correctness.
