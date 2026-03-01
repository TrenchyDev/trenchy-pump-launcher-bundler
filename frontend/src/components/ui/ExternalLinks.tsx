import { ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline'

interface Props {
  mint: string
}

const LINKS = [
  { label: 'Pump.fun', urlFn: (m: string) => `https://pump.fun/coin/${m}`, icon: '/image/icons/Pump_fun_logo.png', color: '#9ae65c' },
  { label: 'GMGN', urlFn: (m: string) => `https://gmgn.ai/sol/token/${m}`, icon: '/image/icons/GMGNicon.png', color: '#60a5fa' },
  { label: 'Solscan', urlFn: (m: string) => `https://solscan.io/token/${m}`, icon: '/image/icons/solscanicon.png', color: '#a78bfa' },
  { label: 'Birdeye', urlFn: (m: string) => `https://birdeye.so/token/${m}?chain=solana`, icon: '/image/icons/birdeyeicon.png', color: '#34d399' },
  { label: 'DexScreener', urlFn: (m: string) => `https://dexscreener.com/solana/${m}`, icon: '/image/icons/dexscreenericon.png', color: '#fbbf24' },
]

export default function ExternalLinks({ mint }: Props) {
  if (!mint) return null
  return (
    <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
      {LINKS.map(link => (
        <a key={link.label} href={link.urlFn(mint)} target="_blank" rel="noopener noreferrer"
          style={{
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '4px 8px', borderRadius: 6, textDecoration: 'none',
            fontSize: 10, fontWeight: 600, color: link.color,
            background: 'rgba(15,23,42,0.5)', border: '1px solid rgba(37,51,70,0.4)',
            transition: 'all 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(37,51,70,0.5)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(15,23,42,0.5)' }}>
          <img src={link.icon} alt="" style={{ width: 13, height: 13, objectFit: 'contain' }} />
          {link.label}
          <ArrowTopRightOnSquareIcon style={{ width: 10, height: 10, opacity: 0.4 }} />
        </a>
      ))}
    </div>
  )
}
