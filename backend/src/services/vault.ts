import { Keypair } from '@solana/web3.js';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import bs58 from 'bs58';
import { Pool } from 'pg';

export interface StoredWallet {
  id: string;
  publicKey: string;
  privateKey: string;
  type: 'funding' | 'dev' | 'bundle' | 'holder' | 'manual' | 'mint' | 'sniper';
  label: string;
  status: 'active' | 'archived';
  createdAt: string;
  launchId?: string;
}

interface LegacyWallet {
  id: string;
  publicKey: string;
  encryptedKey: string;
  iv: string;
  type: StoredWallet['type'];
  label: string;
  status: 'active' | 'archived';
  createdAt: string;
  launchId?: string;
}

const KEYS_BASE = process.env.RAILWAY_VOLUME_MOUNT_PATH
  || process.env.KEYS_DATA_DIR
  || path.join(__dirname, '../../keys');
const DATA_FILE = path.join(KEYS_BASE, 'wallets.json');
const IMPORTED_FILE = path.join(KEYS_BASE, 'imported-wallets.json');

let pgPool: Pool | null = null;
const DEFAULT_SESSION = 'default';

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

function usePostgres(): boolean {
  return !!getPool();
}

function ensureKeysDir(): void {
  if (!fs.existsSync(KEYS_BASE)) fs.mkdirSync(KEYS_BASE, { recursive: true });
}

function legacyDecrypt(encrypted: string, iv: string): string {
  const raw = process.env.ENCRYPTION_KEY || 'default-key-change-me-32-chars!!';
  const key = crypto.createHash('sha256').update(raw).digest();
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, Buffer.from(iv, 'hex'));
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// --- File-based (local dev) ---

function readAllFile(): StoredWallet[] {
  if (!fs.existsSync(DATA_FILE)) return [];
  const raw = fs.readFileSync(DATA_FILE, 'utf8');
  const wallets = JSON.parse(raw || '[]') as any[];

  let migrated = false;
  const result: StoredWallet[] = wallets.map(w => {
    if (w.encryptedKey && w.iv && !w.privateKey) {
      migrated = true;
      try {
        const pk = legacyDecrypt(w.encryptedKey, w.iv);
        return {
          id: w.id,
          publicKey: w.publicKey,
          privateKey: pk,
          type: w.type === 'manual' && w.launchId && w.label?.startsWith('Mint - ') ? 'mint' : w.type,
          label: w.label,
          status: w.status,
          createdAt: w.createdAt,
          ...(w.launchId && { launchId: w.launchId }),
        };
      } catch {
        return {
          id: w.id,
          publicKey: w.publicKey,
          privateKey: '',
          type: w.type,
          label: w.label + ' (migration-failed)',
          status: w.status,
          createdAt: w.createdAt,
          ...(w.launchId && { launchId: w.launchId }),
        };
      }
    }

    if (w.type === 'manual' && w.launchId && w.label?.startsWith('Mint - ')) {
      migrated = true;
      w.type = 'mint';
    }

    return w as StoredWallet;
  });

  if (migrated) writeAllFile(result);
  return result;
}

function writeAllFile(wallets: StoredWallet[]) {
  ensureKeysDir();
  fs.writeFileSync(DATA_FILE, JSON.stringify(wallets, null, 2));
}

function readImportedFile(): StoredWallet[] {
  if (!fs.existsSync(IMPORTED_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(IMPORTED_FILE, 'utf8') || '[]'); } catch { return []; }
}

function writeImportedFile(wallets: StoredWallet[]) {
  ensureKeysDir();
  fs.writeFileSync(IMPORTED_FILE, JSON.stringify(wallets, null, 2));
}

// --- PostgreSQL ---

export async function initVaultStore(): Promise<void> {
  const pool = getPool();
  if (!pool) {
    console.log('[Vault] No DATABASE_URL — using file storage (local dev)');
    return;
  }
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS vault_wallets (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        public_key TEXT NOT NULL,
        private_key TEXT NOT NULL,
        type TEXT NOT NULL,
        label TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        launch_id TEXT,
        source TEXT NOT NULL DEFAULT 'generated',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(session_id, public_key)
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_vault_wallets_session ON vault_wallets(session_id)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_vault_wallets_launch ON vault_wallets(launch_id)
    `);
    console.log('[Vault] PostgreSQL initialized');
  } catch (err) {
    console.error('[Vault] PostgreSQL init failed:', err);
  }
}

function requireSession(sessionId?: string): string {
  if (usePostgres() && !sessionId) {
    throw new Error('Session required for vault operations (send x-session-id header)');
  }
  return sessionId || DEFAULT_SESSION;
}

async function readAllPg(sessionId: string): Promise<StoredWallet[]> {
  const pool = getPool();
  if (!pool) return [];
  const r = await pool.query(
    `SELECT id, public_key, private_key, type, label, status, launch_id, created_at
     FROM vault_wallets WHERE session_id = $1 AND source = 'generated'`,
    [sessionId],
  );
  return r.rows.map(row => ({
    id: row.id,
    publicKey: row.public_key,
    privateKey: row.private_key,
    type: row.type,
    label: row.label,
    status: row.status,
    launchId: row.launch_id ?? undefined,
    createdAt: row.created_at,
  }));
}

async function writeWalletPg(sessionId: string, w: StoredWallet, source: 'generated' | 'imported'): Promise<void> {
  const pool = getPool();
  if (!pool) return;
  await pool.query(
    `INSERT INTO vault_wallets (id, session_id, public_key, private_key, type, label, status, launch_id, source, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (id) DO UPDATE SET private_key = $4, type = $5, label = $6, status = $7, launch_id = $8`,
    [w.id, sessionId, w.publicKey, w.privateKey, w.type, w.label, w.status, w.launchId ?? null, source, w.createdAt],
  );
}

async function readImportedPg(sessionId: string): Promise<StoredWallet[]> {
  const pool = getPool();
  if (!pool) return [];
  const r = await pool.query(
    `SELECT id, public_key, private_key, type, label, status, launch_id, created_at
     FROM vault_wallets WHERE session_id = $1 AND source = 'imported'`,
    [sessionId],
  );
  return r.rows.map(row => ({
    id: row.id,
    publicKey: row.public_key,
    privateKey: row.private_key,
    type: row.type,
    label: row.label,
    status: row.status,
    launchId: row.launch_id ?? undefined,
    createdAt: row.created_at,
  }));
}

async function updateWalletPg(sessionId: string, walletId: string, updates: Partial<StoredWallet>): Promise<boolean> {
  const pool = getPool();
  if (!pool) return false;
  const sets: string[] = [];
  const vals: any[] = [];
  let i = 1;
  if (updates.status !== undefined) { sets.push(`status = $${i++}`); vals.push(updates.status); }
  if (updates.launchId !== undefined) { sets.push(`launch_id = $${i++}`); vals.push(updates.launchId); }
  if (updates.label !== undefined) { sets.push(`label = $${i++}`); vals.push(updates.label); }
  if (sets.length === 0) return true;
  vals.push(walletId, sessionId);
  const r = await pool.query(
    `UPDATE vault_wallets SET ${sets.join(', ')} WHERE id = $${i} AND session_id = $${i + 1}`,
    vals,
  );
  return (r.rowCount ?? 0) > 0;
}

async function deleteWalletPg(sessionId: string, walletId: string, source: 'generated' | 'imported'): Promise<boolean> {
  const pool = getPool();
  if (!pool) return false;
  const r = await pool.query(
    `DELETE FROM vault_wallets WHERE id = $1 AND session_id = $2 AND source = $3`,
    [walletId, sessionId, source],
  );
  return (r.rowCount ?? 0) > 0;
}

async function getWalletByIdPg(sessionId: string, walletId: string): Promise<StoredWallet | null> {
  const pool = getPool();
  if (!pool) return null;
  const r = await pool.query(
    `SELECT id, public_key, private_key, type, label, status, launch_id, created_at
     FROM vault_wallets WHERE id = $1 AND session_id = $2`,
    [walletId, sessionId],
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    publicKey: row.public_key,
    privateKey: row.private_key,
    type: row.type,
    label: row.label,
    status: row.status,
    launchId: row.launch_id ?? undefined,
    createdAt: row.created_at,
  };
}

// --- Unified API (sync for file, async for PG) ---

export async function generateAndStore(
  type: StoredWallet['type'],
  label: string,
  launchId?: string,
  sessionId?: string,
): Promise<{ wallet: StoredWallet; keypair: Keypair }> {
  const keypair = Keypair.generate();
  const secretB58 = bs58.encode(keypair.secretKey);

  const wallet: StoredWallet = {
    id: crypto.randomUUID(),
    publicKey: keypair.publicKey.toBase58(),
    privateKey: secretB58,
    type,
    label,
    status: 'active',
    createdAt: new Date().toISOString(),
    launchId,
  };

  const sid = requireSession(sessionId);

  if (usePostgres()) {
    await writeWalletPg(sid, wallet, 'generated');
    return { wallet, keypair };
  }

  const wallets = readAllFile();
  wallets.push(wallet);
  writeAllFile(wallets);
  return { wallet, keypair };
}

export async function importAndStore(
  keypair: Keypair,
  type: StoredWallet['type'],
  label: string,
  launchId?: string,
  sessionId?: string,
): Promise<StoredWallet> {
  const secretB58 = bs58.encode(keypair.secretKey);

  const wallet: StoredWallet = {
    id: crypto.randomUUID(),
    publicKey: keypair.publicKey.toBase58(),
    privateKey: secretB58,
    type,
    label,
    status: 'active',
    createdAt: new Date().toISOString(),
    launchId,
  };

  const sid = requireSession(sessionId);

  if (usePostgres()) {
    await writeWalletPg(sid, wallet, 'generated');
    return wallet;
  }

  const wallets = readAllFile();
  wallets.push(wallet);
  writeAllFile(wallets);
  return wallet;
}

export async function importKey(
  privateKeyB58: string,
  type: StoredWallet['type'],
  label: string,
  sessionId?: string,
): Promise<StoredWallet> {
  const kp = Keypair.fromSecretKey(bs58.decode(privateKeyB58));

  const wallet: StoredWallet = {
    id: crypto.randomUUID(),
    publicKey: kp.publicKey.toBase58(),
    privateKey: privateKeyB58,
    type,
    label,
    status: 'active',
    createdAt: new Date().toISOString(),
  };

  const sid = requireSession(sessionId);

  if (usePostgres()) {
    const imported = await readImportedPg(sid);
    if (imported.some(w => w.publicKey === wallet.publicKey)) {
      throw new Error('Wallet already imported');
    }
    await writeWalletPg(sid, wallet, 'imported');
    return wallet;
  }

  const imported = readImportedFile();
  if (imported.some(w => w.publicKey === wallet.publicKey)) {
    throw new Error('Wallet already imported');
  }
  imported.push(wallet);
  writeImportedFile(imported);
  return wallet;
}

export async function listImported(sessionId?: string): Promise<StoredWallet[]> {
  const sid = requireSession(sessionId);
  if (usePostgres()) return readImportedPg(sid);
  return readImportedFile();
}

export async function deleteImported(walletId: string, sessionId?: string): Promise<boolean> {
  const sid = requireSession(sessionId);
  if (usePostgres()) return deleteWalletPg(sid, walletId, 'imported');

  const imported = readImportedFile();
  const idx = imported.findIndex(w => w.id === walletId);
  if (idx === -1) return false;
  imported.splice(idx, 1);
  writeImportedFile(imported);
  return true;
}

export async function getImportedKeypair(walletId: string, sessionId?: string): Promise<Keypair | null> {
  const sid = requireSession(sessionId);
  let w: StoredWallet | null;
  if (usePostgres()) {
    const imported = await readImportedPg(sid);
    w = imported.find(x => x.id === walletId) ?? null;
  } else {
    w = readImportedFile().find(x => x.id === walletId) ?? null;
  }
  if (!w) return null;
  return Keypair.fromSecretKey(bs58.decode(w.privateKey));
}

export async function getImportedPrivateKey(walletId: string, sessionId?: string): Promise<string | null> {
  const sid = requireSession(sessionId);
  let w: StoredWallet | null;
  if (usePostgres()) {
    const imported = await readImportedPg(sid);
    w = imported.find(x => x.id === walletId) ?? null;
  } else {
    w = readImportedFile().find(x => x.id === walletId) ?? null;
  }
  return w?.privateKey ?? null;
}

export async function updateImportedLabel(walletId: string, label: string, sessionId?: string): Promise<StoredWallet | null> {
  const sid = requireSession(sessionId);
  if (usePostgres()) {
    const ok = await updateWalletPg(sid, walletId, { label });
    if (!ok) return null;
    return getWalletByIdPg(sid, walletId);
  }

  const imported = readImportedFile();
  const w = imported.find(x => x.id === walletId);
  if (!w) return null;
  w.label = label;
  writeImportedFile(imported);
  return w;
}

export async function assignToLaunch(walletId: string, launchId: string, sessionId?: string): Promise<{ wallet: StoredWallet; keypair: Keypair }> {
  const sid = requireSession(sessionId);

  if (usePostgres()) {
    const imported = await readImportedPg(sid);
    const iw = imported.find(w => w.id === walletId);
    if (iw) {
      if (iw.status !== 'active') throw new Error(`Wallet ${walletId} is ${iw.status}, cannot assign`);
      await updateWalletPg(sid, walletId, { launchId });
      const keypair = Keypair.fromSecretKey(bs58.decode(iw.privateKey));
      return { wallet: { ...iw, launchId }, keypair };
    }

    const wallets = await readAllPg(sid);
    const w = wallets.find(x => x.id === walletId);
    if (!w) throw new Error(`Wallet ${walletId} not found`);
    if (w.status !== 'active') throw new Error(`Wallet ${walletId} is ${w.status}, cannot assign`);
    await updateWalletPg(sid, walletId, { launchId });
    const keypair = Keypair.fromSecretKey(bs58.decode(w.privateKey));
    return { wallet: { ...w, launchId }, keypair };
  }

  const imported = readImportedFile();
  const iw = imported.find(w => w.id === walletId);
  if (iw) {
    if (iw.status !== 'active') throw new Error(`Wallet ${walletId} is ${iw.status}, cannot assign`);
    iw.launchId = launchId;
    writeImportedFile(imported);
    const keypair = Keypair.fromSecretKey(bs58.decode(iw.privateKey));
    return { wallet: iw, keypair };
  }

  const wallets = readAllFile();
  const w = wallets.find(x => x.id === walletId);
  if (!w) throw new Error(`Wallet ${walletId} not found`);
  if (w.status !== 'active') throw new Error(`Wallet ${walletId} is ${w.status}, cannot assign`);
  w.launchId = launchId;
  writeAllFile(wallets);
  const keypair = Keypair.fromSecretKey(bs58.decode(w.privateKey));
  return { wallet: w, keypair };
}

export async function listAvailable(sessionId?: string): Promise<StoredWallet[]> {
  const sid = requireSession(sessionId);
  if (usePostgres()) {
    const launch = (await readAllPg(sid)).filter(w => w.status === 'active' && !w.launchId && w.type !== 'funding' && w.type !== 'mint');
    const imported = (await readImportedPg(sid)).filter(w => w.status === 'active' && !w.launchId);
    return [...imported, ...launch];
  }
  const launch = readAllFile().filter(w => w.status === 'active' && !w.launchId && w.type !== 'funding' && w.type !== 'mint');
  const imported = readImportedFile().filter(w => w.status === 'active' && !w.launchId);
  return [...imported, ...launch];
}

export async function getKeypair(walletId: string, sessionId?: string): Promise<Keypair> {
  const sid = requireSession(sessionId);
  let w: StoredWallet | null;
  if (usePostgres()) {
    w = await getWalletByIdPg(sid, walletId);
  } else {
    const iw = readImportedFile().find(x => x.id === walletId);
    if (iw) {
      return Keypair.fromSecretKey(bs58.decode(iw.privateKey));
    }
    w = readAllFile().find(x => x.id === walletId) ?? null;
  }
  if (!w) throw new Error(`Wallet ${walletId} not found`);
  return Keypair.fromSecretKey(bs58.decode(w.privateKey));
}

export async function getKeypairByPublicKey(pubkey: string, sessionId?: string): Promise<Keypair> {
  const sid = requireSession(sessionId);
  if (usePostgres()) {
    const pool = getPool();
    if (!pool) throw new Error('No pool');
    const r = await pool.query(
      `SELECT private_key FROM vault_wallets WHERE session_id = $1 AND public_key = $2`,
      [sid, pubkey],
    );
    const row = r.rows[0];
    if (!row) throw new Error(`Wallet with pubkey ${pubkey} not found`);
    return Keypair.fromSecretKey(bs58.decode(row.private_key));
  }
  const iw = readImportedFile().find(w => w.publicKey === pubkey);
  if (iw) return Keypair.fromSecretKey(bs58.decode(iw.privateKey));
  const wallets = readAllFile();
  const w = wallets.find(x => x.publicKey === pubkey);
  if (!w) throw new Error(`Wallet with pubkey ${pubkey} not found`);
  return Keypair.fromSecretKey(bs58.decode(w.privateKey));
}

export async function getPrivateKey(walletId: string, sessionId?: string): Promise<string> {
  const sid = requireSession(sessionId);
  let w: StoredWallet | null;
  if (usePostgres()) {
    w = await getWalletByIdPg(sid, walletId);
  } else {
    const iw = readImportedFile().find(x => x.id === walletId);
    if (iw) return iw.privateKey;
    w = readAllFile().find(x => x.id === walletId) ?? null;
  }
  if (!w) throw new Error(`Wallet ${walletId} not found`);
  return w.privateKey;
}

export async function listWallets(
  filter?: { type?: string; status?: string },
  sessionId?: string,
): Promise<StoredWallet[]> {
  const sid = requireSession(sessionId);
  let wallets: StoredWallet[];
  if (usePostgres()) {
    wallets = await readAllPg(sid);
    const imported = await readImportedPg(sid);
    wallets = [...wallets, ...imported];
  } else {
    wallets = [...readAllFile(), ...readImportedFile()];
  }
  if (filter?.type) wallets = wallets.filter(w => w.type === filter.type);
  if (filter?.status) wallets = wallets.filter(w => w.status === filter.status);
  return wallets;
}

export async function archiveWallet(walletId: string, sessionId?: string): Promise<StoredWallet | null> {
  const sid = requireSession(sessionId);
  if (usePostgres()) {
    const w = await getWalletByIdPg(sid, walletId);
    if (!w) return null;
    await updateWalletPg(sid, walletId, { status: 'archived' });
    return { ...w, status: 'archived' };
  }

  const wallets = readAllFile();
  const idx = wallets.findIndex(w => w.id === walletId);
  if (idx === -1) return null;
  wallets[idx].status = 'archived';
  writeAllFile(wallets);
  return wallets[idx];
}

export async function unarchiveWallet(walletId: string, sessionId?: string): Promise<StoredWallet | null> {
  const sid = requireSession(sessionId);
  if (usePostgres()) {
    const w = await getWalletByIdPg(sid, walletId);
    if (!w) return null;
    await updateWalletPg(sid, walletId, { status: 'active' });
    return { ...w, status: 'active' };
  }

  const wallets = readAllFile();
  const idx = wallets.findIndex(w => w.id === walletId);
  if (idx === -1) return null;
  wallets[idx].status = 'active';
  writeAllFile(wallets);
  return wallets[idx];
}

export async function generateBatch(
  count: number,
  type: StoredWallet['type'],
  labelPrefix: string,
  launchId?: string,
  sessionId?: string,
): Promise<{ wallet: StoredWallet; keypair: Keypair }[]> {
  const results: { wallet: StoredWallet; keypair: Keypair }[] = [];
  for (let i = 0; i < count; i++) {
    results.push(await generateAndStore(type, `${labelPrefix} ${i + 1}`, launchId, sessionId));
  }
  return results;
}
