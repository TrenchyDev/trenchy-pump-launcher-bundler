import { Router, Request, Response } from 'express';
import { tracker, FormattedTrade } from '../services/pumpportal';

const router = Router();

// Pre-subscribe to a mint (for vanity addresses or manual tracking before launch)
router.post('/presubscribe', (req: Request, res: Response) => {
  const { mint } = req.body;
  if (!mint || typeof mint !== 'string' || mint.length < 32) {
    return res.status(400).json({ error: 'valid mint address required' });
  }
  tracker.subscribe(mint);
  res.json({ status: 'subscribed', mint });
});

router.get('/', (req: Request, res: Response) => {
  const mint = String(req.query.mint || '');
  if (!mint) return res.status(400).json({ error: 'mint query param required' });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  tracker.subscribe(mint);

  // Small delay to let any cached trades arrive
  setTimeout(() => {
    const cached = tracker.getTrades();
    res.write(`data: ${JSON.stringify({ type: 'initial', trades: cached })}\n\n`);
  }, 500);

  const onTrade = (trade: FormattedTrade) => {
    try {
      res.write(`data: ${JSON.stringify({ type: 'trade', trade })}\n\n`);
    } catch {}
  };

  tracker.addListener(onTrade);

  req.on('close', () => {
    tracker.removeListener(onTrade);
  });
});

export default router;
