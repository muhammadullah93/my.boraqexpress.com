# SellFlow Commerce OS — MVP architecture

## Runtime

- Node.js 20 or newer
- Express 5 server
- Hostinger-managed MySQL
- Idempotent `001_initial` schema migration tracked in `schema_migrations`
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
`packing_sessions`, `integrations`, `sync_logs`, and `audit_logs`.

## Marketplace boundary

The project includes adapter interfaces and sync audit logs for Shopee, TikTok
Shop and Lazada. A sync request returns a clear `INTEGRATION_NOT_CONFIGURED`
response until official API credentials are present in the environment. The
application never pretends demo data is a live marketplace sync.

## PackProof boundary

The MVP stores barcode scans, packing sessions, timestamps, operator identity,
evidence status, evidence URL and a 30-day retention date. Video binary storage
must use durable object storage in the production phase; it is not stored in
the Git repository or MySQL.
