
# Decentralized Drive — Frontend Prototype (React + Vite + Tailwind)

A working **frontend-only** prototype of a decentralized drive:
- Drive-like UI (sidebar, list, details)
- **Client-side AES-GCM** encryption per file (Web Crypto API)
- Drag & drop + file picker uploads
- **Mock storage** via IndexedDB (no backend required)
- Download/preview by decrypting in the browser
- Share links (`#id=...&k=...&iv=...`) that keep the key in the URL fragment
- MetaMask **Connect** button (for auth presence; not required to use the mock storage)

## Quick Start

```bash
npm install
npm run dev
```

Open http://localhost:5173 in a Chromium-based browser.

## Features

- **Upload**: Files are encrypted **in the browser** using AES-GCM (unique key per file). The encrypted blob is saved into IndexedDB with a deterministic fake CID.
- **List & Details**: See file name, size, mime, created date, CID, IV, and key (base64). (Keys shown for demo; remove in production.)
- **Preview/Download**: Decrypts the encrypted blob and opens it in a new tab.
- **Share**: Copies a link with file id + key + IV in the URL **fragment** `#...` so servers/gateways do not receive the key.
- **MetaMask**: Connect wallet for future flows; not required for the mock storage.

## Roadmap Hooks (to add later)

- **StorageAdapter** can be swapped for IPFS (web3.storage/Pinata) or S3 multipart.
- Add **ChainAdapter** to commit `{ cid, encKey }` to a smart contract.
- Replace fragment-sharing with **access control** (e.g., Lit Protocol / per-recipient re-encryption).

## Notes

- This is a prototype: it intentionally exposes IV and key in the UI to demonstrate the flow. In production, never expose secrets.
- IndexedDB location can be cleared via browser devtools -> Application -> Storage.

## Scripts

- `npm run dev` — start Vite dev server
- `npm run build` — build for production
- `npm run preview` — preview the production build
