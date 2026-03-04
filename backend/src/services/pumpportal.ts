import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import * as vault from './vault';

const WS_URL = 'wss://pumpportal.fun/api/data';
const RECONNECT_DELAY = 3000;
const MAX_TRADES = 200;
const TRADES_DIR = path.join(__dirname, '../../data/live-trades');

export interface FormattedTrade {
  signature: string;
  mint: string;
  type: string;
  trader: string;
  traderShort: string;
  solAmount: number;
  tokenAmount: number;
  marketCapSol: number | null;
  timestamp: number;
  isOurWallet: boolean;
  walletType: string | null;
  walletLabel: string | null;
  pool: string | null;
}

type TradeListener = (trade: FormattedTrade) => void;

function ensureDir() {
  if (!fs.existsSync(TRADES_DIR)) fs.mkdirSync(TRADES_DIR, { recursive: true });
}

function tradesFile(mint: string) { return path.join(TRADES_DIR, `${mint}.json`); }

function loadPersistedTrades(mint: string): FormattedTrade[] {
  ensureDir();
  const file = tradesFile(mint);
  if (!fs.existsSync(file)) return [];
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return []; }
}

function persistTrades(mint: string, trades: FormattedTrade[]) {
  ensureDir();
  try { fs.writeFileSync(tradesFile(mint), JSON.stringify(trades.slice(0, MAX_TRADES))); } catch {}
}

class PumpPortalTracker {
  private ws: WebSocket | null = null;
  private subscribedMint: string | null = null;
  private trades: FormattedTrade[] = [];
  private listeners = new Set<TradeListener>();
  private seenSigs = new Set<string>();
  private ourWallets = new Map<string, { type: string; label: string }>();
  private injectedWallets = new Map<string, Set<string>>();
  private alive = false;
  private persistTimer: ReturnType<typeof setInterval> | null = null;

  private fundingPubkeyOverride: string | null = null;
  private sessionIdOverride: string | null = null;

  private async refreshWallets(fundingPubkey?: string) {
    this.ourWallets.clear();
    try {
      const wallets = await vault.listWallets({}, this.sessionIdOverride ?? undefined);
      for (const w of wallets) {
        this.ourWallets.set(w.publicKey, { type: w.type, label: w.label });
      }
      if (fundingPubkey) {
        this.ourWallets.set(fundingPubkey, { type: 'funding', label: 'Funding' });
      } else if (this.fundingPubkeyOverride) {
        this.ourWallets.set(this.fundingPubkeyOverride, { type: 'funding', label: 'Funding' });
      } else {
        const pk = process.env.FUNDING_PRIVATE_KEY;
        if (pk && pk !== 'YOUR_BASE58_PRIVATE_KEY_HERE') {
          try {
            const { Keypair } = require('@solana/web3.js');
            const bs58 = require('bs58');
            const kp = Keypair.fromSecretKey(bs58.decode(pk));
            this.ourWallets.set(kp.publicKey.toBase58(), { type: 'funding', label: 'Funding' });
          } catch {}
        }
      }
    } catch {}
  }

  private formatTrade(raw: any): { trade: FormattedTrade; replacesInjected: boolean } | null {
    if (!raw.txType || raw.txType === 'create' || raw.txType === 'migrate') return null;
    const sig = raw.signature;
    if (!sig || this.seenSigs.has(sig)) return null;

    const trader = raw.traderPublicKey || '';
    const solAmt = raw.solAmount || raw.sol_amount || raw.amount || raw.sol || 0;
    const mint = raw.mint || '';
    const txType = raw.txType as string;

    let replacesInjected = false;
    if (txType === 'buy') {
      const injectedSet = this.injectedWallets.get(mint);
      if (injectedSet?.has(trader)) {
        replacesInjected = true;
        injectedSet.delete(trader);
        if (injectedSet.size === 0) this.injectedWallets.delete(mint);
      }
    }

    this.seenSigs.add(sig);
    const walletInfo = this.ourWallets.get(trader);
    const tokenAmt = raw.txType === 'buy'
      ? (raw.buy || raw.tokenAmount || 0)
      : (raw.sell || raw.tokenAmount || 0);

    return {
      trade: {
        signature: sig,
        mint,
        type: raw.txType,
        trader,
        traderShort: trader ? `${trader.slice(0, 4)}...${trader.slice(-4)}` : '???',
        solAmount: solAmt,
        tokenAmount: tokenAmt,
        marketCapSol: raw.marketCapSol || null,
        timestamp: raw.timestamp || Date.now(),
        isOurWallet: !!walletInfo,
        walletType: walletInfo?.type || null,
        walletLabel: walletInfo?.label || null,
        pool: raw.pool || null,
      },
      replacesInjected,
    };
  }

  private connect() {
    if (this.ws) {
      try { this.ws.close(); } catch {}
    }

    console.log('[PumpPortal] Connecting to', WS_URL);
    this.ws = new WebSocket(WS_URL);
    this.alive = true;

    this.ws.on('open', () => {
      console.log('[PumpPortal] Connected');
      if (this.subscribedMint) {
        this.sendSubscribe(this.subscribedMint);
      }
    });

    this.ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.txType) {
          const result = this.formatTrade(msg);
          if (result && result.trade.mint === this.subscribedMint) {
            const { trade, replacesInjected } = result;
            if (replacesInjected) {
              const idx = this.trades.findIndex(
                t => t.trader === trade.trader && t.mint === trade.mint && t.type === 'buy' && t.isOurWallet,
              );
              if (idx !== -1) {
                trade.walletType = this.trades[idx].walletType;
                trade.walletLabel = this.trades[idx].walletLabel;
                trade.isOurWallet = true;
                this.trades[idx] = trade;
              } else {
                this.trades.unshift(trade);
              }
            } else {
              this.trades.unshift(trade);
            }
            if (this.trades.length > MAX_TRADES) this.trades.length = MAX_TRADES;
            for (const cb of this.listeners) cb(trade);
          }
        }
      } catch {}
    });

    this.ws.on('close', () => {
      console.log('[PumpPortal] Disconnected');
      if (this.alive && this.subscribedMint) {
        setTimeout(() => this.connect(), RECONNECT_DELAY);
      }
    });

    this.ws.on('error', (err) => {
      console.error('[PumpPortal] WS error:', err.message);
    });
  }

  private sendSubscribe(mint: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ method: 'subscribeTokenTrade', keys: [mint] }));
      console.log(`[PumpPortal] Subscribed to ${mint.slice(0, 8)}...`);
    }
  }

  private sendUnsubscribe(mint: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ method: 'unsubscribeTokenTrade', keys: [mint] }));
      console.log(`[PumpPortal] Unsubscribed from ${mint.slice(0, 8)}...`);
    }
  }

  private startPersistTimer() {
    this.stopPersistTimer();
    this.persistTimer = setInterval(() => {
      if (this.subscribedMint && this.trades.length > 0) {
        persistTrades(this.subscribedMint, this.trades);
      }
    }, 10_000);
  }

  private stopPersistTimer() {
    if (this.persistTimer) { clearInterval(this.persistTimer); this.persistTimer = null; }
  }

  async subscribe(mint: string, fundingPubkey?: string, sessionId?: string) {
    if (fundingPubkey) this.fundingPubkeyOverride = fundingPubkey;
    if (sessionId) this.sessionIdOverride = sessionId;
    await this.refreshWallets(fundingPubkey);
    if (this.subscribedMint && this.subscribedMint !== mint) {
      if (this.trades.length > 0) persistTrades(this.subscribedMint, this.trades);
      this.injectedWallets.delete(this.subscribedMint);
      this.sendUnsubscribe(this.subscribedMint);
    }

    this.subscribedMint = mint;

    // Load persisted trades for this mint and merge with any in-memory ones
    const persisted = loadPersistedTrades(mint);
    const existingSigs = new Set(this.trades.filter(t => t.mint === mint).map(t => t.signature));
    const merged = [...this.trades.filter(t => t.mint === mint)];
    for (const t of persisted) {
      if (!existingSigs.has(t.signature)) {
        merged.push(t);
        existingSigs.add(t.signature);
      }
    }
    merged.sort((a, b) => b.timestamp - a.timestamp);
    this.trades = merged.slice(0, MAX_TRADES);
    this.seenSigs = new Set(this.trades.map(t => t.signature));

    this.startPersistTimer();

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.connect();
    } else {
      this.sendSubscribe(mint);
    }
  }

  unsubscribe() {
    if (this.subscribedMint && this.trades.length > 0) {
      persistTrades(this.subscribedMint, this.trades);
    }
    if (this.subscribedMint) {
      this.injectedWallets.delete(this.subscribedMint);
      this.sendUnsubscribe(this.subscribedMint);
    }
    this.subscribedMint = null;
    this.alive = false;
    this.stopPersistTimer();
    if (this.ws) {
      try { this.ws.close(); } catch {}
      this.ws = null;
    }
    console.log('[PumpPortal] Fully unsubscribed and disconnected');
  }

  /** Unsubscribe from the current mint but keep the WS connection open for future use */
  unsubscribeCurrentMint() {
    if (this.subscribedMint && this.trades.length > 0) {
      persistTrades(this.subscribedMint, this.trades);
    }
    if (this.subscribedMint) {
      this.injectedWallets.delete(this.subscribedMint);
      this.sendUnsubscribe(this.subscribedMint);
      console.log(`[PumpPortal] Stopped tracking ${this.subscribedMint.slice(0, 8)}...`);
    }
    this.subscribedMint = null;
    this.trades = [];
    this.seenSigs.clear();
    this.stopPersistTimer();
  }

  /** Get persisted trades for a specific mint (without subscribing) */
  getPersistedTrades(mint: string): FormattedTrade[] {
    return loadPersistedTrades(mint);
  }

  addListener(cb: TradeListener) { this.listeners.add(cb); }
  removeListener(cb: TradeListener) { this.listeners.delete(cb); }
  getTrades(): FormattedTrade[] { return [...this.trades]; }
  getSubscribedMint() { return this.subscribedMint; }

  /**
   * Inject a single trade (e.g. from manual buy/sell on the trading page).
   * Does NOT add the wallet to the injectedWallets blocklist — PumpPortal
   * messages for the same sig will be naturally deduped by seenSigs.
   */
  injectTrade(trade: FormattedTrade) {
    if (this.seenSigs.has(trade.signature)) return;
    this.seenSigs.add(trade.signature);
    this.trades.unshift(trade);
    if (this.trades.length > MAX_TRADES) this.trades.length = MAX_TRADES;
    for (const cb of this.listeners) cb(trade);
    if (this.subscribedMint === trade.mint) {
      persistTrades(trade.mint, this.trades);
    }
  }

  /**
   * Inject launch buys (dev + bundle) that Pump Portal may not track (e.g. Jito bundles).
   * Uses synthetic signatures so they don't conflict with real trades.
   * Registers each trader pubkey so future PumpPortal messages for the same
   * wallet+mint are silently dropped (wallet-pubkey-based dedup).
   */
  async injectLaunchBuys(mint: string, trades: FormattedTrade[]) {
    await this.refreshWallets();

    if (!this.injectedWallets.has(mint)) {
      this.injectedWallets.set(mint, new Set());
    }
    const injectedSet = this.injectedWallets.get(mint)!;

    for (const t of trades) {
      if (t.mint !== mint || this.seenSigs.has(t.signature)) continue;

      const existingIdx = this.trades.findIndex(
        ex => ex.trader === t.trader && ex.mint === mint && ex.type === 'buy',
      );
      if (existingIdx !== -1) {
        this.trades[existingIdx].walletType = t.walletType;
        this.trades[existingIdx].walletLabel = t.walletLabel;
        this.trades[existingIdx].isOurWallet = true;
        continue;
      }

      injectedSet.add(t.trader);
      this.seenSigs.add(t.signature);
      this.trades.unshift(t);
      if (this.trades.length > MAX_TRADES) this.trades.length = MAX_TRADES;
      for (const cb of this.listeners) cb(t);
    }
    if (this.subscribedMint === mint && trades.length > 0) {
      persistTrades(mint, this.trades);
    }
  }
}

export const tracker = new PumpPortalTracker();
