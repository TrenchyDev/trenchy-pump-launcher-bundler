import type { LiveTrade } from '../../types'
import { fmtSol, fmtTokens } from '../../types'

interface Props {
  trades: LiveTrade[]
  totalCount: number
  hideOurs: boolean
  onToggleHideOurs: (hide: boolean) => void
  liveError: string
  externalVolume: { buys: number; sells: number }
  ourPnl: { buys: number; sells: number; profit: number; count: number }
  emptyMessage: string
}

const fmtMcap = (n: number | null) => {
  if (!n) return '-'
  const usd = n * 170
  return usd >= 1_000_000 ? `$${(usd / 1_000_000).toFixed(1)}M` : usd >= 1000 ? `$${(usd / 1000).toFixed(1)}K` : `$${usd.toFixed(0)}`
}

const timeAgo = (ts: number) => {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  return `${Math.floor(s / 3600)}h`
}

export default function LiveTradesPanel({
  trades, totalCount, hideOurs, onToggleHideOurs,
  liveError, externalVolume, ourPnl, emptyMessage,
}: Props) {
  return (
    <div className="card-flat" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '8px 10px', borderBottom: '1px solid rgba(37,51,70,0.5)', background: 'rgba(11,17,24,0.6)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div className="pulse-dot" style={{ width: 5, height: 5 }} />
            <span style={{ fontSize: 11, fontWeight: 700, color: '#fff' }}>Live Trades</span>
            <span style={{ fontSize: 10, color: '#475569' }}>{totalCount}</span>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input type="checkbox" checked={hideOurs} onChange={e => onToggleHideOurs(e.target.checked)} style={{ accentColor: '#14b8a6' }} />
            <span style={{ fontSize: 9, color: '#64748b' }}>Hide ours</span>
          </label>
        </div>
        <div style={{ display: 'flex', gap: 12, fontSize: 10 }}>
          <div>
            <span style={{ color: '#fbbf24', fontWeight: 600 }}>Ext: </span>
            <span style={{ color: '#34d399' }}>+{externalVolume.buys.toFixed(2)}</span>
            {' / '}<span style={{ color: '#fb7185' }}>-{externalVolume.sells.toFixed(2)}</span>
          </div>
          <div>
            <span style={{ color: '#a78bfa', fontWeight: 600 }}>Ours: </span>
            <span style={{ fontWeight: 700, color: ourPnl.profit > 0 ? '#34d399' : ourPnl.profit < 0 ? '#fb7185' : '#94a3b8' }}>
              {ourPnl.profit >= 0 ? '+' : ''}{ourPnl.profit.toFixed(3)} SOL
            </span>
          </div>
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', maxHeight: 310 }}>
        {liveError && <div style={{ padding: '10px 12px', fontSize: 11, color: '#fb7185', background: 'rgba(244,63,94,0.06)' }}>{liveError}</div>}
        {trades.length === 0 && !liveError && (
          <div style={{ padding: 24, textAlign: 'center', color: '#475569', fontSize: 12 }}>{emptyMessage}</div>
        )}
        {trades.map((t, i) => (
          <div key={t.signature + i} style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', fontSize: 11,
            borderBottom: '1px solid rgba(37,51,70,0.25)',
            background: t.isOurWallet ? 'rgba(99,102,241,0.06)' : 'transparent',
          }}>
            <span style={{
              padding: '1px 5px', borderRadius: 4, fontSize: 9, fontWeight: 700,
              background: t.type === 'buy' ? 'rgba(16,185,129,0.15)' : 'rgba(244,63,94,0.15)',
              color: t.type === 'buy' ? '#34d399' : '#fb7185',
              minWidth: 26, textAlign: 'center', textTransform: 'uppercase',
            }}>{t.type}</span>
            {t.isOurWallet && (() => {
              const wt = t.walletType || ''
              const label = t.walletLabel || ''
              let short = 'US'
              let bg = 'rgba(99,102,241,0.15)'
              let fg = '#818cf8'
              if (wt === 'dev') { short = 'D'; bg = 'rgba(129,140,248,0.15)'; fg = '#818cf8' }
              else if (wt === 'bundle') {
                const m = label.match(/Bundle\s*(\d+)/i)
                short = m ? `B${m[1]}` : 'B'
                bg = 'rgba(52,211,153,0.15)'; fg = '#34d399'
              } else if (wt === 'sniper') { short = 'S'; bg = 'rgba(244,114,182,0.15)'; fg = '#f472b6' }
              else if (wt === 'holder') { short = 'H'; bg = 'rgba(251,191,36,0.15)'; fg = '#fbbf24' }
              return (
                <span style={{ padding: '1px 4px', borderRadius: 3, fontSize: 8, fontWeight: 700, background: bg, color: fg, minWidth: 14, textAlign: 'center' }}>
                  {short}
                </span>
              )
            })()}
            <span className="font-mono" style={{ fontWeight: 600, color: '#e2e8f0', minWidth: 48, textAlign: 'right' }}>{fmtSol(t.solAmount)}</span>
            <span style={{ color: '#475569', fontSize: 9 }}>SOL</span>
            <span className="font-mono" style={{ color: '#64748b', flex: 1, textAlign: 'right', fontSize: 10 }}>{fmtTokens(t.tokenAmount)}</span>
            <span style={{ color: '#475569', fontSize: 9, minWidth: 40, textAlign: 'right' }}>{fmtMcap(t.marketCapSol)}</span>
            <span className="font-mono" style={{ color: '#475569', fontSize: 9 }}>{t.traderShort}</span>
            <span style={{ color: '#334155', fontSize: 9, minWidth: 18, textAlign: 'right' }}>{timeAgo(t.timestamp)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
