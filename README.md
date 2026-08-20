# SellFlow Commerce OS

SellFlow is a role-based ecommerce operations MVP for Boraq Express. It replaces
the original static dashboard demo with a real Node.js application, MySQL
storage, server-enforced permissions, inventory reservations, order workflows,
barcode packing and PackProof records.

## What this release operates

- Secure login for Admin, Supplier and Dropshipper accounts
- Admin account creation, disable/enable and password reset
- Product catalogue with supplier price-review workflow
- Dropshipper-safe catalogue output: supplier identity and cost are removed by
  the server
- Supplier-safe order output: dropshipper identity and commercial order value
  are removed by the server
- Order creation, one-supplier fulfillment split, stock reservation and guarded
  status transitions
- Inventory adjustments and an immutable movement ledger
- Barcode/order/AWB packing sessions
- PackProof metadata, optional HTTPS evidence URL and 30-day retention date
- PackProof completion enforced before an order enters `to_ship`
- Marketplace adapter status and synchronization audit log
- Responsive, role-aware single-page interface served by the same Node process

## Honest integration boundary

There is currently no approved Shopee, TikTok Shop or Lazada API access. The
integration adapters therefore fail safely with a clear message and record the
attempt in `sync_logs`. The application does not present sample marketplace
data as live synchronization.

Credentials alone are not enough: each production connector still requires an
approved seller application, callback URLs and platform-specific activation.

## Technology

- Node.js 20+
- Express 5
- MySQL 8 / Hostinger managed MySQL
- Browser-native HTML, CSS and JavaScript (no frontend build step)
- Node `scrypt` password hashing and HMAC-signed sessions

## Local setup

1. Create an empty MySQL database and a database user with permission to create
   tables and read/write rows.
2. Copy `.env.example` to `.env` and enter the database, session and initial
   administrator values. Node does not load `.env` automatically, so export the
   values in your shell or use your preferred local environment loader.
3. Install dependencies and start the app:

   ```bash
   npm install
   npm start
   ```

4. Open `http://localhost:3000`.

On the first successful boot only, `ADMIN_EMAIL` and `ADMIN_PASSWORD` create the
initial administrator if the `users` table is empty. Use that account to create
Supplier and Dropshipper accounts from **People & roles**.

## Commands

| Command | Purpose |
| --- | --- |
| `npm start` | Start the production server |
| `npm run dev` | Start with Node watch mode |
| `npm run check` | Parse-check all server, client and test JavaScript |
| `npm test` | Run authentication and role-isolation tests |

## Main API areas

All data endpoints require authentication. All authenticated writes also
require the CSRF header issued at login.

| Area | Endpoints |
| --- | --- |
| Authentication | `/api/auth/login`, `/api/auth/me`, `/api/auth/logout` |
| Dashboard | `/api/dashboard` |
| Accounts | `/api/users` |
| Catalogue | `/api/products` |
| Inventory | `/api/inventory`, `/api/inventory/adjustments` |
| Orders | `/api/orders`, `/api/orders/:id/status` |
| PackProof | `/api/packing`, `/api/packing/scan`, `/api/packing/:id/complete` |
| Marketplaces | `/api/integrations`, `/api/integrations/:platform/sync` |
| Health | `/api/health` |

## Repository structure

```text
.
├── db/schema.sql
├── .github/workflows/ci.yml
├── public/
│   ├── app.js
│   ├── index.html
│   └── styles.css
├── src/
│   ├── routes/
│   └── services/
├── test/
├── .env.example
├── ARCHITECTURE.md
├── DEPLOYMENT.md
├── package.json
└── server.js
```

## Deliberate first-release limits

- PackProof stores the record and optional evidence URL, not uploaded video
  binary. Durable object storage and signed upload URLs belong in the next
  production phase.
- One order may contain products from only one supplier. A multi-supplier basket
  must be split into separate fulfillment orders.
- Marketplace connectors remain inactive until official API approval.
- Label generation, courier booking, returns and accounting are not included.

See [DEPLOYMENT.md](DEPLOYMENT.md) for the Hostinger Node.js deployment steps.

## Branding

SellFlow is an original interface. It does not copy BigSeller source code,
branding or proprietary assets.
