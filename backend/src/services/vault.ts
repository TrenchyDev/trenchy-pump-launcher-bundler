import { Keypair } from '@solana/web3.js';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import bs58 from 'bs58';

export interface StoredWallet {
  id: string;
  publicKey: string;
  encryptedKey: string;
  iv: string;
  type: 'funding' | 'dev' | 'bundle' | 'holder' | 'manual' | 'mint' | 'sniper';
  label: string;
  status: 'active' | 'archived';
  createdAt: string;
  launchId?: string;
}

const DATA_FILE = path.join(__dirname, '../../data/wallets.json');
const ALGO = 'aes-256-cbc';

function getEncKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY || 'default-key-change-me-32-chars!!';
  return crypto.createHash('sha256').update(raw).digest();
}

function encrypt(text: string): { encrypted: string; iv: string } {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGO, getEncKey(), iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return { encrypted, iv: iv.toString('hex') };
}

function decrypt(encrypted: string, iv: string): string {
  const decipher = crypto.createDecipheriv(ALGO, getEncKey(), Buffer.from(iv, 'hex'));
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

function readAll(): StoredWallet[] {
  if (!fs.existsSync(DATA_FILE)) return [];
  const raw = fs.readFileSync(DATA_FILE, 'utf8');
  const wallets = JSON.parse(raw || '[]') as StoredWallet[];

  // Backward-compat migration: legacy launch mint wallets were stored as "manual".
  let changed = false;
  for (const w of wallets) {
    if (w.type === 'manual' && w.launchId && w.label?.startsWith('Mint - ')) {
      w.type = 'mint';
      changed = true;
    }
  }
  if (changed) writeAll(wallets);

  return wallets;
}

function writeAll(wallets: StoredWallet[]) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(wallets, null, 2));
}

export function generateAndStore(
  type: StoredWallet['type'],
  label: string,
  launchId?: string,
): { wallet: StoredWallet; keypair: Keypair } {
  const keypair = Keypair.generate();
  const secretB58 = bs58.encode(keypair.secretKey);
  const { encrypted, iv } = encrypt(secretB58);

  const wallet: StoredWallet = {
    id: crypto.randomUUID(),
    publicKey: keypair.publicKey.toBase58(),
    encryptedKey: encrypted,
    iv,
    type,
    label,
    status: 'active',
    createdAt: new Date().toISOString(),
    launchId,
  };

  const wallets = readAll();
  wallets.push(wallet);
  writeAll(wallets);

  return { wallet, keypair };
}

export function importAndStore(
  keypair: Keypair,
  type: StoredWallet['type'],
  label: string,
  launchId?: string,
): StoredWallet {
  const secretB58 = bs58.encode(keypair.secretKey);
  const { encrypted, iv } = encrypt(secretB58);

  const wallet: StoredWallet = {
    id: crypto.randomUUID(),
    publicKey: keypair.publicKey.toBase58(),
    encryptedKey: encrypted,
    iv,
    type,
    label,
    status: 'active',
    createdAt: new Date().toISOString(),
    launchId,
  };

  const wallets = readAll();
  wallets.push(wallet);
  writeAll(wallets);

  return wallet;
}

export function importKey(
  privateKeyB58: string,
  type: StoredWallet['type'],
  label: string,
): StoredWallet {
  const keypair = Keypair.fromSecretKey(bs58.decode(privateKeyB58));
  const { encrypted, iv } = encrypt(privateKeyB58);

  const wallet: StoredWallet = {
    id: crypto.randomUUID(),
    publicKey: keypair.publicKey.toBase58(),
    encryptedKey: encrypted,
    iv,
    type,
    label,
    status: 'active',
    createdAt: new Date().toISOString(),
  };

  const wallets = readAll();
  wallets.push(wallet);
  writeAll(wallets);

  return wallet;
}

export function getKeypair(walletId: string): Keypair {
  const wallets = readAll();
  const w = wallets.find(w => w.id === walletId);
  if (!w) throw new Error(`Wallet ${walletId} not found`);
  const secretB58 = decrypt(w.encryptedKey, w.iv);
  return Keypair.fromSecretKey(bs58.decode(secretB58));
}

export function getKeypairByPublicKey(pubkey: string): Keypair {
  const wallets = readAll();
  const w = wallets.find(w => w.publicKey === pubkey);
  if (!w) throw new Error(`Wallet with pubkey ${pubkey} not found`);
  const secretB58 = decrypt(w.encryptedKey, w.iv);
  return Keypair.fromSecretKey(bs58.decode(secretB58));
}

export function getPrivateKey(walletId: string): string {
  const wallets = readAll();
  const w = wallets.find(w => w.id === walletId);
  if (!w) throw new Error(`Wallet ${walletId} not found`);
  return decrypt(w.encryptedKey, w.iv);
}

export function listWallets(filter?: { type?: string; status?: string }): StoredWallet[] {
  let wallets = readAll();
  if (filter?.type) wallets = wallets.filter(w => w.type === filter.type);
  if (filter?.status) wallets = wallets.filter(w => w.status === filter.status);
  return wallets;
}

export function archiveWallet(walletId: string): StoredWallet | null {
  const wallets = readAll();
  const idx = wallets.findIndex(w => w.id === walletId);
  if (idx === -1) return null;
  wallets[idx].status = 'archived';
  writeAll(wallets);
  return wallets[idx];
}

export function unarchiveWallet(walletId: string): StoredWallet | null {
  const wallets = readAll();
  const idx = wallets.findIndex(w => w.id === walletId);
  if (idx === -1) return null;
  wallets[idx].status = 'active';
  writeAll(wallets);
  return wallets[idx];
}

export function generateBatch(
  count: number,
  type: StoredWallet['type'],
  labelPrefix: string,
  launchId?: string,
): { wallet: StoredWallet; keypair: Keypair }[] {
  const results = [];
  for (let i = 0; i < count; i++) {
    results.push(generateAndStore(type, `${labelPrefix} ${i + 1}`, launchId));
  }
  return results;
}
