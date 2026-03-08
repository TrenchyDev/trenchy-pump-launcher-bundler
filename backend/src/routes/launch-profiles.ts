import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { v4 as uuid } from 'uuid';

const PROFILES_FILE = path.join(__dirname, '../../data/launch-profiles.json');

export interface LaunchProfileForm {
  tokenName: string;
  tokenSymbol: string;
  description: string;
  imageUrl: string;
  website: string;
  twitter: string;
  telegram: string;
  devBuyAmount: number;
  bundleWalletCount: number;
  bundleSwapAmounts: number[];
  holderWalletCount: number;
  holderSwapAmounts: number[];
  holderAutoBuy: boolean;
  holderAutoBuyDelay: number;
  useJito: boolean;
  useLUT: boolean;
  strictBundle: boolean;
  mintAddressMode: 'random' | 'vanity';
  vanityMintPublicKey: string;
  devWalletId: string;
  bundleWalletIds: (string | null)[];
  holderWalletIds: (string | null)[];
}

export interface LaunchProfile {
  id: string;
  name: string;
  form: LaunchProfileForm;
  createdAt: string;
}

function readProfiles(): LaunchProfile[] {
  const dir = path.dirname(PROFILES_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(PROFILES_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(PROFILES_FILE, 'utf8') || '[]');
  } catch {
    return [];
  }
}

function writeProfiles(profiles: LaunchProfile[]) {
  const dir = path.dirname(PROFILES_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(PROFILES_FILE, JSON.stringify(profiles, null, 2));
}

function sanitizeForm(form: Record<string, unknown>): LaunchProfileForm {
  return {
    tokenName: String(form.tokenName ?? ''),
    tokenSymbol: String(form.tokenSymbol ?? ''),
    description: String(form.description ?? ''),
    imageUrl: String(form.imageUrl ?? ''),
    website: String(form.website ?? ''),
    twitter: String(form.twitter ?? ''),
    telegram: String(form.telegram ?? ''),
    devBuyAmount: Number(form.devBuyAmount) ?? 0.5,
    bundleWalletCount: Number(form.bundleWalletCount) ?? 0,
    bundleSwapAmounts: Array.isArray(form.bundleSwapAmounts) ? form.bundleSwapAmounts.map(Number) : [],
    holderWalletCount: Number(form.holderWalletCount) ?? 0,
    holderSwapAmounts: Array.isArray(form.holderSwapAmounts) ? form.holderSwapAmounts.map(Number) : [],
    holderAutoBuy: form.holderAutoBuy !== false,
    holderAutoBuyDelay: Number(form.holderAutoBuyDelay) ?? 0,
    useJito: form.useJito !== false,
    useLUT: Boolean(form.useLUT),
    strictBundle: form.strictBundle !== false,
    mintAddressMode: form.mintAddressMode === 'vanity' ? 'vanity' : 'random',
    vanityMintPublicKey: String(form.vanityMintPublicKey ?? ''),
    devWalletId: String(form.devWalletId ?? ''),
    bundleWalletIds: Array.isArray(form.bundleWalletIds) ? form.bundleWalletIds : [],
    holderWalletIds: Array.isArray(form.holderWalletIds) ? form.holderWalletIds : [],
  };
}

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  const profiles = readProfiles();
  res.json(profiles.map(p => ({ id: p.id, name: p.name, createdAt: p.createdAt, tokenName: p.form.tokenName, tokenSymbol: p.form.tokenSymbol })));
});

router.get('/:id', (req: Request, res: Response) => {
  const profiles = readProfiles();
  const p = profiles.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Profile not found' });
  res.json(p);
});

router.post('/', (req: Request, res: Response) => {
  const { name, form } = req.body;
  if (!name || typeof name !== 'string' || !form || typeof form !== 'object') {
    return res.status(400).json({ error: 'name and form required' });
  }
  const profiles = readProfiles();
  const profile: LaunchProfile = {
    id: uuid(),
    name: String(name).trim() || 'Untitled Profile',
    form: sanitizeForm(form),
    createdAt: new Date().toISOString(),
  };
  profiles.push(profile);
  writeProfiles(profiles);
  res.json(profile);
});

router.put('/:id', (req: Request, res: Response) => {
  const { name, form } = req.body;
  const profiles = readProfiles();
  const idx = profiles.findIndex(p => p.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'Profile not found' });
  if (name != null) profiles[idx].name = String(name).trim() || profiles[idx].name;
  if (form != null && typeof form === 'object') {
    profiles[idx].form = sanitizeForm(form);
  }
  writeProfiles(profiles);
  res.json(profiles[idx]);
});

router.delete('/:id', (req: Request, res: Response) => {
  const profiles = readProfiles();
  const idx = profiles.findIndex(p => p.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'Profile not found' });
  profiles.splice(idx, 1);
  writeProfiles(profiles);
  res.json({ deleted: true });
});

export default router;
