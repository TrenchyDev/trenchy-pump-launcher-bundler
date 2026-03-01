import { Router } from 'express';
import * as vanity from '../services/vanity';

const router = Router();

router.get('/pool-status', (_req, res) => {
  try {
    res.json(vanity.getPoolStatus());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/next', (_req, res) => {
  try {
    const addr = vanity.getNextAvailable();
    res.json({ address: addr });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/start', (req, res) => {
  try {
    const suffix = req.body.suffix || 'pump';
    const result = vanity.startGenerator(suffix);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/stop', (_req, res) => {
  try {
    res.json(vanity.stopGenerator());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/pool', (_req, res) => {
  try {
    const pool = vanity.getPool();
    res.json({ addresses: pool });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
