import { useEffect, useState, useRef, useCallback } from 'react'
import axios from 'axios'
import { ArrowPathIcon, ClipboardDocumentIcon } from '@heroicons/react/24/outline'

const BALANCE_INTERVAL = 30_000
const PRICE_INTERVAL = 60_000

interface MarketCoin {
  price: number
  change24h: number
}
interface MarketData {
  sol: MarketCoin
  btc: MarketCoin
  eth: MarketCoin
}

const EMPTY_MARKET: MarketData = {
  sol: { price: 0, change24h: 0 },
  btc: { price: 0, change24h: 0 },
  eth: { price: 0, change24h: 0 },
}

export default function Header() {
  const [fundingBalance, setFundingBalance] = useState<number | null>(null)
  const [fundingAddress, setFundingAddress] = useState<string>('')
  const [market, setMarket] = useState<MarketData>(EMPTY_MARKET)
  const [copied, setCopied] = useState(false)
  const balanceTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const priceTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchBalance = useCallback((forceRefresh = false) => {
    const url = forceRefresh ? '/api/wallets/funding?refresh=1' : '/api/wallets/funding'
    axios.get(url).then(res => {
      setFundingBalance(res.data.balance)
      setFundingAddress(res.data.publicKey || '')
    }).catch(() => {})
  }, [])

  const fetchPrices = useCallback(async () => {
    try {
      const res = await fetch(
        'https://api.coingecko.com/api/v3/simple/price?ids=solana,bitcoin,ethereum&vs_currencies=usd&include_24hr_change=true',
      )
      const d = await res.json()
      setMarket({
        sol: { price: d.solana?.usd || 0, change24h: d.solana?.usd_24h_change || 0 },
        btc: { price: d.bitcoin?.usd || 0, change24h: d.bitcoin?.usd_24h_change || 0 },
        eth: { price: d.ethereum?.usd || 0, change24h: d.ethereum?.usd_24h_change || 0 },
      })
    } catch {}
  }, [])

  useEffect(() => {
    fetchBalance()
    fetchPrices()
    balanceTimer.current = setInterval(fetchBalance, BALANCE_INTERVAL)
    priceTimer.current = setInterval(fetchPrices, PRICE_INTERVAL)
    return () => {
      if (balanceTimer.current) clearInterval(balanceTimer.current)
      if (priceTimer.current) clearInterval(priceTimer.current)
    }
  }, [fetchBalance, fetchPrices])

  const shortAddr = fundingAddress
    ? `${fundingAddress.slice(0, 4)}...${fundingAddress.slice(-4)}`
    : '---'

  const handleCopy = () => {
    if (!fundingAddress) return
    navigator.clipboard.writeText(fundingAddress)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const fmtPrice = (n: number) =>
    n >= 1000 ? `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : `$${n.toFixed(2)}`

  const fmtChange = (n: number) => {
    const sign = n >= 0 ? '+' : ''
    return `${sign}${n.toFixed(1)}%`
  }

  const coins: { id: keyof MarketData; label: string; icon: string; highlight?: boolean }[] = [
    { id: 'btc', label: 'BTC', icon: '/image/icons/btc_logo.svg' },
    { id: 'eth', label: 'ETH', icon: '/image/icons/eth-logo.svg' },
    { id: 'sol', label: 'SOL', icon: '/image/icons/sol_logo.svg', highlight: true },
  ]

  return (
    <header className="top-header">
      {/* Left: market prices */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {coins.map(c => {
          const d = market[c.id]
          const isUp = d.change24h >= 0
          return (
            <div key={c.id} style={{
              display: 'flex', alignItems: 'center', gap: 4, fontSize: 10,
              padding: c.highlight ? '2px 8px' : '2px 4px',
              borderRadius: 6,
              background: c.highlight ? 'rgba(99,102,241,0.08)' : 'transparent',
              border: c.highlight ? '1px solid rgba(99,102,241,0.15)' : 'none',
            }}>
              <img src={c.icon} alt={c.label} style={{ width: 12, height: 12 }} />
              <span style={{ color: '#64748b', fontWeight: 600 }}>{c.label}</span>
              <span className="font-mono" style={{ color: '#e2e8f0', fontWeight: 600 }}>
                {d.price ? fmtPrice(d.price) : '--'}
              </span>
              {d.price > 0 && (
                <span className="font-mono" style={{ color: isUp ? '#34d399' : '#fb7185', fontSize: 9 }}>
                  {fmtChange(d.change24h)}
                </span>
              )}
            </div>
          )
        })}
      </div>

      {/* Right: funding wallet + GitHub */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <a
          href="https://github.com/TrenchyDev/trenchy-pumpfun-launcher-bundler-dashboard-react"
          target="_blank"
          rel="noopener noreferrer"
          title="GitHub"
          style={{ display: 'flex', alignItems: 'center', color: '#64748b', transition: 'color 0.15s' }}
          onMouseEnter={e => (e.currentTarget.style.color = '#94a3b8')}
          onMouseLeave={e => (e.currentTarget.style.color = '#64748b')}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
          </svg>
        </a>
        <div style={{ width: 1, height: 14, background: 'rgba(37,51,70,0.6)' }} />
        <span style={{ fontSize: 10, color: '#64748b' }}>Funding</span>
        <span className="font-mono" style={{ fontSize: 11, color: '#94a3b8', cursor: 'pointer' }}
          onClick={handleCopy} title={copied ? 'Copied!' : 'Click to copy address'}>
          {shortAddr}
        </span>
        {copied && <span style={{ fontSize: 9, color: '#34d399' }}>Copied</span>}
        <ClipboardDocumentIcon
          style={{ width: 13, height: 13, color: '#475569', cursor: 'pointer' }}
          onClick={handleCopy}
        />
        <div style={{ width: 1, height: 14, background: 'rgba(37,51,70,0.6)' }} />
        <span className="font-mono" style={{
          fontSize: 12, fontWeight: 700,
          color: '#14b8a6', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 4,
        }} onClick={() => fetchBalance(true)} title="Click to refresh (forces new RPC connection)">
          <img src="/image/icons/sol_logo.svg" alt="SOL" style={{ width: 14, height: 14 }} />
          {fundingBalance !== null ? `${fundingBalance.toFixed(4)} SOL` : '---'}
        </span>
        <ArrowPathIcon
          style={{ width: 13, height: 13, color: '#475569', cursor: 'pointer' }}
          onClick={() => fetchBalance(true)}
          title="Refresh balance"
        />
      </div>
    </header>
  )
}
