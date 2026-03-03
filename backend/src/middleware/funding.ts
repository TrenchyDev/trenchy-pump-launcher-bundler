import { Request, Response, NextFunction } from 'express';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import * as fundingStore from '../services/funding-store';

export interface FundingRequest extends Request {
  fundingKeypair?: Keypair;
  sessionId?: string;
}

export async function fundingMiddleware(req: FundingRequest, res: Response, next: NextFunction) {
  const keyFromHeader = (req.headers['x-funding-key'] as string)?.trim();
  const sessionIdFromHeader = (req.headers['x-session-id'] as string)?.trim();

  if (keyFromHeader) {
    try {
      req.fundingKeypair = Keypair.fromSecretKey(bs58.decode(keyFromHeader));
      req.sessionId = sessionIdFromHeader || undefined;
      return next();
    } catch {
      return res.status(400).json({ error: 'Invalid funding key' });
    }
  }

  if (sessionIdFromHeader) {
    const key = await fundingStore.getFundingKey(sessionIdFromHeader);
    if (key) {
      req.fundingKeypair = fundingStore.getFundingKeypairFromKey(key);
      req.sessionId = sessionIdFromHeader;
      return next();
    }
  }

  const envKey = process.env.FUNDING_PRIVATE_KEY;
  if (envKey && envKey !== 'YOUR_BASE58_PRIVATE_KEY_HERE') {
    try {
      req.fundingKeypair = Keypair.fromSecretKey(bs58.decode(envKey));
      return next();
    } catch {}
  }

  return res.status(401).json({ error: 'Funding wallet not configured. Enter your funding private key in Setup.' });
}
