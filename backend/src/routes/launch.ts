import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { Keypair, PublicKey, LAMPORTS_PER_SOL, AddressLookupTableAccount, TransactionInstruction } from '@solana/web3.js';
import axios from 'axios';
import FormData from 'form-data';
import * as vault from '../services/vault';
import * as solana from '../services/solana';
import * as pumpfun from '../services/pumpfun';
import * as jito from '../services/jito';
import * as lut from '../services/lut';
import * as vanity from '../services/vanity';
import { tracker, FormattedTrade } from '../services/pumpportal';
import fs from 'fs';
import path from 'path';
import BN from 'bn.js';

const router = Router();

function createLaunchBuyTrade(
  mint: string,
  launchId: string,
  trader: string,
  walletType: string,
  walletLabel: string,
  solAmount: number,
  tokenAmount: number,
  sigSuffix: string,
  order: number,
  baseTimestamp: number,
): FormattedTrade {
  return {
    signature: `launch:${launchId}:${sigSuffix}`,
    mint,
    type: 'buy',
    trader,
    traderShort: trader ? `${trader.slice(0, 4)}...${trader.slice(-4)}` : '???',
    solAmount,
    tokenAmount,
    marketCapSol: null,
    timestamp: baseTimestamp - order,
    isOurWallet: true,
    walletType,
    walletLabel,
    pool: null,
  };
}

interface LaunchRecord {
  id: string;
  tokenName: string;
  tokenSymbol: string;
  mintAddress?: string;
  imageUrl?: string;
  status: 'pending' | 'running' | 'confirmed' | 'error';
  signature?: string;
  error?: string;
  createdAt: string;
}

type SSECallback = (data: { stage: string; message: string; [k: string]: any }) => void;
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

function emit(launchId: string, data: Record<string, any>) {
  const listeners = activeStreams.get(launchId) || [];
  for (const cb of listeners) cb(data as any);
}

async function runHolderAutoBuy(
  launchId: string,
  mintAddress: string,
  holderWallets: { keypair: Keypair; wallet: vault.StoredWallet }[],
  holderSwapAmounts: number[],
  holderAutoBuyDelay: number,
  conn: ReturnType<typeof solana.getConnection>,
  emitFn: (launchId: string, data: Record<string, any>) => void,
): Promise<void> {
  if (holderWallets.length === 0) return;
  const delayMs = Math.max(0, holderAutoBuyDelay * 1000);
  if (delayMs > 0) {
    emitFn(launchId, { stage: 'holder-delay', message: `Waiting ${holderAutoBuyDelay}s before holder auto-buy...` });
    await new Promise(r => setTimeout(r, delayMs));
  }
  const mintPubkey = new PublicKey(mintAddress);
  for (let i = 0; i < holderWallets.length; i++) {
    const solAmount = holderSwapAmounts[i] ?? 0.5;
    if (solAmount <= 0) continue;
    try {
      emitFn(launchId, { stage: 'holder-buy', message: `Holder ${i + 1} buying ${solAmount} SOL...` });
      const buyIxs = await pumpfun.buildBuyIxs({
        mint: mintPubkey,
        buyer: holderWallets[i].keypair.publicKey,
        solAmount,
      });
      const { blockhash } = await conn.getLatestBlockhash('confirmed');
      const buyTx = pumpfun.buildVersionedTx(holderWallets[i].keypair.publicKey, buyIxs, blockhash);
      buyTx.sign([holderWallets[i].keypair]);
      const sig = await conn.sendRawTransaction(buyTx.serialize(), { skipPreflight: true, maxRetries: 3 });
      emitFn(launchId, { stage: 'holder-buy', message: `Holder ${i + 1} bought (${sig.slice(0, 12)}...)` });
      await new Promise(r => setTimeout(r, 500));
    } catch (err: any) {
      emitFn(launchId, { stage: 'holder-buy', message: `Holder ${i + 1} failed: ${err.message}` });
    }
  }
  emitFn(launchId, { stage: 'holder-done', message: 'Holder auto-buy complete' });
}

async function waitForSignatureConfirmation(
  conn: ReturnType<typeof solana.getConnection>,
  signature: string,
  timeoutMs = 90_000,
  onProgress?: (msg: string) => void,
): Promise<boolean> {
  const start = Date.now();
  let lastProgressAt = 0;
  while (Date.now() - start < timeoutMs) {
    try {
      const status = (await conn.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
      if (status?.err) throw new Error(`Transaction failed: ${JSON.stringify(status.err)}`);
      if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') {
        return true;
      }
      const now = Date.now();
      if (onProgress && now - lastProgressAt > 10_000) {
        lastProgressAt = now;
        const elapsed = Math.round((now - start) / 1000);
        onProgress(`Still waiting for confirmation... (${elapsed}s, sig ${signature.slice(0, 8)}...)`);
      }
    } catch (err) {
      throw err;
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  return false;
}

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

router.post('/', async (req: Request, res: Response) => {
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
  } = req.body;

  if (!tokenName || !tokenSymbol) {
    return res.status(400).json({ error: 'tokenName and tokenSymbol required' });
  }

  const launchId = uuid();
  const launch: LaunchRecord = {
    id: launchId,
    tokenName,
    tokenSymbol,
    imageUrl: imageUrl || undefined,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  saveLaunch(launch);

  res.json({ launchId, status: 'pending' });

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
    mintAddressMode,
    vanityMintPublicKey,
  }).catch(err => {
    console.error('[Launch] Fatal error:', err);
  });
});

async function executeLaunch(
  launchId: string,
  params: {
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
    mintAddressMode: string;
    vanityMintPublicKey: string;
  },
) {
  const launch = readLaunches().find(l => l.id === launchId)!;
  launch.status = 'running';
  saveLaunch(launch);

  try {
    // 1. Resolve mint keypair (vanity pool, or random)
    let mintKp: Keypair;
    let mintWallet: vault.StoredWallet;

    if (params.mintAddressMode === 'vanity' && params.vanityMintPublicKey) {
      const poolKp = vanity.getKeypairFromPool(params.vanityMintPublicKey);
      if (!poolKp) throw new Error(`Vanity address ${params.vanityMintPublicKey} not found in pool`);
      emit(launchId, { stage: 'mint', message: `Using vanity mint: ${params.vanityMintPublicKey.slice(0, 8)}...${params.vanityMintPublicKey.slice(-4)}` });
      vanity.markUsed(params.vanityMintPublicKey);
      mintWallet = vault.importAndStore(poolKp, 'mint', `Mint (vanity) - ${params.tokenName}`, launchId);
      mintKp = poolKp;
    } else {
      emit(launchId, { stage: 'mint', message: 'Generating mint keypair...' });
      const result = vault.generateAndStore('mint', `Mint - ${params.tokenName}`, launchId);
      mintKp = result.keypair;
      mintWallet = result.wallet;
    }

    // 1b. Start PumpPortal tracking IMMEDIATELY so we capture the dev buy and all bundle buys
    const mintAddress = mintKp.publicKey.toBase58();
    tracker.subscribe(mintAddress);
    emit(launchId, { stage: 'tracking', message: `PumpPortal tracking started for ${mintAddress.slice(0, 8)}...` });

    // 2. Generate dev wallet
    emit(launchId, { stage: 'dev-wallet', message: 'Creating dev wallet...' });
    const { keypair: devKp, wallet: devWallet } = vault.generateAndStore(
      'dev',
      `Dev - ${params.tokenName}`,
      launchId,
    );

    // 3. Generate bundle wallets
    const bundleWallets: { keypair: Keypair; wallet: vault.StoredWallet }[] = [];
    if (params.bundleWalletCount > 0) {
      emit(launchId, {
        stage: 'bundle-wallets',
        message: `Generating ${params.bundleWalletCount} bundle wallets...`,
      });
      for (let i = 0; i < params.bundleWalletCount; i++) {
        bundleWallets.push(
          vault.generateAndStore('bundle', `Bundle ${i + 1} - ${params.tokenName}`, launchId),
        );
      }
    }

    // 3b. Generate holder wallets (funded at launch, buy manually or auto-buy after)
    const holderWallets: { keypair: Keypair; wallet: vault.StoredWallet }[] = [];
    if (params.holderWalletCount > 0) {
      emit(launchId, {
        stage: 'holder-wallets',
        message: `Generating ${params.holderWalletCount} holder wallets...`,
      });
      for (let i = 0; i < params.holderWalletCount; i++) {
        holderWallets.push(
          vault.generateAndStore('holder', `Holder ${i + 1} - ${params.tokenName}`, launchId),
        );
      }
    }

    // 4. Fund wallets
    emit(launchId, { stage: 'fund', message: 'Funding wallets...' });
    const fundingKp = solana.getFundingKeypair();

    const tipSol = (Number(process.env.JITO_TIP_LAMPORTS) || 5_000_000) / LAMPORTS_PER_SOL;
    const devExtra = params.useJito ? tipSol + 0.1 : 0.1;
    const devFundAmount = params.devBuyAmount + devExtra;
    await solana.transferSol(fundingKp, devKp.publicKey, devFundAmount);

    for (let i = 0; i < bundleWallets.length; i++) {
      await new Promise(r => setTimeout(r, 250)); // avoid RPC rate limits
      const bundleAmount = (params.bundleSwapAmounts[i] || 0.5) + 0.02;
      await solana.transferSol(fundingKp, bundleWallets[i].keypair.publicKey, bundleAmount);
    }

    for (let i = 0; i < holderWallets.length; i++) {
      await new Promise(r => setTimeout(r, 250));
      const holderAmount = (params.holderSwapAmounts[i] || 0.5) + 0.01;
      await solana.transferSol(fundingKp, holderWallets[i].keypair.publicKey, holderAmount);
    }

    // 5. Upload metadata to IPFS via pump.fun
    emit(launchId, { stage: 'metadata', message: 'Uploading metadata to IPFS...' });
    const metadataUri = await uploadMetadataToIpfs(params);

    // 6. (Optional) Create/load LUT for smaller transactions
    let lookupTables: AddressLookupTableAccount[] = [];
    if (params.useLUT && params.useJito) {
      emit(launchId, { stage: 'lut', message: 'Creating fresh Address Lookup Table for this launch...' });
      const allWalletPubkeys = [
        devKp.publicKey,
        ...bundleWallets.map(bw => bw.keypair.publicKey),
        ...holderWallets.map(hw => hw.keypair.publicKey),
      ];

      // Always create a fresh LUT per launch — reusing old LUTs causes "Invalid"
      // bundles because validators may not have the updated addresses propagated.
      const lutAddress = await lut.createLUT(fundingKp, msg => emit(launchId, { stage: 'lut', message: msg }));
      if (!lutAddress) throw new Error('LUT creation failed');

      emit(launchId, { stage: 'lut', message: 'Extending LUT with addresses...' });
      const extOk = await lut.extendLUT(
        lutAddress, fundingKp, mintKp.publicKey, devKp.publicKey,
        allWalletPubkeys,
        msg => emit(launchId, { stage: 'lut', message: msg }),
      );
      if (!extOk) throw new Error('LUT extension failed');

      // Wait extra time for LUT extension to propagate across validators
      emit(launchId, { stage: 'lut', message: 'Waiting for LUT propagation (10s)...' });
      await new Promise(r => setTimeout(r, 10_000));

      const lutAccount = await lut.loadLUT();
      if (lutAccount) {
        lookupTables = [lutAccount];
        emit(launchId, { stage: 'lut', message: 'LUT ready — transactions will be compressed' });
      }
    }

    // 7. Build transactions
    emit(launchId, { stage: 'build-txs', message: 'Building transactions...' });
    const conn = solana.getConnection();
    const { blockhash } = await conn.getLatestBlockhash('confirmed');

    // TX1: Create token + dev buy (NO tip here — it's too large with create instructions)
    const createAndBuyIxs = await pumpfun.buildCreateAndBuyIxs({
      mint: mintKp,
      creator: devKp.publicKey,
      name: params.tokenName,
      symbol: params.tokenSymbol,
      uri: metadataUri,
      devBuySol: params.devBuyAmount,
    });

    const buildJitoBundleTxs = async (currentBlockhash: string) => {
      const tipAccount = await jito.getRandomLiveTipAccount();
      console.log(`[Jito] Using tip account: ${tipAccount.toBase58()}, tip: ${tipSol} SOL`);

      // TX 0: Create token + dev buy (NO tip here — createV2 has too many accounts,
      // embedding the tip pushes the TX over the 1232-byte Solana limit without LUT)
      const createTxForBundle = pumpfun.buildVersionedTx(
        devKp.publicKey,
        createAndBuyIxs,
        currentBlockhash,
        lookupTables,
      );
      createTxForBundle.sign([devKp, mintKp]);

      const txs = [createTxForBundle];
      let cumulativeSol = params.devBuyAmount;

      // With LUT, batch up to 4 buys per TX (like old bundler) to support more wallets.
      // Without LUT, keep 1 buy per TX to stay under the 1232-byte Solana limit.
      const buysPerTx = lookupTables.length > 0 ? 4 : 1;
      console.log(`[Jito] Batching ${bundleWallets.length} wallet(s), ${buysPerTx} buy(s)/TX, LUT: ${lookupTables.length > 0 ? 'yes' : 'no'}`);

      // Build all buy instructions first (cumulative SOL must be sequential for bonding curve sim)
      const walletBuyData: { ixs: TransactionInstruction[]; kp: Keypair; solAmount: number; tokenAmount: BN }[] = [];
      for (let i = 0; i < bundleWallets.length; i++) {
        const buyAmount = params.bundleSwapAmounts[i] || 0.5;
        const fundedBalance = buyAmount + 0.02;
        const { instructions, tokenAmount } = await pumpfun.buildBundleBuyIxs({
          mint: mintKp.publicKey,
          buyer: bundleWallets[i].keypair.publicKey,
          creator: devKp.publicKey,
          solAmount: buyAmount,
          fundedBalance,
          cumulativeSolBought: cumulativeSol,
        });
        cumulativeSol += buyAmount;
        walletBuyData.push({ ixs: instructions, kp: bundleWallets[i].keypair, solAmount: buyAmount, tokenAmount });
      }

      // Chunk into batched TXs (Jito 5-TX limit: 1 create + up to 3 buy batches + 1 tip)
      for (let batchStart = 0; batchStart < walletBuyData.length; batchStart += buysPerTx) {
        if (txs.length >= 4) {
          console.warn(`[Jito] Jito 5-TX limit reached, ${walletBuyData.length - batchStart} wallet(s) won't fit in bundle`);
          break;
        }
        const batch = walletBuyData.slice(batchStart, batchStart + buysPerTx);
        const batchIxs = batch.flatMap(b => b.ixs);
        const batchSigners = batch.map(b => b.kp);
        const computeUnits = Math.max(600_000, batch.length * 500_000);

        const buyTx = pumpfun.buildVersionedTx(
          batchSigners[0].publicKey,
          batchIxs,
          currentBlockhash,
          lookupTables,
          computeUnits,
        );
        buyTx.sign(batchSigners);
        txs.push(buyTx);
      }

      // Last TX: Jito tip as a separate lightweight transaction (NO LUT).
      // This guarantees the tip account is a static writable key that Jito can detect.
      const tipIx = jito.buildTipInstruction(devKp.publicKey, undefined, tipAccount);
      const tipTx = pumpfun.buildVersionedTx(
        devKp.publicKey,
        [tipIx],
        currentBlockhash,
        [],
        200_000,
      );
      tipTx.sign([devKp]);
      txs.push(tipTx);

      // Log per-TX sizes for diagnostics
      for (let i = 0; i < txs.length; i++) {
        const raw = txs[i].serialize();
        console.log(`[Jito] TX ${i}: ${raw.length} bytes raw, ${txs[i].message.staticAccountKeys.length} static keys`);
      }

      return { txs, walletBuyData };
    };

    const createTx = pumpfun.buildVersionedTx(
      devKp.publicKey,
      createAndBuyIxs,
      blockhash,
      lookupTables,
    );
    createTx.sign([devKp, mintKp]);

    launch.mintAddress = mintKp.publicKey.toBase58();
    saveLaunch(launch);

    if (params.useJito) {
      const maxStrictAttempts = params.strictBundle ? 3 : 1;
      let lastBundleId = '';
      let lastSig = '';

      for (let attempt = 1; attempt <= maxStrictAttempts; attempt++) {
        const { blockhash: jitoHash } = await conn.getLatestBlockhash('confirmed');
        const { txs: bundleTxs, walletBuyData } = await buildJitoBundleTxs(jitoHash);

        // Simulate create TX and tip TX locally to catch obvious errors
        for (const [idx, label] of [[0, 'create+devBuy'], [bundleTxs.length - 1, 'tip']] as [number, string][]) {
          try {
            const simResult = await conn.simulateTransaction(bundleTxs[idx], {
              sigVerify: false,
              replaceRecentBlockhash: true,
            });
            if (simResult.value.err) {
              console.error(`[Launch] Simulation FAILED for ${label} tx:`, JSON.stringify(simResult.value.err));
              console.error(`[Launch] Logs:`, simResult.value.logs?.slice(-10));
              emit(launchId, {
                stage: 'warning',
                message: `${label} TX simulation error: ${JSON.stringify(simResult.value.err)}`,
              });
            } else {
              console.log(`[Launch] ${label} tx simulation OK, CU used: ${simResult.value.unitsConsumed}`);
            }
          } catch (simErr: any) {
            console.warn(`[Launch] ${label} simulation call failed: ${simErr.message}`);
          }
        }

        emit(launchId, {
          stage: 'submit',
          message: `Submitting Jito bundle (attempt ${attempt}/${maxStrictAttempts})...`,
        });
        const { bundleId, signature: firstTxSig } = await jito.submitBundle(bundleTxs, {
          // For strict retries in the same launch, don't wait cooldown with already-built txs.
          skipCooldown: attempt > 1,
        });
        lastBundleId = bundleId;
        lastSig = firstTxSig;

        if (bundleId === 'unknown') {
          if (params.strictBundle && attempt < maxStrictAttempts) {
            emit(launchId, {
              stage: 'confirming',
              message: `No endpoint accepted bundle on attempt ${attempt}. Retrying with fresh blockhash...`,
            });
            continue;
          }
          if (params.strictBundle) {
            throw new Error('Strict bundle enabled: no Jito endpoint accepted the bundle (no RPC fallback)');
          }
          emit(launchId, {
            stage: 'jito-fallback',
            message: 'Jito endpoints rate-limited, falling back to RPC...',
          });
          break;
        }

        emit(launchId, {
          stage: 'confirming',
          message: `Bundle submitted (${bundleId}). Confirming on-chain signature...`,
        });
        const inflightStart = Date.now();
        let inflightStatus: jito.InflightBundleStatus = 'Unknown';
        while (Date.now() - inflightStart < 45_000) {
          inflightStatus = await jito.getInflightBundleStatus(bundleId);
          if (inflightStatus === 'Landed' || inflightStatus === 'Failed' || inflightStatus === 'Invalid') break;
          await new Promise(r => setTimeout(r, 3000));
        }
        emit(launchId, {
          stage: 'confirming',
          message: `Jito inflight status: ${inflightStatus}`,
        });

        // ALWAYS check on-chain before deciding to retry — Jito's inflight
        // status can report "Invalid" even when the bundle actually landed.
        emit(launchId, {
          stage: 'confirming',
          message: 'Checking on-chain confirmation...',
        });
        const confirmTimeout = params.strictBundle ? 120_000 : 45_000;
        const chainConfirmed = await waitForSignatureConfirmation(
          conn,
          firstTxSig,
          confirmTimeout,
          msg => emit(launchId, { stage: 'confirming', message: msg }),
        );
        if (chainConfirmed) {
          launch.status = 'confirmed';
          launch.signature = firstTxSig;
          saveLaunch(launch);
          emit(launchId, {
            stage: 'done',
            message: 'Launch confirmed!',
            signature: firstTxSig,
            mint: mintKp.publicKey.toBase58(),
          });
          // Inject dev + bundle buys into live trades (Pump Portal often misses Jito bundle buys)
          try {
            const mintAddr = mintKp.publicKey.toBase58();
            const devWallet = vault.listWallets({ type: 'dev' }).find(w => w.launchId === launchId);
            const devLabel = devWallet?.label || 'Dev';
            const devTokenAmt = await pumpfun.getDevBuyTokenAmount(params.devBuyAmount);
            const now = Date.now();
            const launchTrades: FormattedTrade[] = [
              createLaunchBuyTrade(mintAddr, launchId, devKp.publicKey.toBase58(), 'dev', devLabel, params.devBuyAmount, devTokenAmt, 'dev', 0, now),
              ...walletBuyData.map((b, i) => {
                const w = vault.listWallets({}).find(x => x.publicKey === b.kp.publicKey.toBase58());
                return createLaunchBuyTrade(
                  mintAddr, launchId, b.kp.publicKey.toBase58(), 'bundle',
                  w?.label || `Bundle ${i + 1}`, b.solAmount, b.tokenAmount.toNumber(), `b${i + 1}`, i + 1, now,
                );
              }),
            ];
            tracker.injectLaunchBuys(mintAddr, launchTrades);
          } catch (injErr: any) {
            console.warn('[Launch] Failed to inject launch buys:', injErr?.message);
          }
          if (params.holderAutoBuy && holderWallets.length > 0) {
            await runHolderAutoBuy(
              launchId, mintKp.publicKey.toBase58(), holderWallets,
              params.holderSwapAmounts, params.holderAutoBuyDelay, conn, emit,
            );
          }
          return;
        }

        if (params.strictBundle && attempt < maxStrictAttempts) {
          emit(launchId, {
            stage: 'confirming',
            message: `Bundle accepted but not confirmed on attempt ${attempt}. Retrying bundle...`,
          });
          continue;
        }

        if (params.strictBundle) {
          throw new Error(`Strict bundle enabled: accepted but not confirmed in time (bundleId=${lastBundleId}, sig=${lastSig})`);
        }
        emit(launchId, {
          stage: 'jito-fallback',
          message: 'Bundle accepted but not confirmed in time, falling back to RPC...',
        });
        break;
      }

      // RPC fallback: rebuild all transactions with a fresh blockhash and send via RPC
      emit(launchId, { stage: 'submit', message: 'Rebuilding transactions with fresh blockhash for RPC...' });
      const { blockhash: freshHash } = await conn.getLatestBlockhash('confirmed');

      const freshCreateTx = pumpfun.buildVersionedTx(devKp.publicKey, createAndBuyIxs, freshHash, lookupTables);
      freshCreateTx.sign([devKp, mintKp]);

      const createSig = await conn.sendRawTransaction(freshCreateTx.serialize(), {
        skipPreflight: true,
        maxRetries: 5,
      });
      emit(launchId, { stage: 'confirming', message: `Create TX sent (${createSig.slice(0, 12)}...), confirming...` });
      const createConfirmed = await waitForSignatureConfirmation(
        conn, createSig, 60_000,
        msg => emit(launchId, { stage: 'confirming', message: msg }),
      );
      if (!createConfirmed) throw new Error('Create transaction not confirmed via RPC fallback');

      emit(launchId, { stage: 'confirming', message: 'Token created! Sending bundle buys via RPC...' });

      for (let i = 0; i < bundleWallets.length; i++) {
        try {
          const buyAmount = params.bundleSwapAmounts[i] || 0.5;
          const buyIxs = await pumpfun.buildBuyIxs({
            mint: mintKp.publicKey,
            buyer: bundleWallets[i].keypair.publicKey,
            solAmount: buyAmount,
          });
          const { blockhash: buyHash } = await conn.getLatestBlockhash('confirmed');
          const buyTx = pumpfun.buildVersionedTx(
            bundleWallets[i].keypair.publicKey, buyIxs, buyHash, lookupTables,
          );
          buyTx.sign([bundleWallets[i].keypair]);
          const buySig = await conn.sendRawTransaction(buyTx.serialize(), {
            skipPreflight: true,
            maxRetries: 3,
          });
          emit(launchId, { stage: 'confirming', message: `Bundle buy ${i + 1} sent (${buySig.slice(0, 12)}...)` });
        } catch (buyErr: any) {
          emit(launchId, { stage: 'warning', message: `Bundle buy ${i + 1} failed: ${buyErr.message}` });
        }
      }

      launch.status = 'confirmed';
      launch.signature = createSig;
      saveLaunch(launch);
      emit(launchId, {
        stage: 'done',
        message: 'Launch confirmed via RPC fallback!',
        signature: createSig,
        mint: mintKp.publicKey.toBase58(),
      });
      // Inject dev + bundle buys (RPC fallback — token amounts estimated as 0)
      try {
        const mintAddr = mintKp.publicKey.toBase58();
        const devWallet = vault.listWallets({ type: 'dev' }).find(w => w.launchId === launchId);
        const devLabel = devWallet?.label || 'Dev';
        const devTokenAmt = await pumpfun.getDevBuyTokenAmount(params.devBuyAmount);
        const now = Date.now();
        const launchTrades: FormattedTrade[] = [
          createLaunchBuyTrade(mintAddr, launchId, devKp.publicKey.toBase58(), 'dev', devLabel, params.devBuyAmount, devTokenAmt, 'dev', 0, now),
          ...bundleWallets.map((bw, i) => {
            const amt = params.bundleSwapAmounts[i] || 0.5;
            const w = vault.listWallets({}).find(x => x.publicKey === bw.keypair.publicKey.toBase58());
            return createLaunchBuyTrade(mintAddr, launchId, bw.keypair.publicKey.toBase58(), 'bundle', w?.label || `Bundle ${i + 1}`, amt, 0, `b${i + 1}`, i + 1, now);
          }),
        ];
        tracker.injectLaunchBuys(mintAddr, launchTrades);
      } catch (injErr: any) {
        console.warn('[Launch] Failed to inject launch buys:', injErr?.message);
      }
      if (params.holderAutoBuy && holderWallets.length > 0) {
        await runHolderAutoBuy(
          launchId, mintKp.publicKey.toBase58(), holderWallets,
          params.holderSwapAmounts, params.holderAutoBuyDelay, conn, emit,
        );
      }
    } else {
      // Non-Jito: just send the create TX
      emit(launchId, { stage: 'submit', message: 'Submitting transaction...' });
      const sig = await solana.executeTransaction(createTx, []);
      try {
        await conn.confirmTransaction(sig, 'confirmed');
      } catch (confirmErr: any) {
        if (String(confirmErr?.message || '').includes('unknown if it succeeded or failed')) {
          const rpcConfirmed = await waitForSignatureConfirmation(
            conn,
            sig,
            45_000,
            msg => emit(launchId, { stage: 'confirming', message: msg }),
          );
          if (!rpcConfirmed) throw confirmErr;
        } else {
          throw confirmErr;
        }
      }

      launch.status = 'confirmed';
      launch.signature = sig;
      saveLaunch(launch);

      emit(launchId, {
        stage: 'done',
        message: 'Launch confirmed!',
        signature: sig,
        mint: mintKp.publicKey.toBase58(),
      });
      // Non-Jito: no bundle buys in this path (create only)
      try {
        const mintAddr = mintKp.publicKey.toBase58();
        const devWallet = vault.listWallets({ type: 'dev' }).find(w => w.launchId === launchId);
        const devLabel = devWallet?.label || 'Dev';
        const devTokenAmt = await pumpfun.getDevBuyTokenAmount(params.devBuyAmount);
        tracker.injectLaunchBuys(mintAddr, [
          createLaunchBuyTrade(mintAddr, launchId, devKp.publicKey.toBase58(), 'dev', devLabel, params.devBuyAmount, devTokenAmt, 'dev', 0, Date.now()),
        ]);
      } catch (injErr: any) {
        console.warn('[Launch] Failed to inject launch buys:', injErr?.message);
      }
      if (params.holderAutoBuy && holderWallets.length > 0) {
        await runHolderAutoBuy(
          launchId, mintKp.publicKey.toBase58(), holderWallets,
          params.holderSwapAmounts, params.holderAutoBuyDelay, conn, emit,
        );
      }
    }
  } catch (err: any) {
    console.error('[Launch] Error:', err);
    launch.status = 'error';
    launch.error = err.message;
    saveLaunch(launch);

    emit(launchId, { stage: 'error', message: err.message });
  }
}

function getLocalImagePath(imageUrl: string): string | null {
  if (!imageUrl.startsWith('/api/uploads/')) return null;
  const filename = imageUrl.replace('/api/uploads/', '');
  const filePath = path.join(__dirname, '../../data/uploads', filename);
  return fs.existsSync(filePath) ? filePath : null;
}

async function uploadMetadataToIpfs(params: {
  tokenName: string;
  tokenSymbol: string;
  description: string;
  imageUrl: string;
  website: string;
  twitter: string;
  telegram: string;
}): Promise<string> {
  const form = new FormData();

  const localPath = getLocalImagePath(params.imageUrl);
  if (localPath) {
    form.append('file', fs.createReadStream(localPath));
  } else if (params.imageUrl && params.imageUrl.startsWith('http')) {
    try {
      const imgResp = await axios.get(params.imageUrl, { responseType: 'arraybuffer', timeout: 15000 });
      form.append('file', Buffer.from(imgResp.data), { filename: 'token.png', contentType: 'image/png' });
    } catch (e: any) {
      console.warn('[Launch] Could not fetch image URL, launching without image:', e.message);
    }
  }

  form.append('name', params.tokenName);
  form.append('symbol', params.tokenSymbol);
  form.append('description', params.description || '');
  form.append('showName', 'true');
  if (params.twitter) form.append('twitter', params.twitter);
  if (params.telegram) form.append('telegram', params.telegram);
  if (params.website) form.append('website', params.website);

  const resp = await axios.post('https://pump.fun/api/ipfs', form, {
    headers: form.getHeaders(),
    timeout: 30000,
  });

  const metadataUri = resp.data?.metadataUri;
  if (!metadataUri) throw new Error('pump.fun IPFS upload failed — no metadataUri returned');
  console.log('[Launch] Metadata uploaded to IPFS:', metadataUri);
  return metadataUri;
}

export default router;
