import { Router, Request, Response } from 'express';
import { fundingMiddleware, FundingRequest } from '../middleware/funding';
import {
  PublicKey, LAMPORTS_PER_SOL, SystemProgram,
  TransactionMessage, VersionedTransaction,
} from '@solana/web3.js';
import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import BN from 'bn.js';
import { OnlinePumpSdk } from '@pump-fun/pump-sdk';
import * as vault from '../services/vault';
import * as solana from '../services/solana';
import * as pumpfun from '../services/pumpfun';
import { tracker, FormattedTrade } from '../services/pumpportal';
import fs from 'fs';
import path from 'path';

function buildLiveTrade(opts: {
  signature: string;
  mint: string;
  type: 'buy' | 'sell';
  trader: string;
  solAmount: number;
  tokenAmount: number;
  walletType: string | null;
  walletLabel: string | null;
}): FormattedTrade {
  return {
    signature: opts.signature,
    mint: opts.mint,
    type: opts.type,
    trader: opts.trader,
    traderShort: opts.trader ? `${opts.trader.slice(0, 4)}...${opts.trader.slice(-4)}` : '???',
    solAmount: opts.solAmount,
    tokenAmount: opts.tokenAmount,
    marketCapSol: null,
    timestamp: Date.now(),
    isOurWallet: true,
    walletType: opts.walletType,
    walletLabel: opts.walletLabel,
    pool: null,
  };
}

const router = Router();

// pump-swap-sdk logs noisy console.warn for TokenAccountNotFound — suppress it
function suppressSdkWarns<T>(fn: () => Promise<T>): Promise<T> {
  const orig = console.warn;
  console.warn = (...args: unknown[]) => {
    if (String(args[0] || '').includes('Error fetching token account')) return;
    orig.apply(console, args);
  };
  return fn().finally(() => { console.warn = orig; });
}

async function waitForSignatureConfirmation(
  conn: ReturnType<typeof solana.getConnection>,
  signature: string,
  timeoutMs = 45_000,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const status = (await conn.getSignatureStatuses([signature])).value[0];
    if (status?.err) throw new Error(`Transaction failed: ${JSON.stringify(status.err)}`);
    if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') {
      return true;
    }
    await new Promise(r => setTimeout(r, 1500));
  }
  return false;
}

interface TradeRecord {
  id: string;
  type: 'buy' | 'sell';
  mint: string;
  walletId: string;
  amount: number;
  signature?: string;
  status: 'pending' | 'confirmed' | 'error';
  error?: string;
  createdAt: string;
}

const TRADES_FILE = path.join(__dirname, '../../data/trades.json');

function readTrades(): TradeRecord[] {
  if (!fs.existsSync(TRADES_FILE)) return [];
  return JSON.parse(fs.readFileSync(TRADES_FILE, 'utf8') || '[]');
}

function writeTrades(trades: TradeRecord[]) {
  fs.writeFileSync(TRADES_FILE, JSON.stringify(trades, null, 2));
}

router.get('/history', (_req: Request, res: Response) => {
  const trades = readTrades();
  res.json(trades.slice(-100).reverse());
});

router.post('/execute', async (req: Request, res: Response) => {
  const { type, mint, walletId, amount, slippage = 5 } = req.body;

  if (!type || !mint || !walletId || !amount) {
    return res.status(400).json({ error: 'type, mint, walletId, amount required' });
  }

  const trade: TradeRecord = {
    id: crypto.randomUUID(),
    type,
    mint,
    walletId,
    amount: Number(amount),
    status: 'pending',
    createdAt: new Date().toISOString(),
  };

  try {
    const keypair = vault.getKeypair(walletId);
    const mintPubkey = new PublicKey(mint);
    const sessionId = (req.headers['x-session-id'] as string)?.trim();
    const conn = await solana.getConnectionForSession(sessionId);
    const { blockhash } = await conn.getLatestBlockhash('confirmed');

    let instructions;
    if (type === 'buy') {
      instructions = await pumpfun.buildBuyIxs({
        mint: mintPubkey,
        buyer: keypair.publicKey,
        solAmount: Number(amount),
      });
    } else {
      const tokenAmount = new BN(Math.round(Number(amount) * 1e6));
      const sellResult = await pumpfun.buildSellIxs({
        mint: mintPubkey,
        seller: keypair.publicKey,
        tokenAmount,
      });
      instructions = sellResult.instructions;
    }

    const tx = pumpfun.buildVersionedTx(keypair.publicKey, instructions, blockhash);
    tx.sign([keypair]);

    const sig = await conn.sendTransaction(tx, { skipPreflight: true });
    await solana.confirmTransactionPolling(conn, sig);

    trade.signature = sig;
    trade.status = 'confirmed';

    const trades = readTrades();
    trades.push(trade);
    writeTrades(trades);

    const walletInfo = vault.listWallets({}).find(w => w.id === walletId);
    tracker.injectTrade(buildLiveTrade({
      signature: sig,
      mint,
      type,
      trader: keypair.publicKey.toBase58(),
      solAmount: Number(amount),
      tokenAmount: type === 'sell' ? Number(amount) : 0,
      walletType: walletInfo?.type || null,
      walletLabel: walletInfo?.label || null,
    }));

    res.json(trade);
  } catch (err: any) {
    trade.status = 'error';
    trade.error = err.message;

    const trades = readTrades();
    trades.push(trade);
    writeTrades(trades);

    res.status(500).json(trade);
  }
});

router.post('/rapid-sell', async (req: Request, res: Response) => {
  const { mint, percentage = 100, launchId, parallel = true, walletIds, walletTypes } = req.body;

  if (!mint) return res.status(400).json({ error: 'mint required' });

  const pct = Math.max(1, Math.min(100, Number(percentage) || 100));

  let allWallets: vault.StoredWallet[];
  if (walletIds && Array.isArray(walletIds) && walletIds.length > 0) {
    const all = vault.listWallets({ status: 'active' });
    allWallets = all.filter(w => walletIds.includes(w.id));
  } else if (walletTypes && Array.isArray(walletTypes) && walletTypes.length > 0) {
    allWallets = [];
    for (const t of walletTypes) {
      allWallets.push(...vault.listWallets({ type: t, status: 'active' }));
    }
    if (launchId) {
      allWallets = allWallets.filter(w => w.launchId === String(launchId));
    }
  } else {
    const wallets = vault.listWallets({ type: 'bundle', status: 'active' });
    const devWallets = vault.listWallets({ type: 'dev', status: 'active' });
    const sniperWallets = vault.listWallets({ type: 'sniper', status: 'active' });
    allWallets = [...devWallets, ...wallets, ...sniperWallets];
    if (launchId) {
      allWallets = allWallets.filter(w => w.launchId === String(launchId));
    }
  }
  const mintPubkey = new PublicKey(mint);
  const sessionId = (req.headers['x-session-id'] as string)?.trim();
  const conn = await solana.getConnectionForSession(sessionId);

  const processWallet = async (w: vault.StoredWallet) => {
    try {
      const keypair = vault.getKeypair(w.id);
      const ata2022 = getAssociatedTokenAddressSync(
        mintPubkey,
        keypair.publicKey,
        true,
        TOKEN_2022_PROGRAM_ID,
      );
      const ataLegacy = getAssociatedTokenAddressSync(
        mintPubkey,
        keypair.publicKey,
        true,
        TOKEN_PROGRAM_ID,
      );

      const ataInfo2022 = await conn.getAccountInfo(ata2022);
      const ataInfoLegacy = ataInfo2022 ? null : await conn.getAccountInfo(ataLegacy);
      const ata = ataInfo2022 ? ata2022 : (ataInfoLegacy ? ataLegacy : null);

      if (!ata) {
        return { wallet: w.publicKey, status: 'skipped', reason: 'no token account' };
      }

      let balance;
      try {
        balance = await conn.getTokenAccountBalance(ata);
      } catch {
        return { wallet: w.publicKey, status: 'skipped', reason: 'token account closed or not found' };
      }
      const tokenBalance = balance.value.amount;

      if (tokenBalance === '0') {
        return { wallet: w.publicKey, status: 'skipped', reason: 'zero balance' };
      }

      const sellAmount = new BN(tokenBalance).muln(pct).divn(100);
      if (sellAmount.lten(0)) {
        return { wallet: w.publicKey, status: 'skipped', reason: 'sell amount is zero' };
      }

      const { instructions, solAmount: expectedSolOut } = await pumpfun.buildSellIxs({
        mint: mintPubkey,
        seller: keypair.publicKey,
        tokenAmount: sellAmount,
      });

      const { blockhash } = await conn.getLatestBlockhash('confirmed');
      const tx = pumpfun.buildVersionedTx(keypair.publicKey, instructions, blockhash);
      tx.sign([keypair]);

      const sig = await conn.sendTransaction(tx, { skipPreflight: true });

      tracker.injectTrade(buildLiveTrade({
        signature: sig,
        mint,
        type: 'sell',
        trader: keypair.publicKey.toBase58(),
        solAmount: expectedSolOut.toNumber() / 1e9,
        tokenAmount: Number(sellAmount.toString()) / 1e6,
        walletType: w.type,
        walletLabel: w.label,
      }));

      const confirmed = await waitForSignatureConfirmation(conn, sig, 45_000);
      if (confirmed) {
        return { wallet: w.publicKey, status: 'confirmed', signature: sig, soldRaw: sellAmount.toString() };
      }
      return { wallet: w.publicKey, status: 'sent', signature: sig, soldRaw: sellAmount.toString() };
    } catch (err: any) {
      return { wallet: w.publicKey, status: 'error', error: err.message };
    }
  };

  const results = parallel
    ? await Promise.all(allWallets.map(w => processWallet(w)))
    : await (async () => {
        const seqResults: Awaited<ReturnType<typeof processWallet>>[] = [];
        for (const w of allWallets) {
          seqResults.push(await processWallet(w));
          await new Promise(r => setTimeout(r, 250));
        }
        return seqResults;
      })();

  const typedResults = results.filter(Boolean) as Array<{ wallet: string; status: string; signature?: string; soldRaw?: string; reason?: string; error?: string }>;

  const summary = {
    totalWallets: allWallets.length,
    confirmed: typedResults.filter(r => r.status === 'confirmed').length,
    sent: typedResults.filter(r => r.status === 'sent').length,
    skipped: typedResults.filter(r => r.status === 'skipped').length,
    errors: typedResults.filter(r => r.status === 'error').length,
  };

  res.json({ summary, results: typedResults });
});

/** Get unclaimed creator fees for a launch (read-only, no claim). */
router.get('/creator-fees-available', async (req: Request, res: Response) => {
  const launchId = req.query.launchId as string;
  if (!launchId) return res.status(400).json({ error: 'launchId required' });

  const devWallets = vault.listWallets({ type: 'dev' }).filter(w => w.launchId === String(launchId));
  if (devWallets.length === 0) {
    return res.status(404).json({ error: `No dev wallet found for launchId ${launchId}` });
  }

  const devWallet = devWallets.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
  const keypair = vault.getKeypair(devWallet.id);
  const sessionId = (req.headers['x-session-id'] as string)?.trim();
  const conn = await solana.getConnectionForSession(sessionId);
  const sdk = new OnlinePumpSdk(conn);

  const balance = await suppressSdkWarns(() => sdk.getCreatorVaultBalanceBothPrograms(keypair.publicKey));
  const availableSol = Number(balance.toString()) / LAMPORTS_PER_SOL;
  const devSolBalance = await conn.getBalance(keypair.publicKey);
  const devSol = devSolBalance / LAMPORTS_PER_SOL;

  return res.json({
    launchId,
    availableSol,
    availableLamports: balance.toString(),
    creator: keypair.publicKey.toBase58(),
    devSol,
  });
});

const FUND_AMOUNT_LAMPORTS = 1_500_000; // ~0.0015 SOL — covers rent-exemption + tx fee

router.post('/collect-creator-fees', fundingMiddleware, async (req: FundingRequest, res: Response) => {
  const { launchId } = req.body;
  if (!launchId) return res.status(400).json({ error: 'launchId required' });

  try {
    tracker.unsubscribeCurrentMint();

    const devWallets = vault.listWallets({ type: 'dev' }).filter(w => w.launchId === String(launchId));
    if (devWallets.length === 0) {
      return res.status(404).json({ error: `No dev wallet found for launchId ${launchId}` });
    }

    const devWallet = devWallets.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
    const keypair = vault.getKeypair(devWallet.id);
    const sessionId = (req.headers['x-session-id'] as string)?.trim();
    const conn = await solana.getConnectionForSession(sessionId);
    const sdk = new OnlinePumpSdk(conn);
    const fundingKp = solana.getFundingKeypair(req.fundingKeypair);
    let fundedFromFunding = false;

    const beforeVault = await suppressSdkWarns(() => sdk.getCreatorVaultBalanceBothPrograms(keypair.publicKey));
    if (beforeVault.lten(0)) {
      return res.json({
        status: 'skipped',
        reason: 'No creator fees available',
        creator: keypair.publicKey.toBase58(),
        launchId,
      });
    }

    const ixs = await sdk.collectCoinCreatorFeeInstructions(keypair.publicKey);
    if (!ixs.length) {
      return res.json({
        status: 'skipped',
        reason: 'No collect instructions available',
        creator: keypair.publicKey.toBase58(),
        launchId,
      });
    }

    // If dev wallet has no SOL, fund it from the funding wallet first
    const devBalance = await conn.getBalance(keypair.publicKey);
    if (devBalance < FUND_AMOUNT_LAMPORTS) {
      const fundAmount = FUND_AMOUNT_LAMPORTS - devBalance + TX_FEE_LAMPORTS;
      const { blockhash: bh } = await conn.getLatestBlockhash('confirmed');
      const fundMsg = new TransactionMessage({
        payerKey: fundingKp.publicKey,
        recentBlockhash: bh,
        instructions: [
          SystemProgram.transfer({
            fromPubkey: fundingKp.publicKey,
            toPubkey: keypair.publicKey,
            lamports: fundAmount,
          }),
        ],
      }).compileToV0Message();
      const fundTx = new VersionedTransaction(fundMsg);
      fundTx.sign([fundingKp]);
      const fundSig = await conn.sendTransaction(fundTx, { skipPreflight: true });
      const fundOk = await waitForSignatureConfirmation(conn, fundSig, 30_000);
      if (!fundOk) {
        return res.status(500).json({ status: 'error', error: 'Failed to fund dev wallet for fee collection' });
      }
      fundedFromFunding = true;
      console.log(`[CollectFees] Funded dev ${keypair.publicKey.toBase58().slice(0, 8)}... with ${fundAmount} lamports from funding`);
    }

    // Collect creator fees
    const { blockhash } = await conn.getLatestBlockhash('confirmed');
    const tx = pumpfun.buildVersionedTx(keypair.publicKey, ixs, blockhash);
    tx.sign([keypair]);

    const sig = await conn.sendTransaction(tx, { skipPreflight: true });
    const confirmed = await waitForSignatureConfirmation(conn, sig, 45_000);
    if (!confirmed) {
      return res.status(500).json({
        status: 'error',
        error: 'Creator fee collect tx not confirmed in time',
        signature: sig,
        creator: keypair.publicKey.toBase58(),
        launchId,
      });
    }

    const collectedSol = Number(beforeVault.toString()) / LAMPORTS_PER_SOL;

    // Sweep collected fees + any remaining SOL back to funding wallet
    let sweptSol = 0;
    let sweepSig: string | undefined;
    try {
      await new Promise(r => setTimeout(r, 1000));
      const devLamportsAfter = await conn.getBalance(keypair.publicKey);
      const sweepLamports = devLamportsAfter - TX_FEE_LAMPORTS;
      if (sweepLamports > 0) {
        const { blockhash: bh2 } = await conn.getLatestBlockhash('confirmed');
        const sweepMsg = new TransactionMessage({
          payerKey: keypair.publicKey,
          recentBlockhash: bh2,
          instructions: [
            SystemProgram.transfer({
              fromPubkey: keypair.publicKey,
              toPubkey: fundingKp.publicKey,
              lamports: sweepLamports,
            }),
          ],
        }).compileToV0Message();
        const sweepTx = new VersionedTransaction(sweepMsg);
        sweepTx.sign([keypair]);
        sweepSig = await conn.sendTransaction(sweepTx, { skipPreflight: true });
        sweptSol = sweepLamports / LAMPORTS_PER_SOL;
        console.log(`[CollectFees] Swept ${sweptSol.toFixed(6)} SOL → funding`);
      }
    } catch (err: unknown) {
      console.error('[CollectFees] Sweep failed:', err instanceof Error ? err.message : err);
    }

    res.json({
      status: 'confirmed',
      signature: sig,
      creator: keypair.publicKey.toBase58(),
      launchId,
      collectedSol,
      sweptSol,
      sweepSig,
      fundedFromFunding,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[CollectFees] Error:', msg);
    res.status(500).json({ status: 'error', error: msg, launchId });
  }
});

// ── Collect fees from all old launches ──────────────────────────

const LAUNCHES_FILE = path.join(__dirname, '../../data/launches.json');

interface LaunchRecord {
  id: string;
  tokenName: string;
  tokenSymbol: string;
  mintAddress?: string;
  imageUrl?: string;
  status: string;
  createdAt: string;
}

function readLaunches(): LaunchRecord[] {
  if (!fs.existsSync(LAUNCHES_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(LAUNCHES_FILE, 'utf8') || '[]'); } catch { return []; }
}

router.get('/all-unclaimed-fees', async (req: Request, res: Response) => {
  const launches = readLaunches().filter(l => l.status === 'confirmed' && l.mintAddress);
  const sessionId = (req.headers['x-session-id'] as string)?.trim();
  const conn = await solana.getConnectionForSession(sessionId);
  const sdk = new OnlinePumpSdk(conn);

  const results: {
    launchId: string;
    tokenName: string;
    tokenSymbol: string;
    mintAddress: string;
    creator: string;
    availableSol: number;
    createdAt: string;
  }[] = [];

  for (const launch of launches) {
    const devWallets = vault.listWallets({ type: 'dev' }).filter(w => w.launchId === launch.id);
    if (devWallets.length === 0) continue;

    const devWallet = devWallets.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
    try {
      const keypair = vault.getKeypair(devWallet.id);
      const balance = await suppressSdkWarns(() => sdk.getCreatorVaultBalanceBothPrograms(keypair.publicKey));
      const availableSol = Number(balance.toString()) / LAMPORTS_PER_SOL;
      results.push({
        launchId: launch.id,
        tokenName: launch.tokenName,
        tokenSymbol: launch.tokenSymbol,
        mintAddress: launch.mintAddress!,
        creator: keypair.publicKey.toBase58(),
        availableSol,
        createdAt: launch.createdAt,
      });
    } catch {
      // RPC fetch failed / rate limit — skip, don't spam logs
    }
    // Delay to avoid RPC rate limits (500ms between requests)
    await new Promise(r => setTimeout(r, 500));
  }

  res.json(results);
});

const TX_FEE_LAMPORTS = 5000;

router.post('/collect-all-fees', fundingMiddleware, async (req: FundingRequest, res: Response) => {
  const { launchIds } = req.body;
  if (!Array.isArray(launchIds) || launchIds.length === 0) {
    return res.status(400).json({ error: 'launchIds array required' });
  }

  const sessionId = (req.headers['x-session-id'] as string)?.trim();
  const conn = await solana.getConnectionForSession(sessionId);
  const sdk = new OnlinePumpSdk(conn);
  const fundingKp = solana.getFundingKeypair(req.fundingKeypair);

  const results: {
    launchId: string;
    status: string;
    collectedSol?: number;
    sweptSol?: number;
    signature?: string;
    sweepSig?: string;
    error?: string;
  }[] = [];

  for (const launchId of launchIds) {
    const devWallets = vault.listWallets({ type: 'dev' }).filter(w => w.launchId === String(launchId));
    if (devWallets.length === 0) {
      results.push({ launchId, status: 'skipped', error: 'No dev wallet found' });
      continue;
    }

    const devWallet = devWallets.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
    try {
      const keypair = vault.getKeypair(devWallet.id);

      // 1) Collect creator fees → goes to the dev wallet
      const vaultBal = await suppressSdkWarns(() => sdk.getCreatorVaultBalanceBothPrograms(keypair.publicKey));
      if (vaultBal.lten(0)) {
        results.push({ launchId, status: 'skipped', collectedSol: 0, error: 'No fees to collect' });
        continue;
      }

      const ixs = await sdk.collectCoinCreatorFeeInstructions(keypair.publicKey);
      if (!ixs.length) {
        results.push({ launchId, status: 'skipped', collectedSol: 0, error: 'No collect instructions' });
        continue;
      }

      // Fund dev wallet from funding if it can't pay for the collect tx
      const devBalance = await conn.getBalance(keypair.publicKey);
      if (devBalance < FUND_AMOUNT_LAMPORTS) {
        const fundAmount = FUND_AMOUNT_LAMPORTS - devBalance + TX_FEE_LAMPORTS;
        const { blockhash: fbh } = await conn.getLatestBlockhash('confirmed');
        const fundMsg = new TransactionMessage({
          payerKey: fundingKp.publicKey,
          recentBlockhash: fbh,
          instructions: [
            SystemProgram.transfer({
              fromPubkey: fundingKp.publicKey,
              toPubkey: keypair.publicKey,
              lamports: fundAmount,
            }),
          ],
        }).compileToV0Message();
        const fundTx = new VersionedTransaction(fundMsg);
        fundTx.sign([fundingKp]);
        const fundSig = await conn.sendTransaction(fundTx, { skipPreflight: true });
        const fundOk = await waitForSignatureConfirmation(conn, fundSig, 30_000);
        if (!fundOk) {
          results.push({ launchId, status: 'error', error: 'Failed to fund dev wallet' });
          continue;
        }
        console.log(`[CollectAll] Funded dev ${keypair.publicKey.toBase58().slice(0, 8)}... with ${fundAmount} lamports`);
      }

      const { blockhash } = await conn.getLatestBlockhash('confirmed');
      const collectTx = pumpfun.buildVersionedTx(keypair.publicKey, ixs, blockhash);
      collectTx.sign([keypair]);
      const collectSig = await conn.sendTransaction(collectTx, { skipPreflight: true });

      const collectConfirmed = await waitForSignatureConfirmation(conn, collectSig, 45_000);
      if (!collectConfirmed) {
        results.push({ launchId, status: 'error', signature: collectSig, error: 'Collect tx not confirmed' });
        continue;
      }

      const collectedSol = Number(vaultBal.toString()) / LAMPORTS_PER_SOL;
      console.log(`[CollectAll] ${launchId.slice(0, 8)}... collected ${collectedSol.toFixed(6)} SOL`);

      // 2) Sweep the dev wallet SOL → funding wallet
      await new Promise(r => setTimeout(r, 1000));
      const devLamports = await conn.getBalance(keypair.publicKey);
      const sendLamports = devLamports - TX_FEE_LAMPORTS;

      let sweptSol = 0;
      let sweepSig: string | undefined;
      if (sendLamports > 0) {
        const { blockhash: bh2 } = await conn.getLatestBlockhash('confirmed');
        const sweepMsg = new TransactionMessage({
          payerKey: keypair.publicKey,
          recentBlockhash: bh2,
          instructions: [
            SystemProgram.transfer({
              fromPubkey: keypair.publicKey,
              toPubkey: fundingKp.publicKey,
              lamports: sendLamports,
            }),
          ],
        }).compileToV0Message();

        const sweepTx = new VersionedTransaction(sweepMsg);
        sweepTx.sign([keypair]);
        sweepSig = await conn.sendTransaction(sweepTx, { skipPreflight: true });
        sweptSol = sendLamports / LAMPORTS_PER_SOL;
        console.log(`[CollectAll] ${launchId.slice(0, 8)}... swept ${sweptSol.toFixed(6)} SOL → funding`);
      }

      results.push({
        launchId,
        status: 'confirmed',
        collectedSol,
        sweptSol,
        signature: collectSig,
        sweepSig,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[CollectAll] ${launchId.slice(0, 8)}... failed:`, msg);
      results.push({ launchId, status: 'error', error: msg });
    }

    await new Promise(r => setTimeout(r, 300));
  }

  const totalCollected = results.reduce((s, r) => s + (r.collectedSol || 0), 0);
  const totalSwept = results.reduce((s, r) => s + (r.sweptSol || 0), 0);
  res.json({ totalCollected, totalSwept, results });
});

export default router;
