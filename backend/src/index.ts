import dotenv from 'dotenv';
import path from 'path';
import { execSync } from 'child_process';

dotenv.config({ path: path.join(__dirname, '../.env') });

function killPort(port: number): void {
  if (process.platform !== 'win32') return; // Only on Windows
  try {
    const out = execSync(
      `(Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -ne 0 } | Select-Object -ExpandProperty OwningProcess -Unique)`,
      { shell: 'powershell.exe', encoding: 'utf8' }
    ).trim();
    if (out) {
      for (const pid of out.split(/\r?\n/).map(s => s.trim()).filter(Boolean)) {
        try { execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' }); } catch {}
      }
    }
  } catch {}
}

import express from 'express';
import cors from 'cors';
import fspath from 'path';
import fs from 'fs';
import { createServer } from 'http';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import './db';
import { initFundingStore } from './services/funding-store';
import { initSessionOverrides } from './services/session-overrides';
import fundingRoutes from './routes/funding';
import walletRoutes from './routes/wallets';
import launchRoutes from './routes/launch';
import launchProfilesRoutes from './routes/launch-profiles';
import tradingRoutes from './routes/trading';
import uploadRoutes from './routes/upload';
import liveTradesRoutes from './routes/live-trades';
import vanityRoutes from './routes/vanity';
import envRoutes from './routes/env';
import aiRoutes from './routes/ai';
import { sessionMiddleware } from './middleware/session';
import { initVaultStore } from './services/vault';

const app = express();
const PORT = Number(process.env.PORT) || 3001;
const MAX_PORT_RETRIES = 15;
const PORT_RETRY_DELAY_MS = 1000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(sessionMiddleware);

const uploadsDir = fspath.join(__dirname, '../data/uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/api/uploads', express.static(uploadsDir));

app.use('/api/funding', fundingRoutes);
app.use('/api/wallets', walletRoutes);
app.use('/api/launch', launchRoutes);
app.use('/api/launch-profiles', launchProfilesRoutes);
app.use('/api/trading', tradingRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/live-trades', liveTradesRoutes);
app.use('/api/vanity', vanityRoutes);
app.use('/api/env', envRoutes);
app.use('/api/ai', aiRoutes);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve frontend static files (production)
const publicDir = fspath.join(__dirname, '../public');
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(fspath.join(publicDir, 'index.html'));
  });
}

let activeServer: Server | null = null;

function shutdown() {
  if (!activeServer) return process.exit(0);
  console.log('[Backend] Shutting down...');
  activeServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('SIGHUP', shutdown);

function tryListen(attempt: number): void {
  const server = createServer(app);

  // Allow binding even when old sockets are still in TIME_WAIT
  server.on('listening', () => {
    activeServer = server;
    const addr = server.address() as AddressInfo | null;
    console.log(`[Backend] Running on http://localhost:${addr?.port ?? PORT}`);
  });

  server.on('error', (err: any) => {
    if (err?.code !== 'EADDRINUSE') throw err;

    if (attempt >= MAX_PORT_RETRIES) {
      console.error(`[Backend] Port ${PORT} still busy after ${MAX_PORT_RETRIES} retries. Run start.bat or: node kill-ports.js`);
      process.exit(1);
    }

    console.warn(`[Backend] Port ${PORT} busy, killing and retrying... (${attempt + 1}/${MAX_PORT_RETRIES})`);
    killPort(PORT);
    setTimeout(() => tryListen(attempt + 1), 1500);
  });

  killPort(PORT);
  server.listen({ port: PORT, exclusive: false });
}

(async () => {
  await initFundingStore().catch(err => {
    console.error('[Backend] FundingStore init failed:', err);
  });
  await initSessionOverrides().catch(err => {
    console.error('[Backend] SessionOverrides init failed:', err);
  });
  await initVaultStore().catch(err => {
    console.error('[Backend] Vault init failed:', err);
  });
  tryListen(0);
})();
