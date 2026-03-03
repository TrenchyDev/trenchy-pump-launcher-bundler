import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
  LAMPORTS_PER_SOL,
  SendTransactionError,
} from '@solana/web3.js';
import bs58 from 'bs58';
import * as sessionOverrides from './session-overrides';

const FALLBACK_RPC = 'https://api.mainnet-beta.solana.com';

let mainConnection: Connection | null = null;
let fallbackConnection: Connection | null = null;

function isRetryableRpcError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes('fetch failed') ||
    msg.includes('ECONNREFUSED') ||
    msg.includes('ETIMEDOUT') ||
    msg.includes('ENOTFOUND') ||
    msg.includes('ECONNRESET') ||
    msg.includes('socket hang up')
  );
}

/** Polling-based confirmation — works with HTTP-only RPCs that don't support signatureSubscribe */
export async function confirmTransactionPolling(
  conn: Connection,
  signature: string,
  timeoutMs = 60_000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await conn.getSignatureStatuses([signature], { searchTransactionHistory: true });
    const status = res.value[0];
    if (status?.err) throw new Error(`Transaction failed: ${JSON.stringify(status.err)}`);
    if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') {
      return;
    }
    await new Promise(r => setTimeout(r, 1500));
  }
  throw new Error(`Transaction confirmation timeout: ${signature.slice(0, 12)}...`);
}

function getMainConnection(rpcOverride?: string): Connection {
  const endpoint = rpcOverride?.trim() || process.env.RPC_ENDPOINT || FALLBACK_RPC;
  if (!rpcOverride && mainConnection) return mainConnection;
  if (rpcOverride) return new Connection(rpcOverride, { commitment: 'confirmed' });
  if (!mainConnection) {
    mainConnection = new Connection(endpoint, { commitment: 'confirmed' });
  }
  return mainConnection;
}

function getFallbackConnection(): Connection {
  if (!fallbackConnection) {
    fallbackConnection = new Connection(FALLBACK_RPC, { commitment: 'confirmed' });
  }
  return fallbackConnection;
}

/** Connection for a session (uses user RPC override if set, else server RPC) */
export async function getConnectionForSession(sessionId?: string): Promise<Connection> {
  const o = sessionId ? await sessionOverrides.getOverrides(sessionId) : {};
  return getConnection(o.rpcEndpoint);
}

/** Connection that tries main RPC first, falls back to free public RPC on failure */
export function getConnection(rpcOverride?: string): Connection {
  const main = getMainConnection(rpcOverride);
  const fallback = getFallbackConnection();
  if (process.env.RPC_ENDPOINT && process.env.RPC_ENDPOINT !== FALLBACK_RPC) {
    return new Proxy(main, {
      get(target, prop) {
        const value = (target as unknown as Record<string | symbol, unknown>)[prop];
        if (typeof value === 'function') {
          return (...args: unknown[]) => {
            const result = (value as (...a: unknown[]) => unknown).apply(target, args);
            if (result && typeof (result as Promise<unknown>).then === 'function') {
              return (result as Promise<unknown>).catch((err: unknown) => {
                if (isRetryableRpcError(err)) {
                  const fallbackFn = (fallback as unknown as Record<string | symbol, unknown>)[prop];
                  if (typeof fallbackFn === 'function') {
                    return (fallbackFn as (...a: unknown[]) => unknown).apply(fallback, args);
                  }
                }
                throw err;
              });
            }
            return result;
          };
        }
        return value;
      },
    }) as Connection;
  }
  return main;
}

/** Reset cached connections — use when RPC may be stale or after config change */
export function resetConnection(): void {
  mainConnection = null;
  fallbackConnection = null;
}

export function getFundingKeypair(override?: Keypair): Keypair {
  if (override) return override;
  const key = process.env.FUNDING_PRIVATE_KEY;
  if (!key || key === 'YOUR_BASE58_PRIVATE_KEY_HERE') throw new Error('FUNDING_PRIVATE_KEY not set');
  return Keypair.fromSecretKey(bs58.decode(key));
}

export async function getBalance(pubkey: PublicKey, conn?: Connection): Promise<number> {
  const c = conn ?? getConnection();
  const lamports = await c.getBalance(pubkey, 'finalized');
  return lamports / LAMPORTS_PER_SOL;
}

export async function transferSol(
  from: Keypair,
  to: PublicKey,
  solAmount: number,
  opts?: { maxRetries?: number; conn?: Connection },
): Promise<string> {
  const conn = opts?.conn ?? getConnection();
  const lamports = Math.round(solAmount * LAMPORTS_PER_SOL);
  const maxRetries = opts?.maxRetries ?? 3;

  const { blockhash } = await conn.getLatestBlockhash('confirmed');
  const message = new TransactionMessage({
    payerKey: from.publicKey,
    recentBlockhash: blockhash,
    instructions: [
      SystemProgram.transfer({
        fromPubkey: from.publicKey,
        toPubkey: to,
        lamports,
      }),
    ],
  }).compileToV0Message();

  const tx = new VersionedTransaction(message);
  tx.sign([from]);

  let lastErr: Error | null = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const sig = await conn.sendTransaction(tx, {
        skipPreflight: true,
        maxRetries: 5,
      });
      await confirmTransactionPolling(conn, sig);
      return sig;
    } catch (err: unknown) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      let extra = '';
      if (err instanceof SendTransactionError && err.getLogs) {
        try {
          const logs = await err.getLogs(conn);
          if (logs?.length) extra = ` | Logs: ${logs.slice(0, 5).join('; ')}`;
        } catch {}
      }
      if (attempt < maxRetries) {
        const delay = Math.min(attempt * 800, 2500);
        await new Promise(r => setTimeout(r, delay));
      } else {
        throw new Error(
          `Transfer ${solAmount} SOL failed after ${maxRetries} attempts: ${lastErr.message}${extra}`,
        );
      }
    }
  }
  throw lastErr || new Error('Transfer failed');
}

export async function executeTransaction(
  tx: VersionedTransaction,
  signers: Keypair[],
  conn?: Connection,
): Promise<string> {
  const c = conn ?? getConnection();
  tx.sign(signers);
  const sig = await c.sendTransaction(tx, { skipPreflight: true });
  await confirmTransactionPolling(c, sig);
  return sig;
}

export async function sendRawTransaction(serialized: Buffer, conn?: Connection): Promise<string> {
  const c = conn ?? getConnection();
  const sig = await c.sendRawTransaction(serialized, {
    skipPreflight: true,
    maxRetries: 3,
  });
  return sig;
}
