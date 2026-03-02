import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { Pool } from 'pg';

let pgPool: Pool | null = null;
const memoryStore = new Map<string, string>();

function getPool(): Pool | null {
  if (pgPool) return pgPool;
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  try {
    pgPool = new Pool({ connectionString: url });
    return pgPool;
  } catch {
    return null;
  }
}

export async function initFundingStore(): Promise<void> {
  const pool = getPool();
  if (!pool) {
    console.log('[FundingStore] No DATABASE_URL — using in-memory store (local dev)');
    return;
  }
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS funding_keys (
        session_id TEXT PRIMARY KEY,
        private_key TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    console.log('[FundingStore] PostgreSQL initialized');
  } catch (err) {
    console.error('[FundingStore] PostgreSQL init failed:', err);
  }
}

export async function saveFundingKey(sessionId: string, privateKey: string): Promise<void> {
  const key = privateKey.trim();
  if (!key) throw new Error('Private key required');

  try {
    Keypair.fromSecretKey(bs58.decode(key));
  } catch {
    throw new Error('Invalid Base58 private key');
  }

  const pool = getPool();
  if (pool) {
    await pool.query(
      `INSERT INTO funding_keys (session_id, private_key, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (session_id) DO UPDATE SET private_key = $2, updated_at = NOW()`,
      [sessionId, key],
    );
  } else {
    memoryStore.set(sessionId, key);
  }
}

export async function getFundingKey(sessionId: string): Promise<string | null> {
  const pool = getPool();
  if (pool) {
    const r = await pool.query('SELECT private_key FROM funding_keys WHERE session_id = $1', [sessionId]);
    return r.rows[0]?.private_key ?? null;
  }
  return memoryStore.get(sessionId) ?? null;
}

export async function deleteFundingKey(sessionId: string): Promise<void> {
  const pool = getPool();
  if (pool) {
    await pool.query('DELETE FROM funding_keys WHERE session_id = $1', [sessionId]);
  } else {
    memoryStore.delete(sessionId);
  }
}

export function getFundingKeypairFromKey(privateKey: string): Keypair {
  return Keypair.fromSecretKey(bs58.decode(privateKey.trim()));
}
