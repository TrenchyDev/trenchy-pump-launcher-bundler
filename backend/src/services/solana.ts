import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
  LAMPORTS_PER_SOL,
  SendTransactionError,
} from '@solana/web3.js';
import bs58 from 'bs58';

let connection: Connection | null = null;

export function getConnection(): Connection {
  if (!connection) {
    const endpoint = process.env.RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com';
    connection = new Connection(endpoint, 'confirmed');
  }
  return connection;
}

export function getFundingKeypair(): Keypair {
  const key = process.env.FUNDING_PRIVATE_KEY;
  if (!key) throw new Error('FUNDING_PRIVATE_KEY not set in .env');
  return Keypair.fromSecretKey(bs58.decode(key));
}

export async function getBalance(pubkey: PublicKey): Promise<number> {
  const conn = getConnection();
  const lamports = await conn.getBalance(pubkey);
  return lamports / LAMPORTS_PER_SOL;
}

export async function transferSol(
  from: Keypair,
  to: PublicKey,
  solAmount: number,
  opts?: { maxRetries?: number },
): Promise<string> {
  const conn = getConnection();
  const lamports = Math.round(solAmount * LAMPORTS_PER_SOL);
  const maxRetries = opts?.maxRetries ?? 3;

  const { blockhash } = await conn.getLatestBlockhash('confirmed');
  const message = new TransactionMessage({
    payerKey: from.publicKey,
    recentBlockhash: blockhash,
    instructions: [
      SystemProgram.transfer({
        fromPubkey: from.publicKey,
        toPubkey: to,
        lamports,
      }),
    ],
  }).compileToV0Message();

  const tx = new VersionedTransaction(message);
  tx.sign([from]);

  let lastErr: Error | null = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const sig = await conn.sendTransaction(tx, {
        skipPreflight: true,
        maxRetries: 5,
      });
      await conn.confirmTransaction(sig, 'confirmed');
      return sig;
    } catch (err: unknown) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      let extra = '';
      if (err instanceof SendTransactionError && err.getLogs) {
        try {
          const logs = await err.getLogs(conn);
          if (logs?.length) extra = ` | Logs: ${logs.slice(0, 5).join('; ')}`;
        } catch {}
      }
      if (attempt < maxRetries) {
        const delay = Math.min(attempt * 800, 2500);
        await new Promise(r => setTimeout(r, delay));
      } else {
        throw new Error(
          `Transfer ${solAmount} SOL failed after ${maxRetries} attempts: ${lastErr.message}${extra}`,
        );
      }
    }
  }
  throw lastErr || new Error('Transfer failed');
}

export async function executeTransaction(
  tx: VersionedTransaction,
  signers: Keypair[],
): Promise<string> {
  const conn = getConnection();
  tx.sign(signers);
  const sig = await conn.sendTransaction(tx, { skipPreflight: true });
  await conn.confirmTransaction(sig, 'confirmed');
  return sig;
}

export async function sendRawTransaction(serialized: Buffer): Promise<string> {
  const conn = getConnection();
  const sig = await conn.sendRawTransaction(serialized, {
    skipPreflight: true,
    maxRetries: 3,
  });
  return sig;
}
