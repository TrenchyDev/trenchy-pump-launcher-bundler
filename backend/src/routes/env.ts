import { Router, Request } from 'express';
import db from '../db';

const router = Router();

const ENV_KEYS = [
  { key: 'RPC_ENDPOINT', label: 'RPC Endpoint', sensitive: false, required: true },
  { key: 'JITO_TIP_LAMPORTS', label: 'Jito Tip (lamports)', sensitive: false, required: true },
  { key: 'ENCRYPTION_KEY', label: 'Encryption Key', sensitive: true, required: true },
  { key: 'BIRDEYE_API_KEY', label: 'Birdeye API Key', sensitive: true, required: false },
];

function getEnvFromProcess(): Record<string, string> {
  const result: Record<string, string> = {};
  for (const { key } of ENV_KEYS) {
    const v = process.env[key];
    if (v) result[key] = v;
  }
  return result;
}

router.get('/', (_req: Request, res) => {
  try {
    const vars = getEnvFromProcess();
    const entries = ENV_KEYS.map(({ key, label, sensitive, required }) => ({
      key,
      label,
      value: vars[key] ?? '',
      sensitive,
      required,
      isSet: !!(vars[key]?.trim()),
    }));
    const missingRequired = entries.filter(e => e.required && !e.isSet).map(e => e.key);
    res.json({ entries, missingRequired });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/', (_req: Request, res) => {
  res.status(400).json({ error: 'Server config is in .env. Edit backend/.env and restart.' });
});

export default router;
