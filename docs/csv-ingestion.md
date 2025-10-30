# CSV-driven ingestion to reduce API usage

This document outlines a cost-aware workflow to ingest Zoho invoice data via CSV export instead of high-volume API calls. The goal is to finish one baseline precompute, and thereafter maintain suggestions using low-cost incremental CSV updates.

## Overview

- Upload CSV exports from Zoho Books (Invoices or Sales by Item/Invoice Line Items) instead of calling the API per item/invoice.
- Aggregate sales by SKU and month on the client (browser) or server, then send compact aggregates to the backend.
- Backend merges aggregates, recomputes only impacted SKUs, and leaves others untouched.

## Data model additions

Tables (Zoho Catalyst Data Store):

- sales_aggregates
  - sku (string, pk part)
  - year_month (string, format YYYY-MM, pk part)
  - qty (number)
  - last_updated_at (DATETIME)

- precompute_state
  - last_item_modified_at (DATETIME, optional)
  - last_invoice_modified_at (DATETIME, optional)
  - aggregates_window_months (INT, default 6)

## API surface (backend function)

- POST /ingest/aggregates
  - Body (JSON):
    - aggregates: Array of objects with fields: sku (string), year_month (string YYYY-MM), qty (number)
    - overwrite?: boolean (default: false) – if true, replaces qty for matching (sku, year_month); else adds to existing qty.
  - Behavior:
    - Upsert all aggregates into sales_aggregates.
    - Return an object like: { upserted: number, deduped: number }.

- POST /recompute/from-aggregates
  - Body (JSON):
    - skus?: array of string – optional subset; if omitted, recompute for all SKUs present in aggregates for the rolling window.
    - months?: number – optional window override (default from precompute_state.aggregates_window_months).
  - Behavior:
    - For each SKU, compute trend/avg monthly using sales_aggregates only.
    - Use stored current_stock when available; if missing, set suggested_quantity = 0 and reason = 'stock-unknown' (or keep previous suggestion).
    - Write to order_suggestions.

Notes:
- Keep invoicePages out of this path (no API calls).
- Optionally gate endpoints with ADMIN_TOKEN.

## Client (Next.js) flow: upload and aggregate

- UI: Admin page with file input for .csv or .csv.gz.
- Parse in browser with a CSV parser (e.g., PapaParse) with streaming if large.
- Map CSV columns to fields. Expected columns (recommended):
  - InvoiceDate (or Date)
  - SKU (or Item SKU/Item Code)
  - Quantity (positive for sales)
- Aggregation: bucket by SKU + year_month, sum quantities.
- POST to /ingest/aggregates with the aggregates payload.
- Optionally call /recompute/from-aggregates for the impacted SKUs.

### Column mapping

Different Zoho exports have different headers. Support a simple mapping UI or accept a mapping object alongside upload, e.g.: { skuCol: 'Item SKU', dateCol: 'Date', qtyCol: 'Quantity' }.

If a column is missing, the row is skipped and counted in a warning summary.

## Idempotency and dedupe

- For repeated imports, set overwrite=false to accumulate additional months incrementally, or overwrite=true to refresh a known months range.
- If the same (sku, year_month) appears multiple times within one import, combine client-side prior to sending.

## Cost & performance

- Large CSVs are processed client-side to aggregates to avoid uploading multi-MB files and long server execution.
- Server receives a compact payload (thousands of aggregates vs. hundreds of thousands of rows).
- No Zoho API calls during ingestion or recompute-from-aggregates, avoiding throttling and costs.

## Acceptance criteria

- Upload a CSV with at least 50k invoice lines; client aggregates and successfully posts <=5k monthly aggregates.
- Backend upserts aggregates and recomputes suggestions for affected SKUs without calling Zoho.
- order_suggestions reflects updated suggestions with a clear reason/source.

## Next steps

1. Implement Data Store tables (sales_aggregates, precompute_state).
2. Add endpoints: /ingest/aggregates and /recompute/from-aggregates.
3. Admin UI page: CSV upload with client-side aggregation and column mapping.
4. Optional: add a "mark stale" and "recompute subset" action for vendor/category filters.

## Troubleshooting

- If current stock is unknown/stale: either ingest an Items CSV export with current stock to refresh, or keep previous suggestion and mark reason accordingly.
- If your export uses different headers, provide a mapping; unknown rows will be skipped with count.
- For very large files, split by month or use gzip; the UI should support both.
