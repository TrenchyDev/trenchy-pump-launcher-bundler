# Trencher Bundler V2

https://github.com/user-attachments/assets/c05d9e75-c6e4-484d-85cf-d374f3c3d022

The next-generation Solana token launcher for pump.fun. Built from the ground up on the official `@pump-fun/pump-sdk` with Jito bundle support, real-time trade tracking, AI token generation, and a wallet vault.

Launch tokens, manage wallets, execute trades, and collect creator fees — all from a single dashboard.

> **V2 Protocol Native** — Built directly on pump.fun's V2 SDK (`@pump-fun/pump-sdk`) using Token Extensions (`TOKEN_2022_PROGRAM_ID`) and V2 program instructions. Not a patch on top of the old protocol — this is a full rewrite.

**Website:** [trenchytools.lol](https://trenchytools.lol)

---

## Features

- **One-click token launch** — Create and deploy pump.fun tokens with metadata, image upload, and social links
- **Jito bundle support** — Atomic bundles: token creation + dev buy + bundle wallet buys land in the same block
- **Bundle wallets** — Up to 5 wallets that buy alongside the token creation in a single Jito bundle
- **Holder wallets** — Up to 10 additional wallets with configurable auto-buy delays after launch
- **Custom wallet selection** — Use imported wallets for any launch slot (dev, bundle, holder) alongside auto-generated ones
- **AI token generation** — Generate token name, symbol, description, and image using Google Gemini with optional reference image
- **Vanity mint addresses** — Generate mint addresses ending in `pump` using multi-threaded workers with real-time progress
- **Address Lookup Tables** — LUT support for compressing transaction size (auto-enabled at 4+ bundle wallets)
- **Live trade tracking** — Real-time trade feed via PumpPortal WebSocket with PnL display
- **Rapid sell** — Bulk sell across all wallets or by group (dev, bundle, holder) at 25/50/75/100%
- **Creator fee collection** — Scan and collect unclaimed creator fees across all launches
- **Imported wallet vault** — Separate storage for imported wallets with delete support
- **Gather/sweep** — Recover all SOL from launch wallets back to funding wallet
- **Launch history** — Full history of launches with status, mint address, and wallet breakdown
- **RPC fallback** — If Jito bundle fails, automatically falls back to standard RPC submission

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Vite 7, TypeScript |
| Backend | Express, TypeScript, tsx (watch mode) |
| Blockchain | Solana Web3.js, SPL Token, Anchor |
| Pump.fun | @pump-fun/pump-sdk (V2 protocol) |
| Bundling | Jito Block Engine (multi-endpoint) |
| AI | Google Gemini (metadata + image generation) |
| Real-time | PumpPortal WebSocket, Server-Sent Events |

---

## Quick Start

### Prerequisites

- Node.js 18+
- npm
- A funded Solana wallet (for the funding wallet)
- An RPC endpoint (QuickNode, Helius, etc.)

### Installation

```bash
git clone <repo-url> pump-launcher
cd pump-launcher
npm run install:all
```

### Configuration

Create a `.env` file in the **`backend/`** directory (copy from `.env.example` in the project root):

```bash
cp .env.example backend/.env
```

Then edit `backend/.env` with your values:

```env
FUNDING_PRIVATE_KEY=your_base58_private_key_here
PRIVATE_KEY=your_base58_private_key_here
RPC_ENDPOINT=https://your-rpc-endpoint.com
JITO_TIP_LAMPORTS=5000000
```

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `FUNDING_PRIVATE_KEY` | Yes | — | Base58 private key for the main funding wallet. All SOL flows through this wallet. |
| `PRIVATE_KEY` | Yes | — | Same as FUNDING_PRIVATE_KEY (used by some services). |
| `RPC_ENDPOINT` | No | `https://api.mainnet-beta.solana.com` | Solana RPC endpoint. A paid RPC (QuickNode, Helius) is strongly recommended. |
| `JITO_TIP_LAMPORTS` | No | `5000000` | Jito tip amount in lamports (5,000,000 = 0.005 SOL). Higher tips = faster inclusion. |
| `PORT` | No | `3001` | Backend server port. |

**Optional:**

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ENCRYPTION_KEY` | No | auto-generated | Custom key for legacy wallet migration. |
| `BIRDEYE_API_KEY` | No | — | Reserved for future features. |
| `GOOGLE_GEMINI_API_KEY` | No | — | Required for AI token generation (name, description, image). |

> **Note:** There is NO `.env` file in the project root. Only `backend/.env` is loaded by the server.

### Run

```bash
npm run dev
```

This starts both the frontend and backend concurrently:
- **Frontend**: http://localhost:5173
- **Backend API**: http://localhost:3001

---

## How It Works

### Launch Flow

```
Funding Wallet
    |
    |-- 1. Generate mint keypair (random or vanity)
    |-- 2. Create & fund dev wallet (or use imported)
    |-- 3. Create & fund bundle wallets 0-5 (or use imported)
    |-- 4. Create & fund holder wallets 0-10 (or use imported)
    |-- 5. Upload metadata to pump.fun IPFS
    |-- 6. Create Address Lookup Table (auto at 4+ bundles)
    |
    |-- 7. Build transactions:
    |       TX1: Create token + dev buy
    |       TX2-N: Bundle wallet buys (up to 4 buys per TX)
    |       TX-last: Jito tip
    |
    |-- 8. Submit Jito bundle (or RPC fallback)
    |-- 9. Confirm on-chain
    |-- 10. Holder wallets auto-buy (with delay)
    |
    v
Token Live on pump.fun
```

### Jito Bundles

When Jito mode is enabled, all transactions are submitted as an atomic bundle to Jito's block engine. The bundle is sent to multiple Jito endpoints simultaneously (mainnet, Amsterdam, Frankfurt, NY, Tokyo) and the first successful response wins. If all Jito endpoints fail, the system falls back to standard RPC submission (unless strict mode is enabled).

### Wallet Storage

The project uses two separate wallet stores in `backend/keys/`:

- **`wallets.json`** — Auto-generated launch wallets (dev, bundle, holder, mint, funding). Created during launches, archived after use.
- **`imported-wallets.json`** — User-imported wallets. Stored separately so they're never accidentally archived or lost. Deleting an imported wallet removes it permanently.

All private keys are stored as plaintext base58 strings. Both files are gitignored.

### V2 Protocol (Feb 26, 2026 Update)

This launcher uses the new V2 protocol via `@pump-fun/pump-sdk` natively:
- Token creation uses `TOKEN_2022_PROGRAM_ID` (Token Extensions)
- Combined create + buy via `createV2AndBuyInstructions`
- V2 PDAs: `bondingCurveV2Pda` and `creatorVaultPda`
- Offline bonding curve simulation for bundle buys

---

## Project Structure

```
pump-launcher/
├── backend/
│   ├── .env                         # Configuration (gitignored)
│   ├── keys/                        # Wallet storage (gitignored)
│   │   ├── wallets.json             # Auto-generated launch wallets
│   │   └── imported-wallets.json    # User-imported wallets
│   ├── data/                        # Runtime data (gitignored)
│   │   ├── launches.json            # Launch history
│   │   ├── trades.json              # Trade records
│   │   ├── vanity-pool.json         # Generated vanity addresses
│   │   └── uploads/                 # Token images
│   └── src/
│       ├── index.ts                 # Express server entry point
│       ├── routes/
│       │   ├── launch.ts            # Token launch endpoints + SSE
│       │   ├── trading.ts           # Buy, sell, rapid sell, fee collection
│       │   ├── wallets.ts           # Wallet CRUD, gather, balances, imported
│       │   ├── upload.ts            # Image upload
│       │   ├── ai.ts                # AI token generation (Gemini)
│       │   ├── env.ts               # Environment variable management
│       │   ├── live-trades.ts       # PumpPortal live trade SSE
│       │   └── vanity.ts            # Vanity address pool
│       ├── services/
│       │   ├── launch-executor.ts   # Full launch orchestration
│       │   ├── pumpfun.ts           # Pump.fun SDK wrapper (create, buy, sell)
│       │   ├── jito.ts              # Jito bundle submission
│       │   ├── vault.ts             # Wallet storage (generated + imported)
│       │   ├── lut.ts               # Address Lookup Tables
│       │   ├── solana.ts            # Connection, transfers, execution
│       │   ├── pumpportal.ts        # Live trade WebSocket
│       │   ├── gemini.ts            # Google Gemini AI integration
│       │   └── vanity.ts            # Vanity address generator (workers)
│       └── types/
│           └── index.ts             # TypeScript interfaces
├── frontend/
│   ├── public/image/                # Static assets (logo, etc.)
│   └── src/
│       ├── pages/
│       │   ├── Launch.tsx           # Token launch form + AI generator
│       │   ├── Trading.tsx          # Trade execution + live feed
│       │   ├── Wallets.tsx          # Wallet management + fees + imported
│       │   └── Settings.tsx         # Environment variable editor
│       └── components/
│           ├── layout/
│           │   ├── Sidebar.tsx      # Navigation sidebar
│           │   └── Header.tsx       # Top header bar
│           ├── ui/                  # Reusable UI components
│           └── ...
├── .env.example                     # Template — copy to backend/.env
├── .gitignore
├── package.json                     # Root — runs both frontend + backend
└── FEATURE_ROADMAP.md
```

---

## API Reference

### Launch

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/launch` | Create and execute a token launch |
| `GET` | `/api/launch` | List recent launches |
| `GET` | `/api/launch/:id` | Get launch details |
| `GET` | `/api/launch/:id/stream` | SSE stream for launch progress |
| `DELETE` | `/api/launch/:id` | Delete a launch record |

### Trading

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/trading/execute` | Execute a buy or sell |
| `POST` | `/api/trading/rapid-sell` | Bulk sell across wallets |
| `GET` | `/api/trading/history` | Trade history |
| `GET` | `/api/trading/creator-fees-available` | Check unclaimed fees for a launch |
| `POST` | `/api/trading/collect-creator-fees` | Collect fees for a launch |
| `GET` | `/api/trading/all-unclaimed-fees` | Scan all launches for unclaimed fees |
| `POST` | `/api/trading/collect-all-fees` | Bulk collect fees |

### Wallets

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/wallets` | List wallets (filter by type, status) |
| `GET` | `/api/wallets/funding` | Funding wallet balance |
| `GET` | `/api/wallets/available` | List wallets available for launch assignment |
| `GET` | `/api/wallets/imported` | List imported wallets |
| `DELETE` | `/api/wallets/imported/:id` | Permanently delete an imported wallet |
| `POST` | `/api/wallets/generate` | Generate new wallets |
| `POST` | `/api/wallets/import` | Import wallet by private key |
| `POST` | `/api/wallets/refresh-balances` | Refresh SOL balances |
| `POST` | `/api/wallets/gather` | Sweep SOL to funding wallet |
| `POST` | `/api/wallets/balances` | Get token + SOL balances |
| `PATCH` | `/api/wallets/:id/archive` | Archive a wallet |
| `POST` | `/api/wallets/archive-all` | Archive all wallets (protects imported) |
| `POST` | `/api/wallets/close-token-accounts` | Close empty token accounts |

### Vanity

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/vanity/pool-status` | Vanity pool size, generator status, and progress stats |
| `GET` | `/api/vanity/pool` | List vanity addresses |
| `GET` | `/api/vanity/next` | Get next available vanity address |
| `POST` | `/api/vanity/start` | Start vanity generator |
| `POST` | `/api/vanity/stop` | Stop vanity generator |

### AI

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/ai/generate-token` | Generate token metadata + image via Gemini |

### Live Trades

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/live-trades?mint=` | SSE stream for live trades |
| `POST` | `/api/live-trades/presubscribe` | Pre-subscribe to a mint |

---

## Usage Guide

### Launching a Token

1. Navigate to the **Launch** page
2. Fill in token details (name, symbol, description, image) — or use the **AI Generator** in the top right to auto-generate everything
3. Configure dev buy amount (how much SOL the creator wallet buys)
4. Optionally add bundle wallets (0-5, buy in the same Jito bundle as creation)
5. Optionally add holder wallets (0-10, buy after launch with configurable delay)
6. For any wallet slot, optionally select an imported wallet from the dropdown instead of auto-generating
7. Select vanity or random mint address (vanity addresses are auto-selected from the pool)
8. LUT is auto-enabled at 4+ bundle wallets
9. Click **Launch** — the dashboard shows real-time progress via SSE

### Managing Wallets

1. Navigate to the **Wallets** page
2. **Generate** wallets for manual use, or **Import** existing wallets by pasting a base58 private key
3. Imported wallets appear in their own section and are stored in `backend/keys/imported-wallets.json`
4. Imported wallets can be **deleted** (permanently removed) — they are never affected by "Archive All"
5. Auto-generated launch wallets can be archived and restored

### Recovering SOL

1. Navigate to the **Wallets** page
2. Click **Recover All SOL** to sweep from all non-funding wallets
3. Use **Scan All Launches** to find unclaimed creator fees, then **Collect All** to sweep them
4. Archive wallets and **Close All Token Accounts** to recover rent (~0.002 SOL per account)

### Trading

1. Navigate to the **Trading** page
2. Select a launch from history or enter a custom mint address
3. View the live Birdeye chart and real-time trade feed
4. Use per-wallet buy/sell buttons or the bulk sell bar
5. Collect creator fees when ready

---

## Security Notes

- **Never commit `backend/.env`** — It contains your funding wallet private key
- **`backend/keys/` is gitignored** — Wallet private keys stay local
- **`backend/data/` is gitignored** — Launch history, vanity pool (with mint keypairs), and trade data stay local
- **RPC endpoint** — Use a private RPC (QuickNode, Helius, Triton) for reliability and to avoid rate limits
- **Funding wallet** — Only keep the SOL you need for launches. Don't use a wallet with large holdings

---

## License

MIT License.

---

**Built for the Solana community by traders, for traders.**
