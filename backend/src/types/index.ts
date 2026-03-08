export interface LaunchRecord {
  id: string;
  tokenName: string;
  tokenSymbol: string;
  mintAddress?: string;
  imageUrl?: string;
  status: 'pending' | 'running' | 'confirmed' | 'error';
  signature?: string;
  error?: string;
  createdAt: string;
  /** Stored for relaunch — full params used to create this launch */
  params?: LaunchParams & { mintAddressMode?: string; vanityMintPublicKey?: string };
}

export type SSECallback = (data: { stage: string; message: string; [k: string]: unknown }) => void;

export interface LaunchParams {
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
  autoSellAfterLaunch: boolean;
  devWalletId?: string;
  bundleWalletIds?: (string | null)[];
  holderWalletIds?: (string | null)[];
}
