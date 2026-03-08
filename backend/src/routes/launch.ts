import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import type { LaunchRecord, SSECallback } from '../types';
import { executeLaunch } from '../services/launch-executor';
import { fundingMiddleware, FundingRequest } from '../middleware/funding';
import fs from 'fs';
import path from 'path';

const router = Router();

const activeStreams = new Map<string, SSECallback[]>();

const LAUNCHES_FILE = path.join(__dirname, '../../data/launches.json');

function readLaunches(): LaunchRecord[] {
  if (!fs.existsSync(LAUNCHES_FILE)) return [];
  return JSON.parse(fs.readFileSync(LAUNCHES_FILE, 'utf8') || '[]');
}

function writeLaunches(launches: LaunchRecord[]) {
  fs.writeFileSync(LAUNCHES_FILE, JSON.stringify(launches, null, 2));
}

function saveLaunch(launch: LaunchRecord) {
  const launches = readLaunches();
  const idx = launches.findIndex(l => l.id === launch.id);
  if (idx >= 0) launches[idx] = launch;
  else launches.push(launch);
  writeLaunches(launches);
}

function emit(launchId: string, data: Record<string, unknown>) {
  const listeners = activeStreams.get(launchId) || [];
  for (const cb of listeners) cb(data as { stage: string; message: string; [k: string]: unknown });
}

// ── Routes ──

router.get('/', (_req: Request, res: Response) => {
  const launches = readLaunches();
  res.json(launches.slice(-50).reverse());
});

router.get('/:id', (req: Request, res: Response) => {
  const launches = readLaunches();
  const id = String(req.params.id);
  const launch = launches.find(l => l.id === id);
  if (!launch) return res.status(404).json({ error: 'Not found' });
  res.json(launch);
});

router.delete('/:id', (req: Request, res: Response) => {
  const id = String(req.params.id);
  const launches = readLaunches();
  const idx = launches.findIndex(l => l.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const removed = launches.splice(idx, 1)[0];
  writeLaunches(launches);
  res.json({ deleted: removed.id, tokenName: removed.tokenName });
});

router.get('/:id/stream', (req: Request, res: Response) => {
  const launchId = String(req.params.id);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  const callback: SSECallback = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  if (!activeStreams.has(launchId)) activeStreams.set(launchId, []);
  activeStreams.get(launchId)!.push(callback);

  req.on('close', () => {
    const arr = activeStreams.get(launchId) || [];
    const idx = arr.indexOf(callback);
    if (idx >= 0) arr.splice(idx, 1);
  });
});

router.post('/:id/relaunch', fundingMiddleware, async (req: FundingRequest, res: Response) => {
  const id = String(req.params.id);
  const launches = readLaunches();
  const source = launches.find(l => l.id === id);
  if (!source) return res.status(404).json({ error: 'Launch not found' });
  if (!source.params) {
    return res.status(400).json({
      error: 'Cannot relaunch: this launch was created before relaunch was available. Use the Launch page to create a new token.',
    });
  }

  const p = source.params;
  const launchId = uuid();
  const launch: LaunchRecord = {
    id: launchId,
    tokenName: p.tokenName,
    tokenSymbol: p.tokenSymbol,
    imageUrl: p.imageUrl || undefined,
    status: 'pending',
    createdAt: new Date().toISOString(),
    params: { ...p, mintAddressMode: 'random', vanityMintPublicKey: '' },
  };
  saveLaunch(launch);

  res.json({ launchId, status: 'pending' });

  const sessionId = (req.headers['x-session-id'] as string)?.trim();
  executeLaunch(launchId, {
    ...p,
    mintAddressMode: 'random',
    vanityMintPublicKey: '',
  }, { readLaunches, saveLaunch, emit }, req.fundingKeypair!, sessionId).catch(err => {
    console.error('[Launch] Relaunch fatal error:', err);
  });
});

router.post('/', fundingMiddleware, async (req: FundingRequest, res: Response) => {
  const {
    tokenName,
    tokenSymbol,
    description = '',
    imageUrl = '',
    website = '',
    twitter = '',
    telegram = '',
    devBuyAmount = 0.5,
    bundleWalletCount = 0,
    bundleSwapAmounts = [],
    holderWalletCount = 0,
    holderSwapAmounts = [],
    holderAutoBuy = false,
    holderAutoBuyDelay = 0,
    useJito = true,
    useLUT = false,
    strictBundle = true,
    mintAddressMode = 'random',
    vanityMintPublicKey = '',
    autoSellAfterLaunch = false,
    devWalletId,
    bundleWalletIds,
    holderWalletIds,
  } = req.body;

  if (!tokenName || !tokenSymbol) {
    return res.status(400).json({ error: 'tokenName and tokenSymbol required' });
  }

  const launchId = uuid();
  const params = {
    tokenName,
    tokenSymbol,
    description: description || '',
    imageUrl: imageUrl || '',
    website: website || '',
    twitter: twitter || '',
    telegram: telegram || '',
    devBuyAmount,
    bundleWalletCount,
    bundleSwapAmounts,
    holderWalletCount,
    holderSwapAmounts,
    holderAutoBuy,
    holderAutoBuyDelay,
    useJito,
    useLUT,
    strictBundle,
    autoSellAfterLaunch,
    mintAddressMode,
    vanityMintPublicKey: vanityMintPublicKey || '',
    devWalletId: devWalletId || undefined,
    bundleWalletIds: bundleWalletIds || undefined,
    holderWalletIds: holderWalletIds || undefined,
  };
  const launch: LaunchRecord = {
    id: launchId,
    tokenName,
    tokenSymbol,
    imageUrl: imageUrl || undefined,
    status: 'pending',
    createdAt: new Date().toISOString(),
    params,
  };
  saveLaunch(launch);

  res.json({ launchId, status: 'pending' });

  const sessionId = (req.headers['x-session-id'] as string)?.trim();
  executeLaunch(launchId, {
    tokenName,
    tokenSymbol,
    description,
    imageUrl,
    website,
    twitter,
    telegram,
    devBuyAmount,
    bundleWalletCount,
    bundleSwapAmounts,
    holderWalletCount,
    holderSwapAmounts,
    holderAutoBuy,
    holderAutoBuyDelay,
    useJito,
    useLUT,
    strictBundle,
    autoSellAfterLaunch,
    mintAddressMode,
    vanityMintPublicKey,
    devWalletId: devWalletId || undefined,
    bundleWalletIds: bundleWalletIds || undefined,
    holderWalletIds: holderWalletIds || undefined,
  }, { readLaunches, saveLaunch, emit }, req.fundingKeypair!, sessionId).catch(err => {
    console.error('[Launch] Fatal error:', err);
  });
});

export default router;
