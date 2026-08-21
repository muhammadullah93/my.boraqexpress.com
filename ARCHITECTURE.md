# SellFlow Commerce OS — MVP architecture

## Runtime

- Node.js 20 or newer
- Express 5 server
- Hostinger-managed MySQL
- Ordered, idempotent schema migrations tracked in `schema_migrations`
- Same-origin HTML/CSS/JavaScript frontend served by Express
- Secrets supplied only through Hostinger environment variables

## Roles

| Role | Main permissions |
| --- | --- |
| Admin | Manage users, products, orders, inventory, packing and integrations |
| Supplier | Manage own products/stock and fulfil assigned orders; dropshipper identity is hidden |
| Dropshipper | Browse active catalogue, see platform/SRP prices and create/view own orders; supplier identity and supplier price are hidden |

## Security model

- Passwords use Node.js `scrypt` with a per-user random salt.
- Sessions are short-lived HMAC-signed tokens in `HttpOnly`, `SameSite=Lax` cookies.
- Every authenticated write requires a double-submit CSRF token.
- Account status and session version are checked against MySQL on every request.
- SQL values use prepared statements.
- Login attempts are rate-limited in-process.
- Security headers, strict JSON size limits and role checks are applied centrally.

## Core entities

`users`, `products`, `orders`, `order_items`, `inventory_movements`,
`packing_sessions`, `shipments`, `returns`, `return_items`, `wallet_accounts`,
`wallet_transactions`, `payout_requests`, `integrations`, `sync_logs`, and
`audit_logs`.

## Financial integrity

Each new order item snapshots the supplier unit price used for settlement.
Delivery moves the supplier payable into the pending wallet bucket; completion
releases it to the available bucket. Payout requests place an immediate hold
and require an Admin paid/rejected decision. Provider-side bank or gateway
settlement is deliberately outside the application until approved credentials
are configured.

## Marketplace boundary

The project includes adapter interfaces and sync audit logs for Shopee, TikTok
Shop and Lazada. A sync request returns a clear `INTEGRATION_NOT_CONFIGURED`
response until official API credentials are present in the environment. The
application never pretends demo data is a live marketplace sync.

## PackProof storage boundary

The application stores barcode scans, packing sessions, timestamps, operator
identity and evidence metadata in MySQL. Video bytes are uploaded in resumable
chunks to a private Google Drive date hierarchy (`YYYY/MM/DD`). The Drive file
ID is never exposed as a public share link: authorized users stream evidence
through the role-scoped API. A six-hour retention worker deletes Drive files
after the configured period (30 days by default) while preserving the text
audit record. Google Drive is behind a service module so higher-volume object
storage can replace it without changing the packing workflow.
