import { Router, Request, Response } from 'express';
import * as vault from '../services/vault';
import * as solana from '../services/solana';
import { fundingMiddleware, FundingRequest } from '../middleware/funding';
import {
  PublicKey, LAMPORTS_PER_SOL, SystemProgram,
  TransactionMessage, VersionedTransaction,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID,
  createCloseAccountInstruction,
} from '@solana/spl-token';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  const type = typeof req.query.type === 'string' ? req.query.type : undefined;
  const status = typeof req.query.status === 'string' ? req.query.status : 'active';
  const launchId = typeof req.query.launchId === 'string' ? req.query.launchId : undefined;
  let wallets = await vault.listWallets({ type, status }, req.sessionId);
  if (launchId) {
    wallets = wallets.filter(w => w.launchId === launchId);
  }
  res.json(wallets);
});

router.get('/available', async (_req: Request, res: Response) => {
  try {
    res.json(await vault.listAvailable(_req.sessionId));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/imported', async (_req: Request, res: Response) => {
  try {
    res.json(await vault.listImported(_req.sessionId));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/imported/:id', async (req: Request, res: Response) => {
  const deleted = await vault.deleteImported(String(req.params.id), req.sessionId);
  if (!deleted) return res.status(404).json({ error: 'Not found' });
  res.json({ deleted: true });
});

router.get('/funding', fundingMiddleware, async (req: FundingRequest, res: Response) => {
  if (req.query.refresh === '1') solana.resetConnection();
  try {
    const kp = solana.getFundingKeypair(req.fundingKeypair!);
    const pubkey = kp.publicKey.toBase58();
    const conn = await solana.getConnectionForSession(req.sessionId);
    try {
      const balance = await solana.getBalance(kp.publicKey, conn);
      return res.json({ publicKey: pubkey, balance });
    } catch (balanceErr: any) {
      return res.json({ publicKey: pubkey, balance: 0, error: balanceErr.message });
    }
  } catch (err: any) {
    res.json({ publicKey: '', balance: 0, error: err.message });
  }
});

router.post('/generate', async (req: Request, res: Response) => {
  const { count = 1, type = 'manual', label = 'Wallet' } = req.body;
  const clamped = Math.min(Math.max(Number(count), 1), 50);
  const results = await vault.generateBatch(clamped, type, label, undefined, req.sessionId);
  res.json(results.map(r => r.wallet));
});

router.post('/import', async (req: Request, res: Response) => {
  const { privateKey, type = 'manual', label = 'Imported' } = req.body;
  if (!privateKey) return res.status(400).json({ error: 'privateKey required' });
  try {
    const wallet = await vault.importKey(privateKey, type, label, req.sessionId);
    res.json(wallet);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/refresh-balances', async (req: Request, res: Response) => {
  const { ids } = req.body;
  const wallets = ids
    ? [...(await vault.listWallets({}, req.sessionId)), ...(await vault.listImported(req.sessionId))]
    : await vault.listWallets({ status: 'active' }, req.sessionId);
  const toRefresh = ids
    ? wallets.filter(w => (ids as string[]).includes(w.id))
    : wallets;

  const results = await Promise.all(
    toRefresh.map(async w => {
      try {
        const balance = await solana.getBalance(new PublicKey(w.publicKey));
        return { id: w.id, publicKey: w.publicKey, balance };
      } catch {
        return { id: w.id, publicKey: w.publicKey, balance: 0 };
      }
    }),
  );
  res.json(results);
});

router.get('/:id/private-key', async (req: Request, res: Response) => {
  try {
    const pk = await vault.getPrivateKey(String(req.params.id), req.sessionId);
    res.json({ privateKey: pk });
  } catch (err: any) {
    res.status(404).json({ error: err.message });
  }
});

router.patch('/:id/archive', async (req: Request, res: Response) => {
  const wallet = await vault.archiveWallet(String(req.params.id), req.sessionId);
  if (!wallet) return res.status(404).json({ error: 'Not found' });
  res.json(wallet);
});

router.post('/archive-all', async (req: Request, res: Response) => {
  const { type } = req.body;
  const params: Record<string, string> = { status: 'active' };
  if (type && type !== 'all') params.type = type;
  let wallets = (await vault.listWallets(params, req.sessionId)).filter(w => w.type !== 'funding');
  if (!type || type === 'all') {
    wallets = wallets.filter(w => w.type !== 'manual');
  }
  let archived = 0;
  for (const w of wallets) {
    if (await vault.archiveWallet(w.id, req.sessionId)) archived++;
  }
  res.json({ archived, total: wallets.length });
});

router.patch('/:id/unarchive', async (req: Request, res: Response) => {
  const wallet = await vault.unarchiveWallet(String(req.params.id), req.sessionId);
  if (!wallet) return res.status(404).json({ error: 'Not found' });
  res.json(wallet);
});

/** Permanently delete ALL archived wallets. Destructive — cannot be undone. */
router.delete('/archive-all', async (req: Request, res: Response) => {
  const { deleted } = await vault.deleteAllArchived(req.sessionId);
  res.json({ deleted });
});

/** Fund a wallet from the funding wallet (e.g. after gather left it with tokens but no SOL) */
router.post('/:id/fund', fundingMiddleware, async (req: FundingRequest, res: Response) => {
  const id = String(req.params.id);
  const amount = Math.max(0.001, Math.min(1, Number(req.body?.amount) || 0.01));
  try {
    const fundingKp = solana.getFundingKeypair(req.fundingKeypair!);
    const kp = await vault.getKeypair(id, req.sessionId);
    const conn = await solana.getConnectionForSession(req.sessionId);
    const sig = await solana.transferSol(fundingKp, kp.publicKey, amount, { conn });
    console.log(`[Fund] ${kp.publicKey.toBase58().slice(0, 8)}... +${amount} SOL`);
    res.json({ signature: sig, amount, publicKey: kp.publicKey.toBase58() });
  } catch (err: any) {
    if (err.message?.includes('not found') || err.message?.includes('No wallet')) {
      return res.status(404).json({ error: 'Wallet not found' });
    }
    console.error('[Fund] Error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to fund wallet' });
  }
});

router.post('/balances', async (req: Request, res: Response) => {
  const { mint, launchId } = req.body;
  if (!mint) return res.status(400).json({ error: 'mint required' });

  const mintPubkey = new PublicKey(mint);
  const conn = solana.getConnection();

  // Include ALL wallets (even archived) — they may still hold tokens
  let wallets = await vault.listWallets({}, req.sessionId);
  if (launchId) {
    wallets = wallets.filter(w => w.launchId === String(launchId));
  }
  wallets = wallets.filter(w => w.type === 'dev' || w.type === 'bundle' || w.type === 'holder');

  // Batch SOL balances via getMultipleAccountsInfo (1 RPC call instead of N)
  const pubkeys = wallets.map(w => new PublicKey(w.publicKey));
  let solBalances: number[] = [];
  try {
    const accounts = await conn.getMultipleAccountsInfo(pubkeys);
    solBalances = accounts.map(a => (a?.lamports ?? 0) / LAMPORTS_PER_SOL);
  } catch {
    solBalances = pubkeys.map(() => 0);
  }

  // Token balances — use getTokenAccountsByOwner to find ALL token accounts
  // for the given mint in a single RPC call per wallet (handles any token program).
  const tokenData: { tokenBalance: number; tokenRaw: string }[] = Array.from(
    { length: wallets.length },
    () => ({ tokenBalance: 0, tokenRaw: '0' }),
  );

  console.log(`[balances] Fetching token balances for ${wallets.length} wallets, mint=${mint}`);

  for (let i = 0; i < wallets.length; i++) {
    const w = wallets[i];
    const pubkey = new PublicKey(w.publicKey);
    try {
      const ataLegacy = getAssociatedTokenAddressSync(mintPubkey, pubkey, true, TOKEN_PROGRAM_ID);
      const bal = await conn.getTokenAccountBalance(ataLegacy);
      const amount = Number(bal.value.uiAmount || 0);
      tokenData[i] = { tokenBalance: amount, tokenRaw: bal.value.amount };
      if (amount > 0) console.log(`[balances] ${w.type} ${w.publicKey.slice(0,8)}... has ${amount} tokens`);
    } catch (err: any) {
      const msg = err?.message || String(err);
      if (!msg.includes('could not find account') && !msg.includes('Invalid param') && !msg.includes('AccountNotFound')) {
        console.log(`[balances] Legacy ATA error for ${w.type} ${w.publicKey.slice(0,8)}...: ${msg.slice(0,120)}`);
      }
      try {
        const ata2022 = getAssociatedTokenAddressSync(mintPubkey, pubkey, true, TOKEN_2022_PROGRAM_ID);
        const bal = await conn.getTokenAccountBalance(ata2022);
        const amount = Number(bal.value.uiAmount || 0);
        tokenData[i] = { tokenBalance: amount, tokenRaw: bal.value.amount };
        if (amount > 0) console.log(`[balances] ${w.type} ${w.publicKey.slice(0,8)}... has ${amount} tokens (2022)`);
      } catch {
        // No token account found for this wallet
      }
    }
  }

  let results = wallets.map((w, idx) => ({
    id: w.id,
    publicKey: w.publicKey,
    type: w.type,
    label: w.label,
    solBalance: solBalances[idx],
    tokenBalance: tokenData[idx].tokenBalance,
    tokenRaw: tokenData[idx].tokenRaw,
  }));

  // When no launchId filter was applied (e.g. manual mint), only show wallets
  // that actually hold tokens — prevents showing hundreds of unrelated wallets
  if (!launchId) {
    results = results.filter(r => r.tokenBalance > 0);
  }

  res.json(results);
});

router.post('/gather', fundingMiddleware, async (req: FundingRequest, res: Response) => {
  const fundingKp = solana.getFundingKeypair(req.fundingKeypair!);
  const fundingPk = fundingKp.publicKey.toBase58();
  const launchId = typeof req.body?.launchId === 'string' ? req.body.launchId : undefined;
  let wallets = (await vault.listWallets({ status: 'active' }, req.sessionId)).filter(w => w.type !== 'funding');
  if (launchId) {
    wallets = wallets.filter(w => w.launchId === launchId);
  }
  const conn = await solana.getConnectionForSession(req.sessionId);

  const TX_FEE_LAMPORTS = 5000;

  const results: { id: string; publicKey: string; recovered: number; error?: string }[] = [];

  for (const w of wallets) {
    if (w.publicKey === fundingPk || w.type === 'funding') continue;

    try {
      const pubkey = new PublicKey(w.publicKey);
      const lamports = await conn.getBalance(pubkey);

      // Send ALL lamports minus tx fee — account goes to 0 (fully closed)
      const sendLamports = lamports - TX_FEE_LAMPORTS;

      if (sendLamports <= 0) {
        results.push({ id: w.id, publicKey: w.publicKey, recovered: 0 });
        continue;
      }

      const kp = await vault.getKeypair(w.id, req.sessionId);
      const { blockhash } = await conn.getLatestBlockhash('confirmed');

      const msg = new TransactionMessage({
        payerKey: pubkey,
        recentBlockhash: blockhash,
        instructions: [
          SystemProgram.transfer({
            fromPubkey: pubkey,
            toPubkey: fundingKp.publicKey,
            lamports: sendLamports,
          }),
        ],
      }).compileToV0Message();

      const tx = new VersionedTransaction(msg);
      tx.sign([kp]);

      const sig = await conn.sendTransaction(tx, { skipPreflight: true });
      const solRecovered = sendLamports / LAMPORTS_PER_SOL;
      console.log(`[Gather] ${w.publicKey.slice(0, 8)}... → funding: ${solRecovered.toFixed(6)} SOL (${sig.slice(0, 8)}...)`);
      results.push({ id: w.id, publicKey: w.publicKey, recovered: solRecovered });

      // Small delay to avoid RPC rate limits
      await new Promise(r => setTimeout(r, 300));
    } catch (err: any) {
      console.error(`[Gather] ${w.publicKey.slice(0, 8)}... failed:`, err.message);
      results.push({ id: w.id, publicKey: w.publicKey, recovered: 0, error: err.message });
    }
  }

  const totalRecovered = results.reduce((s, r) => s + r.recovered, 0);
  res.json({ totalRecovered, wallets: results });
});

router.post('/close-token-accounts', fundingMiddleware, async (req: FundingRequest, res: Response) => {
  const fundingKp = solana.getFundingKeypair(req.fundingKeypair!);
  const conn = await solana.getConnectionForSession(req.sessionId);
  const archivedWallets = (await vault.listWallets({ status: 'archived' }, req.sessionId)).filter(w => w.type !== 'funding');

  const results: { publicKey: string; closed: number; recoveredSol: number; error?: string }[] = [];
  let totalRecovered = 0;

  for (const w of archivedWallets) {
    try {
      const ownerPk = new PublicKey(w.publicKey);
      const kp = await vault.getKeypair(w.id, req.sessionId);

      // Find all token accounts owned by this wallet
      const tokenAccounts = await conn.getParsedTokenAccountsByOwner(ownerPk, {
        programId: TOKEN_PROGRAM_ID,
      });
      const tokenAccounts2022 = await conn.getParsedTokenAccountsByOwner(ownerPk, {
        programId: TOKEN_2022_PROGRAM_ID,
      });
      const allATAs = [...tokenAccounts.value, ...tokenAccounts2022.value];

      // Only close accounts with 0 token balance
      const closeable = allATAs.filter(a => {
        const amount = a.account.data.parsed?.info?.tokenAmount?.amount;
        return amount === '0' || amount === 0;
      });

      if (closeable.length === 0) {
        continue;
      }

      // Batch up to 10 close instructions per tx (to stay within tx size limits)
      const BATCH_SIZE = 10;
      let closedCount = 0;
      let walletRecovered = 0;

      for (let i = 0; i < closeable.length; i += BATCH_SIZE) {
        const batch = closeable.slice(i, i + BATCH_SIZE);
        const programForAta = (ata: typeof batch[0]) => {
          return tokenAccounts2022.value.includes(ata) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
        };

        const closeIxs = batch.map(ata =>
          createCloseAccountInstruction(
            ata.pubkey,
            fundingKp.publicKey, // rent destination
            ownerPk,             // owner/authority
            [],
            programForAta(ata),
          )
        );

        const { blockhash } = await conn.getLatestBlockhash('confirmed');
        const msg = new TransactionMessage({
          payerKey: fundingKp.publicKey,
          recentBlockhash: blockhash,
          instructions: closeIxs,
        }).compileToV0Message();

        const tx = new VersionedTransaction(msg);
        tx.sign([fundingKp, kp]);

        const sig = await conn.sendTransaction(tx, { skipPreflight: true });
        // Rent recovery is ~0.00203 SOL per ATA
        const estimatedRent = batch.length * 0.00203;
        walletRecovered += estimatedRent;
        closedCount += batch.length;
        console.log(`[CloseATAs] ${w.publicKey.slice(0, 8)}... closed ${batch.length} ATAs (${sig.slice(0, 8)}...)`);

        await new Promise(r => setTimeout(r, 300));
      }

      // Sweep any remaining SOL in the wallet to funding
      await new Promise(r => setTimeout(r, 500));
      const remaining = await conn.getBalance(ownerPk);
      if (remaining > 5000) {
        const { blockhash } = await conn.getLatestBlockhash('confirmed');
        const sweepMsg = new TransactionMessage({
          payerKey: fundingKp.publicKey,
          recentBlockhash: blockhash,
          instructions: [
            SystemProgram.transfer({
              fromPubkey: ownerPk,
              toPubkey: fundingKp.publicKey,
              lamports: remaining,
            }),
          ],
        }).compileToV0Message();
        const sweepTx = new VersionedTransaction(sweepMsg);
        sweepTx.sign([fundingKp, kp]);
        await conn.sendTransaction(sweepTx, { skipPreflight: true });
        walletRecovered += remaining / LAMPORTS_PER_SOL;
        console.log(`[CloseATAs] ${w.publicKey.slice(0, 8)}... swept remaining ${(remaining / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
      }

      if (closedCount > 0) {
        totalRecovered += walletRecovered;
        results.push({ publicKey: w.publicKey, closed: closedCount, recoveredSol: walletRecovered });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[CloseATAs] ${w.publicKey.slice(0, 8)}... failed:`, msg);
      results.push({ publicKey: w.publicKey, closed: 0, recoveredSol: 0, error: msg });
    }

    await new Promise(r => setTimeout(r, 200));
  }

  res.json({
    walletsProcessed: archivedWallets.length,
    walletsWithATAs: results.length,
    totalClosed: results.reduce((s, r) => s + r.closed, 0),
    totalRecoveredSol: totalRecovered,
    results,
  });
});

export default router;
