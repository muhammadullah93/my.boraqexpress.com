# SellFlow Commerce OS

A responsive, zero-build static demo for multi-channel ecommerce operations. It includes dashboard, orders, products, inventory, barcode packing, PackProof evidence, shipping, analytics, stores, and settings screens.

## Important

This repository is a front-end demo. Marketplace APIs, live authentication, database storage, label printing, and PackProof recording are not connected yet.

## Run locally

No installation or build step is required.

1. Download or clone the repository.
2. Open `index.html` in Chrome, Edge, Firefox, or Safari.

For a local HTTP server, use any static server, for example VS Code Live Server.

## Deploy to Hostinger from GitHub

1. Create a new GitHub repository.
2. Upload all files from this folder to the repository root. `index.html` must remain at the root.
3. In hPanel, open **Websites → Dashboard → Advanced → Git**.
4. Choose **Continue with GitHub**, authorize GitHub, select the repository and branch, then deploy.
5. Use the repository root as the deployment folder. There is no build command and no output directory.

Because this is a static project, Hostinger should serve `index.html` directly. Do not deploy over an existing production site's `public_html` unless you have a backup or are intentionally replacing it.

## Deploy to GitHub Pages

The included workflow automatically publishes the repository to GitHub Pages.

1. Open the repository's **Settings → Pages**.
2. Under **Build and deployment**, select **GitHub Actions**.
3. Push to the `main` branch or run the workflow manually.

## Repository structure

```text
sellflow-commerce-os/
├── .github/workflows/pages.yml
├── assets/favicon.svg
├── .gitignore
├── .htaccess
├── index.html
├── robots.txt
├── site.webmanifest
├── DEPLOYMENT.md
└── README.md
```

## Next production phase

- Approved Shopee, TikTok Shop, and Lazada API integrations
- Secure user authentication and role permissions
- Persistent database and audit logs
- Server-side order, inventory, and label processing
- Live PackProof video storage and retention controls

## License and branding

The project is an original demo named SellFlow Commerce OS. It does not include BigSeller branding, proprietary code, or copied visual assets.
