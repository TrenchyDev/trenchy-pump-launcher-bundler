import { Keypair, PublicKey, LAMPORTS_PER_SOL, AddressLookupTableAccount, TransactionInstruction } from '@solana/web3.js';
import axios from 'axios';
import FormData from 'form-data';
import * as vault from './vault';
import * as solana from './solana';
import * as pumpfun from './pumpfun';
import * as jito from './jito';
import * as lut from './lut';
import * as vanity from './vanity';
import { tracker, FormattedTrade } from './pumpportal';
import type { LaunchRecord, LaunchParams } from '../types';
import fs from 'fs';
import path from 'path';
import BN from 'bn.js';

type EmitFn = (launchId: string, data: Record<string, unknown>) => void;
type SaveFn = (launch: LaunchRecord) => void;
type ReadFn = () => LaunchRecord[];

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

async function runHolderAutoBuy(
  launchId: string,
  mintAddress: string,
  holderWallets: { keypair: Keypair; wallet: vault.StoredWallet }[],
  holderSwapAmounts: number[],
  holderAutoBuyDelay: number,
  conn: ReturnType<typeof solana.getConnection>,
  emitFn: EmitFn,
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
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      emitFn(launchId, { stage: 'holder-buy', message: `Holder ${i + 1} failed: ${msg}` });
    }
  }
  emitFn(launchId, { stage: 'holder-done', message: 'Holder auto-buy complete' });
}

export async function waitForSignatureConfirmation(
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

function getLocalImagePath(imageUrl: string): string | null {
  if (!imageUrl.startsWith('/api/uploads/')) return null;
  const filename = imageUrl.replace('/api/uploads/', '');
  const filePath = path.join(__dirname, '../../data/uploads', filename);
  return fs.existsSync(filePath) ? filePath : null;
}

export async function uploadMetadataToIpfs(params: {
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
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn('[Launch] Could not fetch image URL, launching without image:', msg);
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

interface ExecuteLaunchDeps {
  readLaunches: ReadFn;
  saveLaunch: SaveFn;
  emit: EmitFn;
}

export async function executeLaunch(
  launchId: string,
  params: LaunchParams & { mintAddressMode: string; vanityMintPublicKey: string },
  deps: ExecuteLaunchDeps,
) {
  const { readLaunches, saveLaunch, emit } = deps;
  const launch = readLaunches().find(l => l.id === launchId)!;
  launch.status = 'running';
  saveLaunch(launch);

  try {
    let mintKp: Keypair;

    if (params.mintAddressMode === 'vanity' && params.vanityMintPublicKey) {
      const poolKp = vanity.getKeypairFromPool(params.vanityMintPublicKey);
      if (!poolKp) throw new Error(`Vanity address ${params.vanityMintPublicKey} not found in pool`);
      emit(launchId, { stage: 'mint', message: `Using vanity mint: ${params.vanityMintPublicKey.slice(0, 8)}...${params.vanityMintPublicKey.slice(-4)}` });
      vanity.markUsed(params.vanityMintPublicKey);
      vault.importAndStore(poolKp, 'mint', `Mint (vanity) - ${params.tokenName}`, launchId);
      mintKp = poolKp;
    } else {
      emit(launchId, { stage: 'mint', message: 'Generating mint keypair...' });
      const result = vault.generateAndStore('mint', `Mint - ${params.tokenName}`, launchId);
      mintKp = result.keypair;
    }

    const mintAddress = mintKp.publicKey.toBase58();
    tracker.subscribe(mintAddress);
    emit(launchId, { stage: 'tracking', message: `PumpPortal tracking started for ${mintAddress.slice(0, 8)}...` });

    emit(launchId, { stage: 'dev-wallet', message: 'Creating dev wallet...' });
    const { keypair: devKp } = vault.generateAndStore('dev', `Dev - ${params.tokenName}`, launchId);

    const bundleWallets: { keypair: Keypair; wallet: vault.StoredWallet }[] = [];
    if (params.bundleWalletCount > 0) {
      emit(launchId, { stage: 'bundle-wallets', message: `Generating ${params.bundleWalletCount} bundle wallets...` });
      for (let i = 0; i < params.bundleWalletCount; i++) {
        bundleWallets.push(vault.generateAndStore('bundle', `Bundle ${i + 1} - ${params.tokenName}`, launchId));
      }
    }

    const holderWallets: { keypair: Keypair; wallet: vault.StoredWallet }[] = [];
    if (params.holderWalletCount > 0) {
      emit(launchId, { stage: 'holder-wallets', message: `Generating ${params.holderWalletCount} holder wallets...` });
      for (let i = 0; i < params.holderWalletCount; i++) {
        holderWallets.push(vault.generateAndStore('holder', `Holder ${i + 1} - ${params.tokenName}`, launchId));
      }
    }

    emit(launchId, { stage: 'fund', message: 'Funding wallets...' });
    const fundingKp = solana.getFundingKeypair();
    const tipSol = (Number(process.env.JITO_TIP_LAMPORTS) || 5_000_000) / LAMPORTS_PER_SOL;
    const devExtra = params.useJito ? tipSol + 0.1 : 0.1;
    const devFundAmount = params.devBuyAmount + devExtra;
    await solana.transferSol(fundingKp, devKp.publicKey, devFundAmount);

    for (let i = 0; i < bundleWallets.length; i++) {
      await new Promise(r => setTimeout(r, 250));
      const bundleAmount = (params.bundleSwapAmounts[i] || 0.5) + 0.02;
      await solana.transferSol(fundingKp, bundleWallets[i].keypair.publicKey, bundleAmount);
    }

    for (let i = 0; i < holderWallets.length; i++) {
      await new Promise(r => setTimeout(r, 250));
      const holderAmount = (params.holderSwapAmounts[i] || 0.5) + 0.01;
      await solana.transferSol(fundingKp, holderWallets[i].keypair.publicKey, holderAmount);
    }

    emit(launchId, { stage: 'metadata', message: 'Uploading metadata to IPFS...' });
    const metadataUri = await uploadMetadataToIpfs(params);

    let lookupTables: AddressLookupTableAccount[] = [];
    if (params.useLUT && params.useJito) {
      emit(launchId, { stage: 'lut', message: 'Creating fresh Address Lookup Table for this launch...' });
      const allWalletPubkeys = [
        devKp.publicKey,
        ...bundleWallets.map(bw => bw.keypair.publicKey),
        ...holderWallets.map(hw => hw.keypair.publicKey),
      ];

      const lutAddress = await lut.createLUT(fundingKp, msg => emit(launchId, { stage: 'lut', message: msg }));
      if (!lutAddress) throw new Error('LUT creation failed');

      emit(launchId, { stage: 'lut', message: 'Extending LUT with addresses...' });
      const extOk = await lut.extendLUT(
        lutAddress, fundingKp, mintKp.publicKey, devKp.publicKey,
        allWalletPubkeys,
        msg => emit(launchId, { stage: 'lut', message: msg }),
      );
      if (!extOk) throw new Error('LUT extension failed');

      emit(launchId, { stage: 'lut', message: 'Waiting for LUT propagation (10s)...' });
      await new Promise(r => setTimeout(r, 10_000));

      const lutAccount = await lut.loadLUT();
      if (lutAccount) {
        lookupTables = [lutAccount];
        emit(launchId, { stage: 'lut', message: 'LUT ready — transactions will be compressed' });
      }
    }

    emit(launchId, { stage: 'build-txs', message: 'Building transactions...' });
    const conn = solana.getConnection();
    const { blockhash } = await conn.getLatestBlockhash('confirmed');

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

      const createTxForBundle = pumpfun.buildVersionedTx(
        devKp.publicKey, createAndBuyIxs, currentBlockhash, lookupTables,
      );
      createTxForBundle.sign([devKp, mintKp]);

      const txs = [createTxForBundle];
      let cumulativeSol = params.devBuyAmount;

      const buysPerTx = lookupTables.length > 0 ? 4 : 1;
      console.log(`[Jito] Batching ${bundleWallets.length} wallet(s), ${buysPerTx} buy(s)/TX, LUT: ${lookupTables.length > 0 ? 'yes' : 'no'}`);

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
          batchSigners[0].publicKey, batchIxs, currentBlockhash, lookupTables, computeUnits,
        );
        buyTx.sign(batchSigners);
        txs.push(buyTx);
      }

      const tipIx = jito.buildTipInstruction(devKp.publicKey, undefined, tipAccount);
      const tipTx = pumpfun.buildVersionedTx(devKp.publicKey, [tipIx], currentBlockhash, [], 200_000);
      tipTx.sign([devKp]);
      txs.push(tipTx);

      for (let i = 0; i < txs.length; i++) {
        const raw = txs[i].serialize();
        console.log(`[Jito] TX ${i}: ${raw.length} bytes raw, ${txs[i].message.staticAccountKeys.length} static keys`);
      }

      return { txs, walletBuyData };
    };

    const createTx = pumpfun.buildVersionedTx(devKp.publicKey, createAndBuyIxs, blockhash, lookupTables);
    createTx.sign([devKp, mintKp]);

    launch.mintAddress = mintKp.publicKey.toBase58();
    saveLaunch(launch);

    const injectLaunchTrades = async (walletBuyData?: { kp: Keypair; solAmount: number; tokenAmount: BN }[]) => {
      try {
        const mintAddr = mintKp.publicKey.toBase58();
        const devW = vault.listWallets({ type: 'dev' }).find(w => w.launchId === launchId);
        const devLabel = devW?.label || 'Dev';
        const devTokenAmt = await pumpfun.getDevBuyTokenAmount(params.devBuyAmount);
        const now = Date.now();
        const trades: FormattedTrade[] = [
          createLaunchBuyTrade(mintAddr, launchId, devKp.publicKey.toBase58(), 'dev', devLabel, params.devBuyAmount, devTokenAmt, 'dev', 0, now),
        ];
        if (walletBuyData) {
          walletBuyData.forEach((b, i) => {
            const w = vault.listWallets({}).find(x => x.publicKey === b.kp.publicKey.toBase58());
            trades.push(createLaunchBuyTrade(
              mintAddr, launchId, b.kp.publicKey.toBase58(), 'bundle',
              w?.label || `Bundle ${i + 1}`, b.solAmount, b.tokenAmount.toNumber(), `b${i + 1}`, i + 1, now,
            ));
          });
        }
        tracker.injectLaunchBuys(mintAddr, trades);
      } catch (injErr: unknown) {
        const msg = injErr instanceof Error ? injErr.message : String(injErr);
        console.warn('[Launch] Failed to inject launch buys:', msg);
      }
    };

    const maybeHolderAutoBuy = async () => {
      if (params.holderAutoBuy && holderWallets.length > 0) {
        await runHolderAutoBuy(
          launchId, mintKp.publicKey.toBase58(), holderWallets,
          params.holderSwapAmounts, params.holderAutoBuyDelay, conn, emit,
        );
      }
    };

    if (params.useJito) {
      const maxStrictAttempts = params.strictBundle ? 3 : 1;
      let lastBundleId = '';
      let lastSig = '';

      for (let attempt = 1; attempt <= maxStrictAttempts; attempt++) {
        const { blockhash: jitoHash } = await conn.getLatestBlockhash('confirmed');
        const { txs: bundleTxs, walletBuyData } = await buildJitoBundleTxs(jitoHash);

        for (const [idx, label] of [[0, 'create+devBuy'], [bundleTxs.length - 1, 'tip']] as [number, string][]) {
          try {
            const simResult = await conn.simulateTransaction(bundleTxs[idx], {
              sigVerify: false,
              replaceRecentBlockhash: true,
            });
            if (simResult.value.err) {
              console.error(`[Launch] Simulation FAILED for ${label} tx:`, JSON.stringify(simResult.value.err));
              console.error(`[Launch] Logs:`, simResult.value.logs?.slice(-10));
              emit(launchId, { stage: 'warning', message: `${label} TX simulation error: ${JSON.stringify(simResult.value.err)}` });
            } else {
              console.log(`[Launch] ${label} tx simulation OK, CU used: ${simResult.value.unitsConsumed}`);
            }
          } catch (simErr: unknown) {
            const msg = simErr instanceof Error ? simErr.message : String(simErr);
            console.warn(`[Launch] ${label} simulation call failed: ${msg}`);
          }
        }

        emit(launchId, { stage: 'submit', message: `Submitting Jito bundle (attempt ${attempt}/${maxStrictAttempts})...` });
        const { bundleId, signature: firstTxSig } = await jito.submitBundle(bundleTxs, { skipCooldown: attempt > 1 });
        lastBundleId = bundleId;
        lastSig = firstTxSig;

        if (bundleId === 'unknown') {
          if (params.strictBundle && attempt < maxStrictAttempts) {
            emit(launchId, { stage: 'confirming', message: `No endpoint accepted bundle on attempt ${attempt}. Retrying with fresh blockhash...` });
            continue;
          }
          if (params.strictBundle) {
            throw new Error('Strict bundle enabled: no Jito endpoint accepted the bundle (no RPC fallback)');
          }
          emit(launchId, { stage: 'jito-fallback', message: 'Jito endpoints rate-limited, falling back to RPC...' });
          break;
        }

        emit(launchId, { stage: 'confirming', message: `Bundle submitted (${bundleId}). Confirming on-chain signature...` });
        const inflightStart = Date.now();
        let inflightStatus: jito.InflightBundleStatus = 'Unknown';
        while (Date.now() - inflightStart < 45_000) {
          inflightStatus = await jito.getInflightBundleStatus(bundleId);
          if (inflightStatus === 'Landed' || inflightStatus === 'Failed' || inflightStatus === 'Invalid') break;
          await new Promise(r => setTimeout(r, 3000));
        }
        emit(launchId, { stage: 'confirming', message: `Jito inflight status: ${inflightStatus}` });

        emit(launchId, { stage: 'confirming', message: 'Checking on-chain confirmation...' });
        const confirmTimeout = params.strictBundle ? 120_000 : 45_000;
        const chainConfirmed = await waitForSignatureConfirmation(
          conn, firstTxSig, confirmTimeout,
          msg => emit(launchId, { stage: 'confirming', message: msg }),
        );
        if (chainConfirmed) {
          launch.status = 'confirmed';
          launch.signature = firstTxSig;
          saveLaunch(launch);
          emit(launchId, { stage: 'done', message: 'Launch confirmed!', signature: firstTxSig, mint: mintKp.publicKey.toBase58() });
          await injectLaunchTrades(walletBuyData);
          await maybeHolderAutoBuy();
          return;
        }

        if (params.strictBundle && attempt < maxStrictAttempts) {
          emit(launchId, { stage: 'confirming', message: `Bundle accepted but not confirmed on attempt ${attempt}. Retrying bundle...` });
          continue;
        }

        if (params.strictBundle) {
          throw new Error(`Strict bundle enabled: accepted but not confirmed in time (bundleId=${lastBundleId}, sig=${lastSig})`);
        }
        emit(launchId, { stage: 'jito-fallback', message: 'Bundle accepted but not confirmed in time, falling back to RPC...' });
        break;
      }

      // RPC fallback
      emit(launchId, { stage: 'submit', message: 'Rebuilding transactions with fresh blockhash for RPC...' });
      const { blockhash: freshHash } = await conn.getLatestBlockhash('confirmed');
      const freshCreateTx = pumpfun.buildVersionedTx(devKp.publicKey, createAndBuyIxs, freshHash, lookupTables);
      freshCreateTx.sign([devKp, mintKp]);
      const createSig = await conn.sendRawTransaction(freshCreateTx.serialize(), { skipPreflight: true, maxRetries: 5 });
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
          const buyIxs = await pumpfun.buildBuyIxs({ mint: mintKp.publicKey, buyer: bundleWallets[i].keypair.publicKey, solAmount: buyAmount });
          const { blockhash: buyHash } = await conn.getLatestBlockhash('confirmed');
          const buyTx = pumpfun.buildVersionedTx(bundleWallets[i].keypair.publicKey, buyIxs, buyHash, lookupTables);
          buyTx.sign([bundleWallets[i].keypair]);
          const buySig = await conn.sendRawTransaction(buyTx.serialize(), { skipPreflight: true, maxRetries: 3 });
          emit(launchId, { stage: 'confirming', message: `Bundle buy ${i + 1} sent (${buySig.slice(0, 12)}...)` });
        } catch (buyErr: unknown) {
          const msg = buyErr instanceof Error ? buyErr.message : String(buyErr);
          emit(launchId, { stage: 'warning', message: `Bundle buy ${i + 1} failed: ${msg}` });
        }
      }

      launch.status = 'confirmed';
      launch.signature = createSig;
      saveLaunch(launch);
      emit(launchId, { stage: 'done', message: 'Launch confirmed via RPC fallback!', signature: createSig, mint: mintKp.publicKey.toBase58() });
      await injectLaunchTrades();
      await maybeHolderAutoBuy();
    } else {
      // Non-Jito path
      emit(launchId, { stage: 'submit', message: 'Submitting transaction...' });
      const sig = await solana.executeTransaction(createTx, []);
      try {
        await conn.confirmTransaction(sig, 'confirmed');
      } catch (confirmErr: unknown) {
        const errMsg = confirmErr instanceof Error ? confirmErr.message : String(confirmErr);
        if (errMsg.includes('unknown if it succeeded or failed')) {
          const rpcConfirmed = await waitForSignatureConfirmation(
            conn, sig, 45_000,
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
      emit(launchId, { stage: 'done', message: 'Launch confirmed!', signature: sig, mint: mintKp.publicKey.toBase58() });
      await injectLaunchTrades();
      await maybeHolderAutoBuy();
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Launch] Error:', err);
    launch.status = 'error';
    launch.error = msg;
    saveLaunch(launch);
    emit(launchId, { stage: 'error', message: msg });
  }
}
