import {
  AddressLookupTableProgram,
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import {
  PUMP_PROGRAM_ID,
  PUMP_FEE_PROGRAM_ID,
  PUMP_FEE_CONFIG_PDA,
  PUMP_EVENT_AUTHORITY_PDA,
  GLOBAL_PDA,
  GLOBAL_VOLUME_ACCUMULATOR_PDA,
  bondingCurvePda,
  creatorVaultPda,
  userVolumeAccumulatorPda,
} from '@pump-fun/pump-sdk';
import fs from 'fs';
import path from 'path';
import { getConnection, confirmTransactionPolling } from './solana';

const LUT_FILE = path.join(__dirname, '../../data/lut.json');

interface LutRecord {
  address: string;
  createdAt: string;
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function sendAndConfirmTx(
  ixs: any[],
  signer: Keypair,
  maxRetries = 5,
): Promise<boolean> {
  const conn = getConnection();

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const { blockhash } = await conn.getLatestBlockhash('confirmed');
      const msg = new TransactionMessage({
        payerKey: signer.publicKey,
        recentBlockhash: blockhash,
        instructions: [
          ComputeBudgetProgram.setComputeUnitLimit({ units: 50_000 }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 500_000 }),
          ...ixs,
        ],
      }).compileToV0Message();

      const tx = new VersionedTransaction(msg);
      tx.sign([signer]);

      const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
      await confirmTransactionPolling(conn, sig);
      return true;
    } catch (err: any) {
      console.log(`[LUT] Attempt ${attempt}/${maxRetries} failed: ${err.message}`);
      if (attempt < maxRetries) await sleep(2000);
    }
  }
  return false;
}

export async function createLUT(
  payer: Keypair,
  onProgress?: (msg: string) => void,
): Promise<PublicKey | null> {
  const conn = getConnection();
  const log = (msg: string) => {
    console.log(`[LUT] ${msg}`);
    onProgress?.(msg);
  };

  const balance = await conn.getBalance(payer.publicKey);
  if (balance < 0.003 * 1e9) {
    log(`Insufficient balance for LUT creation: ${(balance / 1e9).toFixed(4)} SOL`);
    return null;
  }

  const slot = await conn.getSlot('finalized');
  const [createIx, lutAddress] = AddressLookupTableProgram.createLookupTable({
    authority: payer.publicKey,
    payer: payer.publicKey,
    recentSlot: slot,
  });

  log(`Creating LUT at ${lutAddress.toBase58().slice(0, 12)}...`);
  const ok = await sendAndConfirmTx([createIx], payer);
  if (!ok) {
    log('LUT creation failed');
    return null;
  }

  log('LUT created, waiting 15s for activation...');
  await sleep(15_000);

  const record: LutRecord = { address: lutAddress.toBase58(), createdAt: new Date().toISOString() };
  const dir = path.dirname(LUT_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(LUT_FILE, JSON.stringify(record, null, 2));

  return lutAddress;
}

export async function extendLUT(
  lutAddress: PublicKey,
  payer: Keypair,
  mint: PublicKey,
  creator: PublicKey,
  walletPubkeys: PublicKey[],
  onProgress?: (msg: string) => void,
): Promise<boolean> {
  const log = (msg: string) => {
    console.log(`[LUT] ${msg}`);
    onProgress?.(msg);
  };

  async function extend(addresses: PublicKey[], label: string): Promise<boolean> {
    if (addresses.length === 0) return true;
    log(`Extending: ${label} (${addresses.length} addresses)`);
    const ix = AddressLookupTableProgram.extendLookupTable({
      payer: payer.publicKey,
      authority: payer.publicKey,
      lookupTable: lutAddress,
      addresses,
    });
    return sendAndConfirmTx([ix], payer);
  }

  // Step 1: wallet pubkeys
  if (!(await extend(walletPubkeys, 'wallet addresses'))) return false;
  await sleep(5_000);

  // Step 2: wallet ATAs for the token
  const atas = walletPubkeys.map(w =>
    getAssociatedTokenAddressSync(mint, w, true, TOKEN_2022_PROGRAM_ID),
  );
  if (!(await extend(atas, 'wallet ATAs'))) return false;
  await sleep(5_000);

  // Step 3: volume accumulators
  const volumeAccs = walletPubkeys.map(w => userVolumeAccumulatorPda(w));
  if (!(await extend(volumeAccs, 'volume accumulators'))) return false;
  await sleep(5_000);

  // Step 4: static program addresses + PDAs
  const bc = bondingCurvePda(mint);
  const associatedBc = getAssociatedTokenAddressSync(mint, bc, true, TOKEN_2022_PROGRAM_ID);
  const cVault = creatorVaultPda(creator);

  const staticAddresses = [
    payer.publicKey,
    mint,
    PUMP_PROGRAM_ID,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    SystemProgram.programId,
    SYSVAR_RENT_PUBKEY,
    NATIVE_MINT,
    ComputeBudgetProgram.programId,
    cVault,
    GLOBAL_VOLUME_ACCUMULATOR_PDA,
    PUMP_FEE_CONFIG_PDA,
    PUMP_FEE_PROGRAM_ID,
    bc,
    associatedBc,
    PUMP_EVENT_AUTHORITY_PDA,
    GLOBAL_PDA,
  ];

  if (!(await extend(staticAddresses, 'static addresses + PDAs'))) return false;
  await sleep(5_000);

  log('LUT extension complete');
  return true;
}

export async function loadLUT(): Promise<AddressLookupTableAccount | null> {
  if (!fs.existsSync(LUT_FILE)) return null;
  try {
    const record: LutRecord = JSON.parse(fs.readFileSync(LUT_FILE, 'utf8'));
    const conn = getConnection();
    const result = await conn.getAddressLookupTable(new PublicKey(record.address));
    return result.value;
  } catch {
    return null;
  }
}

export function getSavedLutAddress(): string | null {
  if (!fs.existsSync(LUT_FILE)) return null;
  try {
    const record: LutRecord = JSON.parse(fs.readFileSync(LUT_FILE, 'utf8'));
    return record.address;
  } catch {
    return null;
  }
}
