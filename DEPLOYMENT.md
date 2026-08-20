# Deployment checklist

## Before deployment

- Confirm the target domain or temporary subdomain.
- Back up any existing files in the target web root.
- Confirm that `index.html` is in the repository root.
- Keep build command and output directory empty; this project has no build step.

## Hostinger Git settings

| Setting | Value |
| --- | --- |
| Repository | Your GitHub repository |
| Branch | `main` |
| Project/root directory | `/` |
| Build command | None |
| Output directory | None / repository root |
| Environment variables | None |

## Verification after deployment

- Dashboard loads without a blank screen.
- Sidebar navigation opens every module.
- Order search and status filters work.
- Product and stock modals open and close.
- Packing verification buttons work.
- Layout remains usable on a mobile screen.
- HTTPS is active on the final domain.

## Important limitation

This package is a static prototype. Live marketplace synchronization requires official API approval and a secure backend; uploading this repository alone will not connect real stores or orders.
