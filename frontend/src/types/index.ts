export interface Launch {
  id: string
  tokenName: string
  tokenSymbol: string
  mintAddress?: string
  imageUrl?: string
  status: string
  createdAt: string
  error?: string
}

export type AllLaunch = Launch

export interface WalletBalance {
  id: string
  publicKey: string
  type: string
  label: string
  solBalance: number
  tokenBalance: number
  tokenRaw: string
}

export interface LiveTrade {
  signature: string
  mint: string
  type: string
  trader: string
  traderShort: string
  solAmount: number
  tokenAmount: number
  marketCapSol: number | null
  timestamp: number
  isOurWallet: boolean
  walletType: string | null
  walletLabel: string | null
}

export interface RapidSellSummary {
  totalWallets: number
  confirmed: number
  sent: number
  skipped: number
  errors: number
}

export interface LaunchStage {
  stage: string
  message: string
  status: 'pending' | 'active' | 'done' | 'error'
}

export interface CloseoutResult {
  fees: number
  recovered: number
  errors: number
}

export const TOTAL_SUPPLY = 1_000_000_000

export const fmtSol = (n: number) => n >= 100 ? n.toFixed(1) : n >= 1 ? n.toFixed(2) : n.toFixed(4)
export const fmtTokens = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : n.toFixed(0)
export const fmtPct = (tokens: number) => {
  const pct = (tokens / TOTAL_SUPPLY) * 100
  return pct >= 10 ? pct.toFixed(1) : pct >= 0.01 ? pct.toFixed(2) : pct > 0 ? pct.toFixed(3) : '0'
}

export const BADGE_COLORS: Record<string, string> = {
  dev: '#818cf8',
  bundle: '#34d399',
  sniper: '#f472b6',
  holder: '#fbbf24',
  funding: '#60a5fa',
}
