import { Router, Request, Response } from 'express';
import * as fundingStore from '../services/funding-store';

const router = Router();

router.post('/save', async (req: Request, res: Response) => {
  const { sessionId, privateKey } = req.body;
  if (!sessionId || typeof sessionId !== 'string') {
    return res.status(400).json({ error: 'sessionId required' });
  }
  if (!privateKey || typeof privateKey !== 'string') {
    return res.status(400).json({ error: 'privateKey required' });
  }
  try {
    await fundingStore.saveFundingKey(sessionId.trim(), privateKey);
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/status', async (req: Request, res: Response) => {
  const sessionId = (req.headers['x-session-id'] as string)?.trim();
  if (!sessionId) {
    return res.json({ configured: false });
  }
  const key = await fundingStore.getFundingKey(sessionId);
  if (!key) {
    return res.json({ configured: false });
  }
  try {
    const kp = fundingStore.getFundingKeypairFromKey(key);
    res.json({ configured: true, publicKey: kp.publicKey.toBase58() });
  } catch {
    res.json({ configured: false });
  }
});

router.delete('/', async (req: Request, res: Response) => {
  const sessionId = (req.headers['x-session-id'] as string)?.trim();
  if (sessionId) {
    await fundingStore.deleteFundingKey(sessionId);
  }
  res.json({ success: true });
});

export default router;
