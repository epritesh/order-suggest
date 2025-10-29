# Zoho API mapping for Order Suggestions

This doc maps the data we need for purchase order suggestions to Zoho Books/Inventory APIs and to your provided data schema columns. Use it as a checklist to wire live data instead of mock data.

## Core inputs and where to fetch them

- Items (catalog + stock + purchasing)
  - API: Zoho Inventory > Items
    - GET /inventory/v1/items?per_page=200&page=1
  - Fields:
    - sku → Item.csv: `SKU` → API: `sku`
    - description → Item.csv: `Description` or `Item Name` → API: `name`/`description`
    - currentStock → Item.csv: `Stock On Hand` → API: `stock_on_hand` (or `warehouses`[].`available_stock` when using multi-warehouse)
    - reorderPoint → Item.csv: `Reorder Point` → API: `reorder_level` (or via Replenishment policy)
    - maxStock → Replenishment.csv: `Maximum Stock Level` → API: either `maximum_stock_level` or custom field on item
    - unitCost → Item.csv: `Purchase Rate` → API: `purchase_rate` (fallback: `cost_price`)
    - supplier (preferred) → Item.csv: `Vendor`/`CF.Alternate Supplier` → API: `vendor_name`/`preferred_vendor`
    - category → Item.csv: `Parent Category`/`Item Type` → API: `category_name`/`item_type`

- Sales trend (30/90/180 days)
  - Preferred API: Zoho Books > Invoices (line items and dates)
    - GET /books/v3/invoices?date_start=YYYY-MM-DD&date_end=YYYY-MM-DD&status=sent,paid
    - For each invoice, aggregate line item quantities by SKU
  - Alternative: Zoho Inventory > Reports > Item Details
    - GET /inventory/v1/reports/itemdetails?item_id=...&from_date=...&to_date=...
  - Schema reference: Invoice/*.csv: line items include `SKU`, `Quantity`, `Invoice Date`

- On-order quantity (open POs not yet received)
  - API: Zoho Books > Purchase Orders
    - GET /books/v3/purchaseorders?status=open,issued
    - Sum (Qty Ordered - Qty Received - Qty Cancelled) per SKU
  - Schema reference: Purchase_Order.csv: `QuantityOrdered`, `QuantityReceived`, `QuantityCancelled`, `SKU`

- Lead time days and safety stock
  - Not standard in APIs; recommended as Item custom fields
    - Example item custom fields: `CF.Lead Time Days`, `CF.Safety Stock`
    - Otherwise compute lead time from average time between PO date and Bill Date for that item (Bill.csv)
  - Schema reference: Bill.csv (`Bill Date`), Purchase_Order.csv (`Expected Arrival Date`) → derive lead time

- Price lists (optional)
  - Purchase price list for vendor-specific rates
    - API: Books > Price Lists (purchase)
    - GET /books/v3/pricelists?type=purchase
    - Schema: Purchase_Price_lists.csv: `SKU`, `PriceList Rate`

- Exchange rates (optional)
  - API: Books > Currencies
    - GET /books/v3/currencies/exchangerates?date=YYYY-MM-DD
  - Schema: Exchange_Rate.csv

## Minimal normalized shape consumed by the function/UI

We normalize to this shape before calling the suggestion logic:

```ts
{
  sku: string,
  description: string,
  currentStock: number,
  reorderPoint: number,
  maxStock: number,               // can come from Replenishment policy or item CF
  avgMonthlySales: number,        // computed from invoices over last N months
  lastSale: string,               // ISO date of most recent sale
  lastSupplied: string,           // last PO receipt/bill date for the item
  supplier: string,
  unitCost: number,
  category: string,
  salesTrend: 'increasing' | 'decreasing' | 'stable'
}
```

This matches the `SKUData` interface in `src/app/page.tsx` and the calculation used by the Catalyst function.

## Field crosswalk: schema → API → normalized

- Item.csv
  - `SKU` → Items.sku → sku
  - `Item Name`/`Description` → Items.name/description → description
  - `Stock On Hand` → Items.stock_on_hand → currentStock
  - `Reorder Point` → Items.reorder_level → reorderPoint
  - `Purchase Rate` → Items.purchase_rate → unitCost
  - `Vendor` → Items.vendor_name → supplier
  - `Parent Category`/`Item Type` → Items.category_name/item_type → category
  - Custom: `CF.Safety Stock` → safetyStock (if you add it) → influences calculation, optional
  - Custom: `CF.Lead Time Days` → leadTimeDays → influences calculation, optional

- Replenishment.csv
  - `Maximum Stock Level` → (custom field or policy) → maxStock
  - `Reorder Level` → Items.reorder_level (confirm policy sync) → reorderPoint

- Invoice/*.csv
  - `Invoice Date`, `SKU`, `Quantity` → aggregate sales by SKU over rolling windows (30/90/180 days) → avgMonthlySales, salesTrend, lastSale

- Purchase_Order.csv
  - `QuantityOrdered`/`QuantityReceived`/`QuantityCancelled` → sum outstanding → onOrder (optional)
  - `Purchase Order Date`/`Expected Arrival Date` → lead time derivation

- Bill.csv
  - `Bill Date` + PO item lines → lastSupplied and lead time derivation

## Auth and environment

- You’ll need Zoho OAuth to call Books/Inventory APIs from the function. Store credentials in Catalyst Secret Manager or as environment variables.
  - Required values to add to `.env` or Catalyst env:
    - ZOHO_ORG_ID
    - ZOHO_ACCOUNTS_BASE (default <https://accounts.zoho.com>)
    - ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET
    - ZOHO_REFRESH_TOKEN (recommended)
    - ZOHO_BOOKS_BASE (<https://books.zoho.com/api/v3>)
    - ZOHO_INVENTORY_BASE (<https://inventory.zoho.com/api/v1>)

## Implementation sketch (backend)

- Add a new route in the Catalyst function: `POST /fetch-live`
  - Input: `{ skus?: string[], warehouse_id?: string }`
  - Steps:
    1. Fetch items (paginate) and select purchasable + track inventory
    2. For each item (or provided SKUs), compute sales stats from invoices in last 180 days
    3. Compute `onOrder` from open POs
    4. Derive `avgMonthlySales`, `salesTrend`, `lastSale`, `lastSupplied`
    5. Return normalized array for the existing `/suggestions` endpoint
  - Output: `{ skuData: [...] }` so the UI can either call `/fetch-live` then `/suggestions`, or we proxy to suggestions inside the function

## Edge cases and notes

- Multi-warehouse: Items API returns stock per warehouse; choose a warehouse or sum across warehouses
- Non-inventory items: filter `track_inventory == true`
- Exclusions: filter SKUs starting with `0-`, `800-`, `2000-` (already implemented)
- Rate limiting: batch item IDs for invoices/POs; respect page size; add simple caching (Catalyst Cache)
- Time zones/dates: use org time zone when filtering invoice/PO dates
- Currency: normalize to org base currency; use exchange rates when needed

## Quick next steps

1. Confirm the org uses Zoho Inventory (stock source) with Zoho Books linked
2. Provide organization ID and, if applicable, default warehouse ID
3. Decide where lead time and safety stock live (custom fields vs derived)
4. I’ll add `/fetch-live` in the function and wire OAuth using Catalyst secrets
5. Finally, plug the live URL in `NEXT_PUBLIC_CATALYST_FUNCTION_URL` and verify from Slate
