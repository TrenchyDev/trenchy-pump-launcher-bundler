import {
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  VersionedTransaction,
} from '@solana/web3.js';
import bs58 from 'bs58';
import fs from 'fs';
import path from 'path';

// Match old bundler's endpoint list — fewer endpoints = less rate limiting
const JITO_ENDPOINTS = [
  'https://mainnet.block-engine.jito.wtf/api/v1/bundles',
  'https://amsterdam.mainnet.block-engine.jito.wtf/api/v1/bundles',
  'https://frankfurt.mainnet.block-engine.jito.wtf/api/v1/bundles',
  'https://ny.mainnet.block-engine.jito.wtf/api/v1/bundles',
  'https://tokyo.mainnet.block-engine.jito.wtf/api/v1/bundles',
];

const JITO_TIP_ACCOUNTS = [
  'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
  'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL',
  '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
  '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT',
  'HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe',
  'ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49',
  'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt',
  'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh',
];

let cachedTipAccounts: PublicKey[] | null = null;
let cachedTipAccountsAt = 0;
const TIP_CACHE_TTL_MS = 60_000;

const COOLDOWN_FILE = path.join(__dirname, '../../data/.jito-cooldown.json');
const COOLDOWN_SECONDS = 60;

function checkCooldown(): number {
  try {
    if (fs.existsSync(COOLDOWN_FILE)) {
      const data = JSON.parse(fs.readFileSync(COOLDOWN_FILE, 'utf8'));
      const elapsed = (Date.now() - (data.lastSubmission || 0)) / 1000;
      return Math.max(0, COOLDOWN_SECONDS - elapsed);
    }
  } catch {}
  return 0;
}

function updateCooldown() {
  try {
    const dir = path.dirname(COOLDOWN_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(COOLDOWN_FILE, JSON.stringify({ lastSubmission: Date.now() }, null, 2));
  } catch {}
}

function getRandomTipAccount(): PublicKey {
  return new PublicKey(JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)]);
}

function parseTipLamports(tipLamports?: number): number {
  let tip = tipLamports ?? (Number(process.env.JITO_TIP_LAMPORTS) || 5_000_000);
  // Defensive: if user set SOL units (e.g. 0.005) in env, convert to lamports.
  if (tip > 0 && tip < 10_000) {
    console.warn(`[Jito] Interpreting small tip value ${tip} as SOL and converting to lamports.`);
    tip = tip * LAMPORTS_PER_SOL;
  }
  return Math.max(1_000, Math.round(tip));
}

export async function getTipAccounts(): Promise<PublicKey[]> {
  const now = Date.now();
  if (cachedTipAccounts && now - cachedTipAccountsAt < TIP_CACHE_TTL_MS) {
    return cachedTipAccounts;
  }

  const url = JITO_ENDPOINTS[0];
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getTipAccounts',
        params: [],
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as any;
    const accounts = Array.isArray(data?.result) ? data.result : [];
    const parsed = accounts
      .filter((a: unknown) => typeof a === 'string')
      .map((a: string) => new PublicKey(a));
    if (parsed.length > 0) {
      cachedTipAccounts = parsed;
      cachedTipAccountsAt = now;
      return parsed;
    }
  } catch (err: any) {
    console.warn(`[Jito] getTipAccounts failed, using fallback list: ${err.message}`);
  }

  const fallback = JITO_TIP_ACCOUNTS.map(a => new PublicKey(a));
  cachedTipAccounts = fallback;
  cachedTipAccountsAt = now;
  return fallback;
}

export async function getRandomLiveTipAccount(): Promise<PublicKey> {
  const accounts = await getTipAccounts();
  return accounts[Math.floor(Math.random() * accounts.length)] || getRandomTipAccount();
}

export function buildTipInstruction(
  payer: PublicKey,
  tipLamports?: number,
  tipAccount?: PublicKey,
): TransactionInstruction {
  const tip = parseTipLamports(tipLamports);
  return SystemProgram.transfer({
    fromPubkey: payer,
    toPubkey: tipAccount || getRandomTipAccount(),
    lamports: tip,
  });
}

async function sendToEndpoint(
  url: string,
  serialized: string[],
  maxRetries = 5,
): Promise<{ bundleId: string } | null> {
  const host = new URL(url).hostname;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1,
          method: 'sendBundle',
          params: [serialized],
        }),
        signal: AbortSignal.timeout(30_000),
      });

      if (res.status === 429 || res.status >= 500) {
        const backoff = Math.min(2000 * Math.pow(2, attempt), 10000) + Math.random() * 600;
        console.log(`[Jito] ${res.status} on ${host}, retry in ${Math.round(backoff)}ms (${attempt + 1}/${maxRetries})`);
        if (attempt < maxRetries - 1) {
          await new Promise(r => setTimeout(r, backoff));
        }
        continue;
      }

      if (!res.ok) {
        let details = '';
        try {
          const bodyText = await res.text();
          details = bodyText ? ` — ${bodyText.slice(0, 300)}` : '';
        } catch {}
        console.log(`[Jito] HTTP ${res.status} on ${host} (non-retryable)${details}`);
        return null;
      }

      const data = (await res.json()) as any;
      if (data?.result) return { bundleId: data.result };
      if (data?.error) console.log(`[Jito] RPC error on ${host}:`, data.error?.message || data.error);
      return null;
    } catch (err: any) {
      const backoff = Math.min(2000 * Math.pow(2, attempt), 10000) + Math.random() * 600;
      console.log(`[Jito] Error on ${host}: ${err.message}. Retry in ${Math.round(backoff)}ms (${attempt + 1}/${maxRetries})`);
      if (attempt < maxRetries - 1) {
        await new Promise(r => setTimeout(r, backoff));
      }
    }
  }
  return null;
}

function verifyBundleHasTip(transactions: VersionedTransaction[]): void {
  const tipSet = new Set(JITO_TIP_ACCOUNTS);
  for (let i = 0; i < transactions.length; i++) {
    const msg = transactions[i].message;
    const keys = msg.staticAccountKeys;
    const numSig = msg.header.numRequiredSignatures;
    const numReadonlySigned = msg.header.numReadonlySignedAccounts;
    const numReadonlyUnsigned = msg.header.numReadonlyUnsignedAccounts;
    const numWritableSigned = numSig - numReadonlySigned;
    const numWritableUnsigned = keys.length - numSig - numReadonlyUnsigned;

    const writableKeys: string[] = [];
    for (let j = 0; j < numWritableSigned; j++) writableKeys.push(keys[j].toBase58());
    for (let j = numSig; j < numSig + numWritableUnsigned; j++) writableKeys.push(keys[j].toBase58());

    const tipFound = writableKeys.find(k => tipSet.has(k));
    console.log(`[Jito] TX ${i}: ${keys.length} keys, ${writableKeys.length} writable. Tip in writable: ${tipFound || 'NONE'}`);
    if (tipFound) {
      console.log(`[Jito] ✓ Bundle tip verification PASSED (tx ${i}, account ${tipFound})`);
      return;
    }
  }
  console.error('[Jito] ✗ Bundle tip verification FAILED — no tip account found in any writable key!');
  console.error('[Jito] All writable keys per tx dumped above for debugging.');
}

export async function submitBundle(
  transactions: VersionedTransaction[],
  options?: { skipCooldown?: boolean },
): Promise<{ bundleId: string; signature: string }> {
  if (!transactions.length) throw new Error('No transactions provided');

  if (!options?.skipCooldown) {
    const cooldown = checkCooldown();
    if (cooldown > 0) {
      console.log(`[Jito] Cooldown: ${cooldown.toFixed(1)}s remaining...`);
      await new Promise(r => setTimeout(r, cooldown * 1000));
    }
  }

  verifyBundleHasTip(transactions);

  const serialized = transactions.map(tx => bs58.encode(tx.serialize()));
  const firstTxSig = bs58.encode(transactions[0].signatures[0]);

  // Multi-endpoint race: hit all endpoints each round, first success wins
  const MAX_ROUNDS = 3;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const shuffled = [...JITO_ENDPOINTS].sort(() => Math.random() - 0.5);
    console.log(`[Jito] Round ${round + 1}: sending ${serialized.length} tx(s) to ${shuffled.length} endpoint(s)`);
    const results = await Promise.all(shuffled.map(url => sendToEndpoint(url, serialized)));
    const success = results.find(r => r !== null);

    if (success) {
      console.log(`[Jito] Bundle accepted: ${success.bundleId}`);
      console.log(`[Jito] https://jito.wtf/bundle/${success.bundleId}`);
      updateCooldown();
      return { bundleId: success.bundleId, signature: firstTxSig };
    }

    if (round < MAX_ROUNDS - 1) {
      const wait = 3000 + Math.random() * 2000;
      console.log(`[Jito] No acceptance in round ${round + 1}, waiting ${(wait / 1000).toFixed(1)}s...`);
      await new Promise(r => setTimeout(r, wait));
    }
  }

  updateCooldown();
  console.log('[Jito] No endpoint accepted after all rounds');
  return { bundleId: 'unknown', signature: firstTxSig };
}

export type InflightBundleStatus = 'Pending' | 'Landed' | 'Failed' | 'Invalid' | 'Unknown';

export async function getInflightBundleStatus(bundleId: string): Promise<InflightBundleStatus> {
  if (!bundleId || bundleId === 'unknown') return 'Unknown';
  const statusUrl = JITO_ENDPOINTS[0].replace('/bundles', '/getInflightBundleStatuses');
  try {
    const res = await fetch(statusUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getInflightBundleStatuses',
        params: [[bundleId]],
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return 'Unknown';
    const data = (await res.json()) as any;
    const value = data?.result?.value?.[0];
    const status = value?.status as InflightBundleStatus | undefined;
    return status || 'Unknown';
  } catch {
    return 'Unknown';
  }
}

export async function confirmBundle(bundleId: string, timeoutMs = 60_000): Promise<string> {
  if (bundleId === 'unknown') throw new Error('Bundle was not accepted by any endpoint');

  const start = Date.now();
  const statusUrl = JITO_ENDPOINTS[0].replace('/bundles', '/getBundleStatuses');

  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(statusUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBundleStatuses', params: [[bundleId]] }),
        signal: AbortSignal.timeout(10_000),
      });
      const data = (await res.json()) as any;
      const statuses = data?.result?.value;
      if (statuses?.length > 0) {
        const s = statuses[0];
        if (s.confirmation_status === 'confirmed' || s.confirmation_status === 'finalized') {
          return s.transactions?.[0] || bundleId;
        }
        if (s.err) throw new Error(`Bundle failed: ${JSON.stringify(s.err)}`);
      }
    } catch (err: any) {
      if (err.message?.startsWith('Bundle failed')) throw err;
    }
    await new Promise(r => setTimeout(r, 2500));
  }

  throw new Error('Bundle confirmation timed out');
}
