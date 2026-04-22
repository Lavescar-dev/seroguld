# Sero Guld CRM Frontend Redesign Handoff

## Goal

We are redesigning the frontend from scratch in React against the existing backend.

The redesign should preserve backend contracts and business flows. Excel files will be provided separately and should be treated as the UI/data source of truth for field ordering, wording, and document structure.

Primary UX surfaces that must exist in the redesign:

- Admin dashboard
- POS clerk screen: `/admin/pos`
- Afregningsbilag workspace: `/admin/afregningsbilag`
- Inventory: `/admin/products`
- Customers: `/admin/customers`
- Reports: `/admin/reports`
- Anti-fraud: `/admin/antifraud`
- AI settings/tools: `/admin/ai`
- Customer display: `/display/[token]`
- Idle display screen: `/display/idle`

## Tech / Auth assumptions

- Backend is FastAPI.
- Frontend is currently Next.js/React, but redesign can be a fresh React UI as long as it respects the backend API contract.
- Admin APIs are Bearer-token protected.
- Current auth flow:
  - `POST /api/auth/login`
  - `POST /api/auth/refresh`
  - `GET /api/auth/me`
- Current frontend stores tokens in localStorage and sends `Authorization: Bearer <access_token>`.
- Customer display snapshot + display websocket are public token-based and do not require admin auth.

## Core backend enums

- `PosTradeSideEnum`
  - `buy_from_customer`
  - `sell_to_customer`
- `PosSessionStatusEnum`
  - `draft`
  - `confirmed`
  - `cancelled`
- `PosDocumentTypeEnum`
  - `purchase_receipt`
  - `sale_invoice`
- `ProductStatusEnum`
  - `purchased`
  - `in_inventory`
  - `for_sale`
  - `sold`
  - `melted`
  - `undecided`
- `ProductTypeEnum`
  - `bracelet`
  - `ring`
  - `necklace`
  - `earring`
  - `chain`
  - `bar`
  - `jewelry`
- `MetalTypeEnum`
  - `yellow_gold`
  - `white_gold`
  - `silver`
  - `platinum`
  - `palladium`

## Important business rules

- Buy flow and sell flow both exist.
- Buy flow is the most important operational flow.
- Clerk screen supports multi-line buy sessions.
- Customer display must be customer-safe only.
- CPR, identity document numbers, internal margin, storage location, audit/meta info must not leak to customer display.
- A confirmed buy session creates products and creates an accounting/document layer.
- A confirmed buy session also creates an Afregningsbilag-like document record and transaction lines.
- Products created from buy flow can later move operationally:
  - `purchased -> in_inventory`
  - `purchased -> undecided`
  - `purchased -> melted`
- Direct melt is blocked if GDPR lock is active.
- Product-side GDPR lock exists and is exposed as `is_gdpr_locked`.

## Current backend route map

### Auth

- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `POST /api/auth/register`
- `GET /api/auth/me`

### POS admin API

- `POST /api/pos/sessions`
  - create POS session
- `GET /api/pos/sessions/open-draft`
  - reuse/open draft session for customer + trade side
- `GET /api/pos/sessions/{session_id}`
  - clerk snapshot for one session
- `PATCH /api/pos/sessions/{session_id}/quote`
  - update single-line quote/session summary fields
- `GET /api/pos/sessions/{session_id}/lines`
- `POST /api/pos/sessions/{session_id}/lines`
- `POST /api/pos/sessions/{session_id}/lines/bulk`
- `PATCH /api/pos/sessions/{session_id}/lines/{line_id}`
- `DELETE /api/pos/sessions/{session_id}/lines/{line_id}`
- `POST /api/pos/sessions/{session_id}/rate/sync`
- `PATCH /api/pos/sessions/{session_id}/rate/manual`
- `POST /api/pos/sessions/{session_id}/confirm`
- `POST /api/pos/sessions/{session_id}/cancel`
- `GET /api/pos/reference-next`
- `GET /api/pos/numbering/preview`
- `GET /api/pos/rates/live`
- `GET /api/pos/sessions/{session_id}/transaction`
- `GET /api/pos/sessions/{session_id}/receipt`

### POS document / AFG API

- `GET /api/pos/documents`
  - list documents
  - supports `q`
  - supports `kind=afregningsbilag|faktura`
  - exposes:
    - document number
    - customer
    - totals
    - line count
    - total weight
    - total pure gold
    - related product ids/numbers
    - operation state
    - product status counts
- `GET /api/pos/documents/{sequence_no}`
  - detail for one document
  - exposes:
    - customer info
    - totals
    - weight and pure gold
    - full line items
    - line product number/reference
    - purity
    - rate
    - line total
    - product status
    - product notes

### POS display / realtime

- `GET /api/pos/display/{display_token}`
  - customer-safe snapshot
- `WS /api/pos/display/{display_token}/ws`
  - public token-based customer display websocket
- `WS /api/pos/sessions/{session_id}/ws`
  - admin/clerk realtime websocket
  - admin token required

### Products / inventory

- `GET /api/products`
  - paginated inventory list
  - filters:
    - `status`
    - `metal_type`
    - `product_type`
    - `search`
    - `date_from`
    - `date_to`
- `POST /api/products`
- `GET /api/products/{product_id}`
- `PUT /api/products/{product_id}`
- `PATCH /api/products/{product_id}/status`
- `GET /api/products/{product_id}/history`
- `POST /api/products/{product_id}/photos`
- `DELETE /api/products/{product_id}/photos/{photo_id}`
- `POST /api/products/{product_id}/ai-describe`
- `PUT /api/products/{product_id}/ai-describe`
- `POST /api/products/{product_id}/publish`
- `POST /api/products/{product_id}/unpublish`
- Woo import / Woo sync routes also exist.

### Customers

- `GET /api/customers`
- `POST /api/customers`
- `GET /api/customers/search`
- `GET /api/customers/{customer_id}`
- `PUT /api/customers/{customer_id}`
- Woo import route exists

### Dashboard / reports / anti-fraud

- Dashboard summary routes exist:
  - `/api/dashboard/summary`
  - `/api/dashboard/stock-value`
  - `/api/dashboard/calendar`
  - `/api/dashboard/profit`
  - `/api/dashboard/ai-cost`
  - `/api/dashboard/ops`
  - `/api/dashboard/charts`
  - `/api/dashboard/integrations`
- Reports:
  - `/api/reports/daily`
  - `/api/reports/weekly`
  - `/api/reports/monthly`
  - `/api/reports/export`
- Anti-fraud:
  - `/api/antifraud/recent-orders`
  - `/api/antifraud/orders/{order_id}`

## POS request / response contracts

### Create session

`POST /api/pos/sessions`

Payload:

- `customer_id?: UUID`
- `customer_new?: { name, email?, phone?, address?, cpr_number?, identity_doc_type?, identity_doc_number?, identity_doc_country?, identity_photo_refs[] }`
- `trade_side: buy_from_customer | sell_to_customer`
- `force_new_session?: boolean`

Response:

- `PosSessionOutClerk`
- includes:
  - `id`
  - `session_code`
  - `display_token`
  - `customer_id`
  - `customer_name`
  - `trade_side`
  - `product_type`
  - `metal_type`
  - `weight_grams`
  - `purity_karat`
  - `purity_percentage`
  - `live_rate_dkk`
  - `manual_rate_dkk`
  - `active_rate_dkk`
  - `rate_source`
  - `margin_percent_internal`
  - `final_offer_dkk`
  - `status`
  - timestamps

### Session lines

`PosSessionLineCreate` / `PosSessionLineUpdate`

- `product_type`
- `metal_type`
- `weight_grams`
- `purity_karat`
- `purity_percentage`
- `rate_dkk`
- `margin_percent_internal`
- `notes`

`PosSessionLineOut`

- `id`
- `pos_session_id`
- `line_no`
- `product_type`
- `metal_type`
- `weight_grams`
- `purity_karat`
- `purity_percentage`
- `rate_dkk`
- `margin_percent_internal`
- `line_offer_dkk`
- `notes`

### Confirm session

`POST /api/pos/sessions/{session_id}/confirm`

Payload:

- `reference_number?: string`
- `notes?: string`
- `storage_location?: string`
- `needs_cleaning?: boolean`
- `allow_line_total_adjustment?: boolean`
- `sale_override_approved?: boolean`
- `sale_override_reason?: string`
- `sale_product_id?: UUID`
- `sale_price_dkk?: Decimal`
- `manual_purchase_cost_dkk?: Decimal`

Response:

- `session`
- `product_id`
- `product_number`
- `product_ids[]`
- `product_numbers[]`

## Customer display contract

Snapshot endpoint and websocket use `PosSessionDisplayOut`.

Main fields:

- `session_code`
- `status`
- `trade_side`
- `customer_name`
- `product_type`
- `metal_type`
- `weight_grams`
- `purity_karat`
- `purity_percentage`
- `rate_dkk`
- `final_offer_dkk`
- `line_count`
- `lines_total_dkk`
- `updated_at`
- `lines[]`

Line shape:

- `line_no`
- `product_type`
- `metal_type`
- `weight_grams`
- `purity_karat`
- `purity_percentage`
- `rate_dkk`
- `line_offer_dkk`
- `notes`

The display frontend must treat this as customer-safe only.

## Afregningsbilag / document contract

### List item

`GET /api/pos/documents`

Important fields:

- `sequence_no`
- `session_id`
- `session_code`
- `trade_side`
- `status`
- `document_type`
- `document_kind`
- `document_title`
- `document_number`
- `customer_name`
- `customer_phone`
- `customer_email`
- `currency_code`
- `gross_amount_dkk`
- `net_amount_dkk`
- `vat_amount_dkk`
- `line_count`
- `total_weight_grams`
- `total_pure_gold_grams`
- `product_ids[]`
- `product_numbers[]`
- `product_status_counts`
- `operation_state`
- `has_locked_products`
- `issued_at`
- `confirmed_at`

### Detail item

`GET /api/pos/documents/{sequence_no}`

Adds:

- `customer_address`
- `notes`
- full `lines[]`

Each detail line includes:

- `line_no`
- `product_id`
- `product_number`
- `reference_number`
- `product_type`
- `metal_type`
- `weight_grams`
- `purity_karat`
- `purity_percentage`
- `pure_gold_grams`
- `rate_dkk`
- `margin_percent`
- `line_total_dkk`
- `product_status`
- `is_gdpr_locked`
- `product_notes`

## Product contract

`ProductOut` contains:

- identity:
  - `id`
  - `product_number`
  - `reference_number`
- core product:
  - `product_type`
  - `metal_type`
  - `weight_grams`
  - `purity_karat`
  - `purity_percentage`
  - `pure_gold_grams`
- commercial:
  - `purchase_price_dkk`
  - `gold_rate_at_purchase`
  - `commission`
- parties:
  - `seller_customer_id`
  - `seller_name`
  - `buyer_customer_id`
  - `buyer_name`
- lifecycle:
  - `status`
  - `gdpr_release_date`
  - `is_gdpr_locked`
  - `sale_date`
  - `sale_price_dkk`
  - `profit_dkk`
  - `melt_date`
  - `melt_reason`
- ops/meta:
  - `notes`
  - `storage_location`
  - `needs_cleaning`
  - `photos[]`
  - `manual_review_required`
  - `manual_review_reasons[]`
  - `import_source_type`
- AI / publish:
  - `ai_description`
  - `ai_description_approved`
  - `woocommerce_product_id`
  - `is_published_to_site`
  - `published_at`

## Customer contract

`CustomerOut`

- `id`
- `email`
- `name`
- `phone`
- `address`
- `cpr_number_masked`
- `identity_doc_type`
- `identity_doc_number_masked`
- `identity_doc_country`
- `identity_photo_refs[]`
- `is_active`
- `created_at`

`CustomerDetailOut`

- `CustomerOut` +
- `stats`
- `risk`

## Excel mapping notes for the redesign agent

These are not yet a perfect visual implementation, but backend/frontend data structures already support most of the needed inputs:

- Customer identity / address fields exist in customer + POS create payloads.
- Multi-line buy flow exists.
- Each buy line supports:
  - type
  - metal
  - purity / karat
  - weight
  - rate
  - line note
- Confirm flow supports:
  - reference number
  - notes
  - storage location
  - needs cleaning
- Afregningsbilag/document layer now exposes:
  - totals
  - total pure gold
  - all transaction lines
  - related product numbers
  - operation state

The redesign agent should use the Excel files for:

- exact field order
- exact labels
- exact document sections
- exact purchase vs invoice presentation
- exact stock/depolama columns

## Non-negotiable frontend requirements for the redesign

- Do not redesign backend contracts first; use the existing backend as-is where possible.
- Treat Excel as the UI structure source of truth.
- Customer display must remain customer-safe.
- POS buy flow must remain multi-line first-class.
- A confirmed buy should appear in Afregningsbilag workspace.
- Afregningsbilag workspace must show:
  - document summary
  - total weight
  - total pure gold
  - all lines
  - routing to inventory / undecided / melt flow
- Inventory still uses `/api/products`.
- Customer search / selection should use `/api/customers/search`.
- Admin realtime POS should continue to use:
  - session endpoints
  - line endpoints
  - display snapshot
  - display websocket

## Current frontend route structure

- `/`
  - login
- `/admin`
  - dashboard
- `/admin/pos`
  - POS clerk flow
- `/admin/afregningsbilag`
  - document workspace
- `/admin/products`
  - inventory
- `/admin/customers`
  - customers
- `/admin/reports`
  - reports
- `/admin/antifraud`
  - anti-fraud
- `/admin/ai`
  - AI
- `/display/[token]`
  - customer-facing second screen
- `/display/idle`
  - idle second screen

## Recommended redesign approach

Build the new frontend as a clean React UI around these backend modules:

1. Auth shell
2. POS session + line editor
3. Customer display screen
4. Afregningsbilag workspace
5. Inventory
6. Customers
7. Dashboard / reports / anti-fraud

The highest-value redesign order is:

1. POS
2. Customer display
3. Afregningsbilag
4. Inventory
5. Dashboard and the rest
