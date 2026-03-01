import { useState } from 'react'
import type { WalletBalance } from '../../types'
import { BADGE_COLORS, fmtSol, fmtTokens, fmtPct } from '../../types'

interface Props {
  wallet: WalletBalance
  isSelling: boolean
  buyingKey: string | null
  onSell: (walletId: string, pct: number) => void
  onBuy: (walletId: string, solAmount: number) => void
}

export default function WalletCard({ wallet: w, isSelling, buyingKey, onSell, onBuy }: Props) {
  const [buyInput, setBuyInput] = useState('')
  const hasTokens = w.tokenBalance > 0
  const badgeColor = BADGE_COLORS[w.type] || '#94a3b8'

  return (
    <div className="card" style={{
      padding: 12,
      border: hasTokens ? '1px solid rgba(251,191,36,0.2)' : '1px solid rgba(37,51,70,0.4)',
      opacity: isSelling ? 0.6 : 1,
      transition: 'all 0.15s',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{
          padding: '2px 8px', borderRadius: 4, fontSize: 9, fontWeight: 700,
          textTransform: 'uppercase', letterSpacing: 0.5,
          background: `${badgeColor}20`, color: badgeColor,
        }}>{w.type}</span>
        <span className="font-mono" style={{ fontSize: 10, color: '#64748b', cursor: 'pointer' }}
          title={w.publicKey}
          onClick={() => navigator.clipboard.writeText(w.publicKey)}
          role="button" tabIndex={0}>
          {w.publicKey.slice(0, 4)}...{w.publicKey.slice(-4)}
        </span>
      </div>

      {/* Label */}
      <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {w.label}
      </div>

      {/* Balances */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
          <span style={{ fontSize: 10, color: '#64748b' }}>SOL</span>
          <span className="font-mono" style={{ fontSize: 12, fontWeight: 700, color: '#34d399' }}>{fmtSol(w.solBalance)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ fontSize: 10, color: '#64748b' }}>Tokens</span>
          <span style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
            <span className="font-mono" style={{
              fontSize: 12, fontWeight: 700,
              color: hasTokens ? '#fbbf24' : '#475569',
            }}>{fmtTokens(w.tokenBalance)}</span>
            {hasTokens && <span className="font-mono" style={{ fontSize: 9, color: '#c084fc' }}>{fmtPct(w.tokenBalance)}%</span>}
          </span>
        </div>
      </div>

      {/* Buy section */}
      {w.solBalance > 0.001 && (
        <div style={{ marginBottom: hasTokens ? 6 : 0 }}>
          <div style={{ fontSize: 9, color: '#64748b', marginBottom: 3, fontWeight: 600 }}>BUY</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 3, marginBottom: 4 }}>
            {[0.1, 0.25, 0.5].map(amt => {
              const k = `${w.id}-${amt}`
              const busy = buyingKey === k
              return (
                <button key={amt}
                  disabled={busy || !!buyingKey}
                  onClick={() => onBuy(w.id, amt)}
                  style={{
                    padding: '3px 0', fontSize: 9, fontWeight: 700, borderRadius: 4,
                    border: 'none', cursor: busy ? 'wait' : 'pointer',
                    background: 'rgba(16,185,129,0.1)', color: '#34d399',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(16,185,129,0.25)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'rgba(16,185,129,0.1)')}>
                  {busy ? '...' : `${amt}`}
                </button>
              )
            })}
          </div>
          <div style={{ display: 'flex', gap: 3 }}>
            <input type="number" step="0.01" min="0" placeholder="SOL"
              value={buyInput}
              onChange={e => setBuyInput(e.target.value)}
              style={{
                flex: 1, padding: '3px 6px', fontSize: 10, borderRadius: 4,
                background: 'rgba(15,23,42,0.6)', border: '1px solid rgba(37,51,70,0.5)',
                color: '#e2e8f0', outline: 'none', minWidth: 0,
              }}
              onKeyDown={e => { if (e.key === 'Enter') { const v = parseFloat(buyInput); if (v > 0) { onBuy(w.id, v); setBuyInput('') } } }}
            />
            <button
              disabled={!buyInput || parseFloat(buyInput) <= 0 || !!buyingKey}
              onClick={() => { const v = parseFloat(buyInput); if (v > 0) { onBuy(w.id, v); setBuyInput('') } }}
              style={{
                padding: '3px 8px', fontSize: 9, fontWeight: 700, borderRadius: 4,
                border: 'none', cursor: 'pointer',
                background: 'rgba(16,185,129,0.15)', color: '#34d399',
              }}>Buy</button>
          </div>
        </div>
      )}

      {/* Sell buttons */}
      {hasTokens && (
        <div>
          <div style={{ fontSize: 9, color: '#64748b', marginBottom: 3, fontWeight: 600 }}>SELL</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 3 }}>
            {[25, 50, 75, 100].map(pct => (
              <button key={pct}
                disabled={isSelling}
                onClick={() => onSell(w.id, pct)}
                style={{
                  padding: '4px 0', fontSize: 9, fontWeight: 700, borderRadius: 4,
                  border: 'none', cursor: isSelling ? 'wait' : 'pointer',
                  background: pct === 100 ? 'rgba(244,63,94,0.2)' : 'rgba(244,63,94,0.1)',
                  color: '#fb7185',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(244,63,94,0.35)')}
                onMouseLeave={e => (e.currentTarget.style.background = pct === 100 ? 'rgba(244,63,94,0.2)' : 'rgba(244,63,94,0.1)')}>
                {isSelling ? '...' : `${pct}%`}
              </button>
            ))}
          </div>
        </div>
      )}

      {!hasTokens && w.solBalance < 0.001 && (
        <div style={{ fontSize: 9, color: '#475569', textAlign: 'center', padding: '4px 0' }}>Empty</div>
      )}
    </div>
  )
}
