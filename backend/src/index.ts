import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.join(__dirname, '../../.env') });

import express from 'express';
import cors from 'cors';
import fspath from 'path';
import fs from 'fs';
import { createServer } from 'http';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import walletRoutes from './routes/wallets';
import launchRoutes from './routes/launch';
import tradingRoutes from './routes/trading';
import uploadRoutes from './routes/upload';
import liveTradesRoutes from './routes/live-trades';
import vanityRoutes from './routes/vanity';

const app = express();
const PORT = Number(process.env.PORT) || 3001;
const MAX_PORT_RETRIES = 15;
const PORT_RETRY_DELAY_MS = 1000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const uploadsDir = fspath.join(__dirname, '../data/uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/api/uploads', express.static(uploadsDir));

app.use('/api/wallets', walletRoutes);
app.use('/api/launch', launchRoutes);
app.use('/api/trading', tradingRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/live-trades', liveTradesRoutes);
app.use('/api/vanity', vanityRoutes);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

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
      console.error(`[Backend] Port ${PORT} still busy after ${MAX_PORT_RETRIES} retries. Exiting.`);
      process.exit(1);
    }

    console.warn(`[Backend] Port ${PORT} busy, retrying in ${PORT_RETRY_DELAY_MS}ms... (${attempt + 1}/${MAX_PORT_RETRIES})`);
    setTimeout(() => tryListen(attempt + 1), PORT_RETRY_DELAY_MS);
  });

  server.listen({ port: PORT, exclusive: false });
}

tryListen(0);
