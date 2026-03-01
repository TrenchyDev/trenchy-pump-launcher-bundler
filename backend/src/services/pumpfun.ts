import {
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  ComputeBudgetProgram,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import BN from 'bn.js';
import {
  PUMP_SDK,
  OnlinePumpSdk,
  getBuyTokenAmountFromSolAmount,
  getSellSolAmountFromTokenAmount,
  newBondingCurve,
  bondingCurvePda,
  bondingCurveV2Pda,
  creatorVaultPda,
  getPumpProgram,
} from '@pump-fun/pump-sdk';
import { getConnection } from './solana';

let onlineSdk: OnlinePumpSdk | null = null;

function getOnlineSdk(): OnlinePumpSdk {
  if (!onlineSdk) {
    onlineSdk = new OnlinePumpSdk(getConnection());
  }
  return onlineSdk;
}

export interface CreateAndBuyParams {
  mint: Keypair;
  creator: PublicKey;
  name: string;
  symbol: string;
  uri: string;
  devBuySol: number;
  mayhemMode?: boolean;
}

export async function buildCreateAndBuyIxs(
  params: CreateAndBuyParams,
): Promise<TransactionInstruction[]> {
  const sdk = getOnlineSdk();
  const global = await sdk.fetchGlobal();
  const feeConfig = await sdk.fetchFeeConfig();

  const solAmount = new BN(Math.round(params.devBuySol * LAMPORTS_PER_SOL));

  const tokenAmount = getBuyTokenAmountFromSolAmount({
    global,
    feeConfig,
    mintSupply: null,
    bondingCurve: null,
    amount: solAmount,
  });

  const instructions = await PUMP_SDK.createV2AndBuyInstructions({
    global,
    mint: params.mint.publicKey,
    name: params.name,
    symbol: params.symbol,
    uri: params.uri,
    creator: params.creator,
    user: params.creator,
    amount: tokenAmount,
    solAmount,
    mayhemMode: params.mayhemMode ?? false,
  });

  return instructions;
}

/** Get token amount for dev buy (new token, no prior buys) — for trade injection */
export async function getDevBuyTokenAmount(solAmount: number): Promise<number> {
  const sdk = getOnlineSdk();
  const global = await sdk.fetchGlobal();
  const feeConfig = await sdk.fetchFeeConfig();
  const solBN = new BN(Math.round(solAmount * LAMPORTS_PER_SOL));
  const tokenAmount = getBuyTokenAmountFromSolAmount({
    global, feeConfig, mintSupply: null, bondingCurve: null, amount: solBN,
  });
  return tokenAmount.toNumber();
}

export interface BundleBuyParams {
  mint: PublicKey;
  buyer: PublicKey;
  solAmount: number;
}

/**
 * Build buy IXs for an existing on-chain token (fetches bonding curve state).
 */
export async function buildBuyIxs(
  params: BundleBuyParams,
): Promise<TransactionInstruction[]> {
  const sdk = getOnlineSdk();
  const global = await sdk.fetchGlobal();
  const feeConfig = await sdk.fetchFeeConfig();

  const { bondingCurveAccountInfo, bondingCurve, associatedUserAccountInfo } =
    await sdk.fetchBuyState(params.mint, params.buyer, TOKEN_2022_PROGRAM_ID);

  const solBN = new BN(Math.round(params.solAmount * LAMPORTS_PER_SOL));

  const tokenAmount = getBuyTokenAmountFromSolAmount({
    global,
    feeConfig,
    mintSupply: bondingCurve.tokenTotalSupply,
    bondingCurve,
    amount: solBN,
  });

  const instructions = await PUMP_SDK.buyInstructions({
    global,
    bondingCurveAccountInfo,
    bondingCurve,
    associatedUserAccountInfo,
    mint: params.mint,
    user: params.buyer,
    amount: tokenAmount,
    solAmount: solBN,
    slippage: 5,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
  });

  return instructions;
}

export interface BundleBuyOfflineParams {
  mint: PublicKey;
  buyer: PublicKey;
  creator: PublicKey;
  solAmount: number;
  fundedBalance: number;
  cumulativeSolBought: number;
}

/**
 * Build buy IXs for a token that doesn't exist on-chain yet (same Jito bundle as create).
 * Uses very generous slippage to ensure the buy succeeds on-chain even if our offline
 * bonding curve simulation is slightly off. Matches the old bundler's approach:
 * request only 80% of expected tokens, offer the wallet's full balance as max SOL.
 * Returns both instructions and tokenAmount (for trade injection).
 */
export async function buildBundleBuyIxs(
  params: BundleBuyOfflineParams,
): Promise<{ instructions: TransactionInstruction[]; tokenAmount: BN }> {
  const sdk = getOnlineSdk();
  const global = await sdk.fetchGlobal();
  const feeConfig = await sdk.fetchFeeConfig();

  let bc = newBondingCurve(global);

  if (params.cumulativeSolBought > 0) {
    const prevSol = new BN(Math.round(params.cumulativeSolBought * LAMPORTS_PER_SOL));
    const prevTokens = getBuyTokenAmountFromSolAmount({
      global, feeConfig,
      mintSupply: global.tokenTotalSupply,
      bondingCurve: bc,
      amount: prevSol,
    });
    bc = {
      ...bc,
      virtualTokenReserves: bc.virtualTokenReserves.sub(prevTokens),
      virtualSolReserves: bc.virtualSolReserves.add(prevSol),
      realTokenReserves: bc.realTokenReserves.sub(prevTokens),
      realSolReserves: bc.realSolReserves.add(prevSol),
    };
  }

  const solBN = new BN(Math.round(params.solAmount * LAMPORTS_PER_SOL));
  const tokenAmount = getBuyTokenAmountFromSolAmount({
    global, feeConfig,
    mintSupply: global.tokenTotalSupply,
    bondingCurve: bc,
    amount: solBN,
  });

  // Use only 80% of expected tokens as minimum (very conservative, matches old bundler).
  // This ensures the buy succeeds even if our offline simulation is slightly inaccurate.
  const safeTokenAmount = tokenAmount.muln(8).divn(10);

  // Max SOL = wallet's funded balance minus a small rent reserve (matches old bundler
  // which used the wallet's entire balance minus 0.001 SOL)
  const maxSolLamports = Math.round(params.fundedBalance * LAMPORTS_PER_SOL) - 1_000_000;
  const maxSol = new BN(Math.max(maxSolLamports, Math.round(params.solAmount * LAMPORTS_PER_SOL * 2)));

  console.log(`[Bundle Buy] wallet=${params.buyer.toBase58().slice(0, 8)}... tokens=${safeTokenAmount.toString()} (80% of ${tokenAmount.toString()}), maxSol=${(maxSol.toNumber() / LAMPORTS_PER_SOL).toFixed(4)}`);

  const instructions: TransactionInstruction[] = [];

  const associatedUser = getAssociatedTokenAddressSync(
    params.mint, params.buyer, true, TOKEN_2022_PROGRAM_ID,
  );

  instructions.push(
    createAssociatedTokenAccountIdempotentInstruction(
      params.buyer, associatedUser, params.buyer, params.mint, TOKEN_2022_PROGRAM_ID,
    ),
  );

  // Build buy instruction MANUALLY instead of using PUMP_SDK.getBuyInstructionRaw.
  // The SDK has a bug: getBuyInstructionRaw accepts tokenProgram but does NOT forward
  // it to the internal builder, so it always defaults to TOKEN_PROGRAM_ID even when
  // TOKEN_2022_PROGRAM_ID is passed. This mismatch causes on-chain buy failures.
  const pumpProgram = getPumpProgram(getConnection());
  const buyIx = await pumpProgram.methods
    .buy(safeTokenAmount, maxSol, { 0: true })
    .accountsPartial({
      feeRecipient: global.feeRecipient,
      mint: params.mint,
      associatedUser,
      user: params.buyer,
      creatorVault: creatorVaultPda(params.creator),
      tokenProgram: TOKEN_2022_PROGRAM_ID,
    })
    .remainingAccounts([
      {
        pubkey: bondingCurveV2Pda(params.mint),
        isWritable: false,
        isSigner: false,
      },
    ])
    .instruction();

  instructions.push(buyIx);

  return { instructions, tokenAmount };
}

export interface SellParams {
  mint: PublicKey;
  seller: PublicKey;
  tokenAmount: BN;
}

export async function buildSellIxs(
  params: SellParams,
): Promise<TransactionInstruction[]> {
  const sdk = getOnlineSdk();
  const global = await sdk.fetchGlobal();
  const feeConfig = await sdk.fetchFeeConfig();

  let sellState:
    | { bondingCurveAccountInfo: any; bondingCurve: any; tokenProgram: PublicKey }
    | null = null;
  let lastErr: any = null;

  for (const tokenProgram of [TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID]) {
    try {
      const { bondingCurveAccountInfo, bondingCurve } = await sdk.fetchSellState(
        params.mint,
        params.seller,
        tokenProgram,
      );
      sellState = { bondingCurveAccountInfo, bondingCurve, tokenProgram };
      break;
    } catch (err: any) {
      lastErr = err;
    }
  }

  if (!sellState) throw lastErr || new Error('Unable to fetch sell state for token');

  const solAmount = getSellSolAmountFromTokenAmount({
    global,
    feeConfig,
    mintSupply: sellState.bondingCurve.tokenTotalSupply,
    bondingCurve: sellState.bondingCurve,
    amount: params.tokenAmount,
  });

  const instructions = await PUMP_SDK.sellInstructions({
    global,
    bondingCurveAccountInfo: sellState.bondingCurveAccountInfo,
    bondingCurve: sellState.bondingCurve,
    mint: params.mint,
    user: params.seller,
    amount: params.tokenAmount,
    solAmount,
    slippage: 5,
    tokenProgram: sellState.tokenProgram,
    mayhemMode: false,
  });

  return instructions;
}

export async function fetchGlobalState() {
  const sdk = getOnlineSdk();
  return {
    global: await sdk.fetchGlobal(),
    feeConfig: await sdk.fetchFeeConfig(),
  };
}

export function buildVersionedTx(
  payer: PublicKey,
  instructions: TransactionInstruction[],
  blockhash: string,
  lookupTables?: import('@solana/web3.js').AddressLookupTableAccount[],
  computeUnits = 600_000,
): VersionedTransaction {
  const computeIxs = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 200_000 }),
  ];

  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions: [...computeIxs, ...instructions],
  }).compileToV0Message(lookupTables || []);

  return new VersionedTransaction(message);
}
