import type { WalletBalance, RapidSellSummary } from '../../types'
import { BADGE_COLORS } from '../../types'

interface Props {
  walletBalances: WalletBalance[]
  walletCounts: Record<string, { count: number; withTokens: number }>
  rapidSelling: boolean
  sellGroup: string | null
  rapidSellSummary: RapidSellSummary | null
  rapidSellErrors: string[]
  activeMint: string
  onRapidSell: (pct: number, walletTypes?: string[]) => void
}

const GROUPS = [
  { key: 'all', label: 'All', types: undefined as string[] | undefined, color: '#e2e8f0' },
  { key: 'dev', label: 'Dev', types: ['dev'], color: BADGE_COLORS.dev },
  { key: 'bundle', label: 'Bundle', types: ['bundle'], color: BADGE_COLORS.bundle },
  { key: 'sniper', label: 'Sniper', types: ['sniper'], color: BADGE_COLORS.sniper },
  { key: 'holder', label: 'Holder', types: ['holder'], color: BADGE_COLORS.holder },
] as const

export default function BulkSellBar({
  walletBalances, walletCounts, rapidSelling, sellGroup,
  rapidSellSummary, rapidSellErrors, activeMint, onRapidSell,
}: Props) {
  if (walletBalances.length === 0) return null
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        <span style={{
          fontSize: 10, fontWeight: 800, color: '#fb7185', textTransform: 'uppercase', letterSpacing: 1,
          padding: '3px 10px', borderRadius: 4, background: 'rgba(244,63,94,0.1)', border: '1px solid rgba(244,63,94,0.2)',
          alignSelf: 'center', lineHeight: '16px',
        }}>
          SELL
        </span>
        {GROUPS.map(group => {
          const isGroupSelling = rapidSelling && sellGroup === (group.types ? group.types.join(',') : 'all')
          const count = group.types
            ? group.types.reduce((s, t) => s + (walletCounts[t]?.withTokens || 0), 0)
            : walletBalances.filter(w => w.tokenBalance > 0).length
          return (
            <div key={group.key} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: 9, fontWeight: 700, color: group.color, textTransform: 'uppercase', letterSpacing: 0.5, minWidth: 36 }}>
                {group.label}
              </span>
              {[25, 50, 75, 100].map(pct => (
                <button key={pct}
                  disabled={rapidSelling || !activeMint || count === 0}
                  onClick={() => onRapidSell(pct, group.types as string[] | undefined)}
                  style={{
                    padding: '3px 8px', fontSize: 9, fontWeight: 700, borderRadius: 4,
                    border: 'none',
                    cursor: (rapidSelling || !activeMint || count === 0) ? 'not-allowed' : 'pointer',
                    background: pct === 100 ? 'rgba(244,63,94,0.18)' : 'rgba(244,63,94,0.08)',
                    color: '#fb7185',
                    opacity: (rapidSelling || !activeMint || count === 0) ? 0.3 : 1,
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => { if (!rapidSelling && activeMint && count > 0) e.currentTarget.style.background = 'rgba(244,63,94,0.32)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = pct === 100 ? 'rgba(244,63,94,0.18)' : 'rgba(244,63,94,0.08)' }}>
                  {isGroupSelling ? '...' : `${pct}%`}
                </button>
              ))}
            </div>
          )
        })}

        {rapidSellSummary && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: '#94a3b8',
            padding: '3px 8px', borderRadius: 5, background: 'rgba(15,23,42,0.4)', border: '1px solid rgba(37,51,70,0.4)',
          }}>
            <span style={{ color: '#34d399' }}>OK {rapidSellSummary.confirmed}</span>
            <span>Sent {rapidSellSummary.sent}</span>
            <span>Skip {rapidSellSummary.skipped}</span>
            {rapidSellSummary.errors > 0 && <span style={{ color: '#fb7185' }}>Err {rapidSellSummary.errors}</span>}
          </div>
        )}
      </div>
      {rapidSellErrors.length > 0 && (
        <div style={{ marginTop: 4, fontSize: 9, color: '#fb7185', lineHeight: 1.4 }}>
          {rapidSellErrors.map((e, i) => <span key={i} style={{ marginRight: 8 }}>{e}</span>)}
        </div>
      )}
    </div>
  )
}
