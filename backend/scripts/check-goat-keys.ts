/**
 * Extract keys from goat-keys bundle file and check:
 * - SOL balance
 * - Unclaimed pump.fun creator fees
 * - Token holdings (SPL)
 *
 * Uses Alchemy RPC from .env
 */

import fs from 'fs';
import path from 'path';
import { Connection, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { OnlinePumpSdk } from '@pump-fun/pump-sdk';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '../../.env') });

const RPC_URL = process.env.RPC_ENDPOINT || 'https://solana-mainnet.g.alchemy.com/v2/mBI7i4C4IxMpCLS2kBTjC';
const LAMPORTS_PER_SOL = 1e9;
const RENT_PER_EMPTY_ATA = 2_039_280; // ~0.00204 SOL per empty token account
const MIN_SOL_REPORT = 0.0001;
const MIN_FEES_REPORT = 0.0001;
const MIN_RENT_REPORT = 0.0001;
const DELAY_MS = 60;

function extractKeys(filePath: string): { pubkey: string; privkey: string }[] {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n').filter((l) => l.trim());
  const keys: { pubkey: string; privkey: string }[] = [];
  for (const line of lines) {
    if (line.startsWith('===')) continue;
    const parts = line.split(',');
    if (parts.length >= 2) {
      const pubkey = parts[0].trim();
      const privkey = parts[1].trim();
      if (pubkey.length >= 32 && pubkey.length <= 44) {
        keys.push({ pubkey, privkey });
      }
    }
  }
  return keys;
}

async function getCreatorFees(sdk: OnlinePumpSdk, creatorPubkey: PublicKey): Promise<number> {
  try {
    const bal = await sdk.getCreatorVaultBalanceBothPrograms(creatorPubkey);
    return bal ? Number(bal.toString()) : 0;
  } catch {
    return 0;
  }
}

async function getTokenAccounts(conn: Connection, owner: PublicKey): Promise<{ withBalance: number; empty: number; rentRecoverable: number }> {
  try {
    const [legacy, ext] = await Promise.all([
      conn.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }),
      conn.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID }),
    ]);
    const all = [...legacy.value, ...ext.value];
    let withBalance = 0;
    let empty = 0;
    for (const a of all) {
      const amt = (a.account?.data as { parsed?: { info?: { tokenAmount?: { uiAmount?: number; amount?: string } } } })?.parsed?.info?.tokenAmount?.uiAmount;
      const rawAmt = (a.account?.data as { parsed?: { info?: { tokenAmount?: { amount?: string } } } })?.parsed?.info?.tokenAmount?.amount;
      if (amt != null && amt > 0) withBalance++;
      else if (!rawAmt || rawAmt === '0') empty++;
    }
    const rentRecoverable = empty * RENT_PER_EMPTY_ATA;
    return { withBalance, empty, rentRecoverable };
  } catch {
    return { withBalance: 0, empty: 0, rentRecoverable: 0 };
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const keysPath = process.argv[2] || path.join(process.env.USERPROFILE || '', 'Desktop', 'pc-pk-extractor', 'goat-keys-bundle-391-1773028127341.txt');
  if (!fs.existsSync(keysPath)) {
    console.error('File not found:', keysPath);
    process.exit(1);
  }

  const keys = extractKeys(keysPath);
  console.log(`Extracted ${keys.length} keys from ${path.basename(keysPath)}\n`);
  console.log('Using RPC:', RPC_URL);
  console.log('---\n');

  const conn = new Connection(RPC_URL);
  const sdk = new OnlinePumpSdk(conn);

  const results: { pubkey: string; fullPubkey: string; sol: string; fees: string; tokens: number; rentSol: string; emptyAtas: number }[] = [];
  let totalSol = 0;
  let totalFees = 0;
  let totalRentRecoverable = 0;
  let withTokens = 0;
  let withFees = 0;
  let withRent = 0;

  for (let i = 0; i < keys.length; i++) {
    const { pubkey } = keys[i];
    await sleep(DELAY_MS);
    try {
      const pk = new PublicKey(pubkey);
      const [solLamports, feesLamports, tokenData] = await Promise.all([
        conn.getBalance(pk),
        getCreatorFees(sdk, pk),
        getTokenAccounts(conn, pk),
      ]);

      const sol = solLamports / LAMPORTS_PER_SOL;
      const fees = feesLamports / LAMPORTS_PER_SOL;
      const rentSol = tokenData.rentRecoverable / LAMPORTS_PER_SOL;

      totalSol += sol;
      totalFees += fees;
      totalRentRecoverable += tokenData.rentRecoverable;
      if (tokenData.withBalance > 0) withTokens++;
      if (fees >= MIN_FEES_REPORT) withFees++;
      if (rentSol >= MIN_RENT_REPORT) withRent++;

      const hasValue = sol >= MIN_SOL_REPORT || fees >= MIN_FEES_REPORT || tokenData.withBalance > 0 || rentSol >= MIN_RENT_REPORT;
      if (hasValue) {
        results.push({
          pubkey: pubkey.slice(0, 8) + '...' + pubkey.slice(-4),
          fullPubkey: pubkey,
          sol: sol.toFixed(6),
          fees: fees.toFixed(6),
          tokens: tokenData.withBalance,
          rentSol: rentSol.toFixed(6),
          emptyAtas: tokenData.empty,
        });
      }
    } catch (err: unknown) {
      console.warn(`Error checking ${pubkey.slice(0, 8)}...:`, (err as Error).message);
    }

    if ((i + 1) % 50 === 0) {
      process.stdout.write(`\rChecked ${i + 1}/${keys.length}...`);
    }
  }

  console.log('\r' + ' '.repeat(50) + '\r');
  console.log('=== WALLETS WITH BALANCE / FEES / TOKENS ===\n');

  if (results.length === 0) {
    console.log('No wallets with SOL, unclaimed fees, tokens, or recoverable rent found.');
  } else {
    results.sort((a, b) => parseFloat(b.sol) - parseFloat(a.sol) || parseFloat(b.fees) - parseFloat(a.fees) || parseFloat(b.rentSol) - parseFloat(a.rentSol));
    for (const r of results) {
      const parts = [`${r.pubkey}  SOL: ${r.sol}`];
      if (parseFloat(r.fees) >= MIN_FEES_REPORT) parts.push(`Fees: ${r.fees} SOL`);
      if (r.tokens > 0) parts.push(`Tokens: ${r.tokens} mint(s)`);
      if (r.emptyAtas > 0) parts.push(`Rent: ${r.rentSol} SOL (${r.emptyAtas} empty ATA)`);
      console.log(parts.join('  |  '));
    }
  }

  const totalRentSol = totalRentRecoverable / LAMPORTS_PER_SOL;
  console.log('\n--- SUMMARY ---');
  console.log(`Total keys checked: ${keys.length}`);
  console.log(`Total SOL across all: ${totalSol.toFixed(6)} SOL`);
  console.log(`Total unclaimed fees: ${totalFees.toFixed(6)} SOL`);
  console.log(`Total rent in unclosed token accounts: ${totalRentSol.toFixed(6)} SOL (close empty ATAs to recover)`);
  console.log(`Wallets with tokens: ${withTokens}`);
  console.log(`Wallets with unclaimed fees (>=${MIN_FEES_REPORT} SOL): ${withFees}`);
  console.log(`Wallets with recoverable rent (>=${MIN_RENT_REPORT} SOL): ${withRent}`);
  console.log(`\nTOTAL RECOVERABLE (SOL + fees + rent): ${(totalSol + totalFees + totalRentSol).toFixed(6)} SOL`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
