import type { AllLaunch } from '../../types'

interface Props {
  launches: AllLaunch[]
  selectedMint: string
  onSelect: (mint: string) => void
  onDelete: (id: string) => void
}

export default function LaunchHistory({ launches, selectedMint, onSelect, onDelete }: Props) {
  if (launches.length === 0) return null
  return (
    <div style={{ marginTop: 24 }}>
      <h3 style={{ fontSize: 14, fontWeight: 700, color: '#fff', marginBottom: 10 }}>Launch History</h3>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {launches.map(l => {
          const isActive = l.mintAddress === selectedMint
          const statusColor = l.status === 'confirmed' ? '#34d399' : l.status === 'error' ? '#fb7185' : '#fbbf24'
          return (
            <div key={l.id} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 12px', borderRadius: 8,
              background: isActive ? 'rgba(99,102,241,0.1)' : 'rgba(15,23,42,0.5)',
              border: isActive ? '1px solid rgba(99,102,241,0.3)' : '1px solid rgba(37,51,70,0.4)',
              cursor: l.mintAddress ? 'pointer' : 'default',
              transition: 'all 0.15s',
              maxWidth: 280,
            }} onClick={() => { if (l.mintAddress) onSelect(l.mintAddress) }}>
              {l.imageUrl ? (
                <img src={l.imageUrl} alt="" style={{ width: 28, height: 28, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }} />
              ) : (
                <div style={{ width: 28, height: 28, borderRadius: 6, background: '#1e293b', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#475569' }}>
                  {l.tokenSymbol?.[0] || '?'}
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#e2e8f0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {l.tokenName}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9 }}>
                  <span style={{ color: '#64748b' }}>${l.tokenSymbol}</span>
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: statusColor, display: 'inline-block' }} />
                  <span style={{ color: '#475569' }}>{new Date(l.createdAt).toLocaleDateString()}</span>
                </div>
              </div>
              <button
                onClick={e => { e.stopPropagation(); onDelete(l.id) }}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px',
                  color: '#475569', fontSize: 14, lineHeight: 1,
                  transition: 'color 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.color = '#fb7185')}
                onMouseLeave={e => (e.currentTarget.style.color = '#475569')}
                title="Delete from history"
              >&times;</button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
