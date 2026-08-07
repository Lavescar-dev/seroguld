# Embedded Office Report

- Existing Office dock remains inside the Alış route and does not navigate to a global Office module.
- Modern Alış, Depolama, and Log invoke the existing workbook callbacks.
- An open dock blocks UI variant changes unless a clean sync state can be proven.
- Artifact DTOs now include checksum/workbook revision metadata where available.
- Field-level resolution and durable CRM/base/workbook revisions remain gap `OFFICE-REV-001`.

Purchase/Inventory/Ledger live OnlyOffice: NOT_RUN. Route-change code inspection: PASS.
