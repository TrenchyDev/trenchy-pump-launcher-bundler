import { Worker } from 'worker_threads';
import { Keypair } from '@solana/web3.js';
import fs from 'fs';
import path from 'path';
import os from 'os';
import bs58 from 'bs58';

const POOL_FILE = path.join(__dirname, '../../data/vanity-pool.json');
const WORKER_PATH = path.join(__dirname, 'vanity-worker.js');

export interface VanityAddress {
  publicKey: string;
  secretKey: string; // base58
  suffix: string;
  status: 'available' | 'used';
  createdAt: string;
  usedAt?: string;
}

function ensureDir() {
  const dir = path.dirname(POOL_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readPool(): VanityAddress[] {
  ensureDir();
  if (!fs.existsSync(POOL_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(POOL_FILE, 'utf8')); } catch { return []; }
}

function writePool(pool: VanityAddress[]) {
  ensureDir();
  fs.writeFileSync(POOL_FILE, JSON.stringify(pool, null, 2));
}

export function getPoolStatus(): { available: number; used: number; total: number; generating: boolean } {
  const pool = readPool();
  const available = pool.filter(a => a.status === 'available').length;
  const used = pool.filter(a => a.status === 'used').length;
  return { available, used, total: pool.length, generating: isGenerating() };
}

export function getNextAvailable(): VanityAddress | null {
  const pool = readPool();
  return pool.find(a => a.status === 'available') || null;
}

export function markUsed(publicKey: string) {
  const pool = readPool();
  const addr = pool.find(a => a.publicKey === publicKey);
  if (addr) {
    addr.status = 'used';
    addr.usedAt = new Date().toISOString();
    writePool(pool);
  }
}

export function getKeypairFromPool(publicKey: string): Keypair | null {
  const pool = readPool();
  const addr = pool.find(a => a.publicKey === publicKey);
  if (!addr) return null;
  return Keypair.fromSecretKey(bs58.decode(addr.secretKey));
}

let workers: Worker[] = [];
let generating = false;

export function isGenerating(): boolean {
  return generating;
}

export function startGenerator(suffix: string = 'pump'): { started: boolean; workerCount: number } {
  if (generating) return { started: false, workerCount: workers.length };

  const cpuCount = os.cpus().length;
  const workerCount = Math.max(1, Math.floor(cpuCount / 2));

  generating = true;

  for (let i = 0; i < workerCount; i++) {
    const worker = new Worker(WORKER_PATH, {
      workerData: { suffix, workerId: i },
    });

    worker.on('message', (msg: any) => {
      if (msg.success) {
        const kp = msg.keypair;
        const secretKey = bs58.encode(Buffer.from(kp.secretKey));
        const addr: VanityAddress = {
          publicKey: kp.publicKey,
          secretKey,
          suffix,
          status: 'available',
          createdAt: new Date().toISOString(),
        };

        const pool = readPool();
        if (!pool.some(a => a.publicKey === addr.publicKey)) {
          pool.push(addr);
          writePool(pool);
        }
        console.log(`[Vanity] Found: ${kp.publicKey} (worker ${msg.workerId}, pool size: ${pool.length})`);
      }
    });

    worker.on('error', (err) => {
      console.error(`[Vanity] Worker ${i} error:`, err.message);
    });

    worker.on('exit', (code) => {
      if (code !== 0 && generating) {
        console.warn(`[Vanity] Worker ${i} exited with code ${code}`);
      }
    });

    workers.push(worker);
  }

  console.log(`[Vanity] Started ${workerCount} worker(s) searching for *${suffix}`);
  return { started: true, workerCount };
}

export function stopGenerator(): { stopped: boolean } {
  if (!generating) return { stopped: false };

  generating = false;
  for (const w of workers) {
    try { w.terminate(); } catch {}
  }
  workers = [];
  console.log('[Vanity] Generator stopped');
  return { stopped: true };
}

export function getPool(): VanityAddress[] {
  return readPool();
}
