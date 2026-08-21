# Hostinger deployment checklist

This release is a **Node.js application**, not a static website. If the current
Hostinger deployment was created with **Deploy as static**, create or convert it
to a Hostinger Node.js app before switching the live Git branch. Static hosting
cannot execute `server.js`, authentication or MySQL operations.

## 1. Prepare safely

- Keep the currently working static deployment online until the Node app passes
  health and login checks.
- Use a staging subdomain such as `test.boraqexpress.com` first.
- Back up any existing web files and database before replacing a live site.
- Deploy a reviewed feature branch first; merge to the production branch only
  after staging validation.

## 2. Create managed MySQL

In hPanel, create a MySQL database and database user for SellFlow. Save the exact
Host, Database, Username and Password values shown by Hostinger. The database
user needs schema creation and normal read/write permissions on this database.

Do not put credentials in GitHub or any frontend file.

## 3. Configure the Node.js app

Connect the GitHub repository from Hostinger and select the branch to deploy.
The repository root contains `package.json`, so Hostinger should detect it as a
Node.js project.

| Setting | Value |
| --- | --- |
| Runtime | Node.js 20 or newer |
| Project/root directory | `/` |
| Install command | `npm install` (or Hostinger automatic install) |
| Build command | None |
| Start command | `npm start` |
| Application port | Use Hostinger-provided `PORT` |
| Output directory | None |

Do not select **Deploy as static** for this version.

## 4. Add environment variables

Add these in the Hostinger application environment settings:

```text
NODE_ENV=production
TRUST_PROXY=1
DB_HOST=<Hostinger value>
DB_PORT=3306
DB_NAME=<Hostinger value>
DB_USER=<Hostinger value>
DB_PASSWORD=<Hostinger value>
DB_SSL=false
SESSION_SECRET=<at least 32 random characters>
SESSION_TTL_HOURS=12
ADMIN_NAME=Muhammad Ullah
ADMIN_EMAIL=<initial admin email>
ADMIN_PASSWORD=<strong password, at least 12 characters>
```

Generate a session secret locally, for example:

```bash
openssl rand -base64 48
```

Use Hostinger's exact SSL requirement for the selected MySQL connection. Do not
guess: set `DB_SSL=true` only when Hostinger instructs that connection to use
TLS.

Leave marketplace values empty until official access is approved:

```text
SHOPEE_PARTNER_ID=
SHOPEE_PARTNER_KEY=
TIKTOK_APP_KEY=
TIKTOK_APP_SECRET=
LAZADA_APP_KEY=
LAZADA_APP_SECRET=
```

For direct PackProof video upload, enable the Google Drive API for a dedicated
OAuth client, create a private base folder and add all four values below. The
refresh token must have permission to create, read and delete files inside that
Drive. Do not create a public share link and never put these values in GitHub.

```text
GOOGLE_DRIVE_CLIENT_ID=<OAuth client ID>
GOOGLE_DRIVE_CLIENT_SECRET=<OAuth client secret>
GOOGLE_DRIVE_REFRESH_TOKEN=<offline refresh token>
# Optional; leave blank to create PackProof/YYYY/MM/DD automatically
GOOGLE_DRIVE_FOLDER_ID=
PACKPROOF_RETENTION_DAYS=30
PACKPROOF_MAX_FILE_BYTES=262144000
```

Use the minimum `https://www.googleapis.com/auth/drive.file` OAuth scope. This
lets SellFlow manage files and folders it creates without granting access to
unrelated Drive content. The app refuses a partial three-value credential
configuration. `GOOGLE_DRIVE_FOLDER_ID` is optional. When no Drive credentials
are supplied, the rest of SellFlow remains available and PackProof shows that
direct upload is awaiting authorization.

## 5. First boot

At startup the app runs ordered, idempotent migrations and records each one in
`schema_migrations`: `001_initial` creates the original operational tables,
`002_operations` adds price snapshots, shipping, returns, wallets and payouts,
and `003_packproof_drive` adds private-video metadata and resumable upload state.
If the `users` table is empty, the initial admin variables are required and
create the first Admin account. The server intentionally refuses to start with
an empty user table and no bootstrap administrator.

After the first successful login:

1. Create one Supplier and one Dropshipper account from **People & roles**.
2. Store their temporary passwords in a secure password manager.
3. Remove `ADMIN_PASSWORD` and `ADMIN_EMAIL` from the environment together if
   your Hostinger setup permits it, then restart. The existing admin remains in
   MySQL; bootstrap never replaces an existing user table.

## 6. Verification gate

Do not switch the production domain until all checks pass:

- `https://<staging-domain>/api/health` returns JSON with `"status":"ok"`.
- Admin login succeeds; wrong password fails.
- Admin can create Supplier and Dropshipper accounts.
- Supplier sees only owned products and assigned orders.
- Dropshipper cannot see supplier identity or supplier price.
- Creating an order reserves stock.
- Cancelling releases reserved stock; shipping records a negative inventory
  movement.
- Barcode/order scan starts packing; a video uploads privately to Google Drive
  in chunks; authenticated playback works; completion changes the order to
  `to_ship` and sets a 30-day retention date.
- Booking a manual shipment stores courier, tracking and optional HTTPS label
  metadata without pretending that a courier API was called.
- A Dropshipper return request is role-scoped; Admin can review it and a
  `restocked` decision creates exactly one positive inventory movement.
- Delivery credits the supplier pending wallet and order completion releases
  the snapshotted supplier payable to the available wallet.
- A payout request holds funds; Admin rejection returns them exactly once.
- Reports remain role-scoped and only Admin can open the audit trail.
- Changing a password invalidates the current and other active sessions.
- Shopee/TikTok/Lazada test sync reports approval/configuration required and
  writes a failed sync log—it must not claim success.
- Mobile and desktop layouts work over HTTPS.

## 7. Production switch and rollback

When staging passes, merge the reviewed branch into the production branch or
point Hostinger at the reviewed commit. Keep the prior working commit ID so you
can redeploy it if health or login checks fail.

If the Node deployment fails, inspect the Hostinger build/runtime logs first.
The most common blockers are missing environment variables, a wrong MySQL host,
database permission errors or a Node version below 20.
