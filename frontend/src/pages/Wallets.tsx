import { useEffect, useState, useCallback } from 'react'
import axios from 'axios'

interface Wallet {
  id: string
  publicKey: string
  type: string
  label: string
  status: string
  createdAt: string
  launchId?: string
}

interface BalanceMap { [id: string]: number }

interface UnclaimedFee {
  launchId: string
  tokenName: string
  tokenSymbol: string
  mintAddress: string
  creator: string
  availableSol: number
  createdAt: string
}

const TYPES = ['all', 'funding', 'dev', 'bundle', 'holder', 'mint', 'manual'] as const
const BADGE_COLORS: Record<string, string> = {
  funding: 'badge-amber',
  dev: 'badge-green',
  bundle: 'badge-teal',
  holder: 'badge-gray',
  mint: 'badge-amber',
  manual: 'badge-gray',
}

export default function Wallets() {
  const [wallets, setWallets] = useState<Wallet[]>([])
  const [archivedWallets, setArchivedWallets] = useState<Wallet[]>([])
  const [showArchived, setShowArchived] = useState(false)
  const [balances, setBalances] = useState<BalanceMap>({})
  const [filter, setFilter] = useState<string>('all')
  const [genCount, setGenCount] = useState(1)
  const [genType, setGenType] = useState<string>('manual')
  const [importKey, setImportKey] = useState('')
  const [importType, setImportType] = useState<string>('manual')
  const [importLabel, setImportLabel] = useState('')
  const [copied, setCopied] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [gathering, setGathering] = useState(false)
  const [gatherResult, setGatherResult] = useState<{ total: number; count: number; errors: number } | null>(null)
  const [archiving, setArchiving] = useState(false)
  const [unclaimedFees, setUnclaimedFees] = useState<UnclaimedFee[]>([])
  const [scanningFees, setScanningFees] = useState(false)
  const [collectingAllFees, setCollectingAllFees] = useState(false)
  const [collectFeesResult, setCollectFeesResult] = useState<{ totalCollected: number; totalSwept: number; count: number; errors: number } | null>(null)
  const [closingATAs, setClosingATAs] = useState(false)
  const [closeATAsResult, setCloseATAsResult] = useState<{ totalClosed: number; totalRecoveredSol: number; walletsWithATAs: number; errors: number } | null>(null)

  const fetchWallets = useCallback(async () => {
    const params: Record<string, string> = { status: 'active' }
    if (filter !== 'all') params.type = filter
    const res = await axios.get('/api/wallets', { params })
    setWallets(res.data)
  }, [filter])

  const fetchArchivedWallets = useCallback(async () => {
    const params: Record<string, string> = { status: 'archived' }
    if (filter !== 'all') params.type = filter
    const res = await axios.get('/api/wallets', { params })
    setArchivedWallets(res.data)
  }, [filter])

  useEffect(() => { fetchWallets() }, [fetchWallets])
  useEffect(() => { if (showArchived) fetchArchivedWallets() }, [showArchived, fetchArchivedWallets])

  const refreshBalances = async () => {
    setLoading(true)
    try {
      const res = await axios.post('/api/wallets/refresh-balances', {
        ids: wallets.map(w => w.id),
      })
      const map: BalanceMap = {}
      for (const b of res.data) map[b.id] = b.balance
      setBalances(map)
    } finally { setLoading(false) }
  }

  const handleGenerate = async () => {
    await axios.post('/api/wallets/generate', {
      count: genCount,
      type: genType,
      label: genType.charAt(0).toUpperCase() + genType.slice(1),
    })
    fetchWallets()
  }

  const handleImport = async () => {
    if (!importKey.trim()) return
    await axios.post('/api/wallets/import', {
      privateKey: importKey.trim(),
      type: importType,
      label: importLabel || 'Imported',
    })
    setImportKey('')
    setImportLabel('')
    fetchWallets()
  }

  const handleArchive = async (id: string) => {
    await axios.patch(`/api/wallets/${id}/archive`)
    fetchWallets()
    if (showArchived) fetchArchivedWallets()
  }

  const handleUnarchive = async (id: string) => {
    await axios.patch(`/api/wallets/${id}/unarchive`)
    fetchArchivedWallets()
    fetchWallets()
  }

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text)
    setCopied(id)
    setTimeout(() => setCopied(null), 1500)
  }

  const revealKey = async (id: string) => {
    const res = await axios.get(`/api/wallets/${id}/private-key`)
    copyToClipboard(res.data.privateKey, `pk-${id}`)
  }

  const handleGather = async () => {
    if (!confirm('Recover ALL SOL from dev/bundle/holder/mint/manual wallets back to the funding wallet?')) return
    setGathering(true)
    setGatherResult(null)
    try {
      const res = await axios.post('/api/wallets/gather')
      const wallets = res.data.wallets as { recovered?: number; error?: string }[]
      const succeeded = wallets.filter(w => (w.recovered ?? 0) > 0).length
      const errors = wallets.filter(w => w.error).length
      setGatherResult({ total: res.data.totalRecovered, count: succeeded, errors })
      refreshBalances()
    } catch (err: unknown) {
      console.error(err)
    } finally {
      setGathering(false)
    }
  }

  const handleArchiveAll = async () => {
    const label = filter === 'all' ? 'all non-funding' : filter
    if (!confirm(`Archive ${label} wallets? (Funding wallet is never archived)`)) return
    setArchiving(true)
    try {
      await axios.post('/api/wallets/archive-all', { type: filter })
      fetchWallets()
      if (showArchived) fetchArchivedWallets()
    } catch (err: unknown) {
      console.error(err)
    } finally {
      setArchiving(false)
    }
  }

  const handleCloseTokenAccounts = async () => {
    if (!confirm('Close all token accounts in archived wallets and recover rent to funding wallet?')) return
    setClosingATAs(true)
    setCloseATAsResult(null)
    try {
      const res = await axios.post('/api/wallets/close-token-accounts')
      const { totalClosed, totalRecoveredSol, walletsWithATAs, results } = res.data
      const errors = (results as { error?: string }[]).filter(r => r.error).length
      setCloseATAsResult({ totalClosed, totalRecoveredSol, walletsWithATAs, errors })
    } catch (err: unknown) {
      console.error(err)
    } finally {
      setClosingATAs(false)
    }
  }

  const handleScanFees = async () => {
    setScanningFees(true)
    setCollectFeesResult(null)
    try {
      const res = await axios.get('/api/trading/all-unclaimed-fees')
      setUnclaimedFees((res.data as UnclaimedFee[]).filter(f => f.availableSol >= 0.005))
    } catch (err: unknown) {
      console.error(err)
    } finally {
      setScanningFees(false)
    }
  }

  const handleCollectAllFees = async () => {
    const withFees = unclaimedFees.filter(f => f.availableSol > 0)
    if (withFees.length === 0) return
    setCollectingAllFees(true)
    setCollectFeesResult(null)
    try {
      const res = await axios.post('/api/trading/collect-all-fees', {
        launchIds: withFees.map(f => f.launchId),
      })
      const { totalCollected, totalSwept, results } = res.data
      const confirmed = results.filter((r: { status: string }) => r.status === 'confirmed').length
      const errors = results.filter((r: { status: string }) => r.status === 'error').length
      setCollectFeesResult({ totalCollected, totalSwept, count: confirmed, errors })
      handleScanFees()
    } catch (err: unknown) {
      console.error(err)
    } finally {
      setCollectingAllFees(false)
    }
  }

  const renderWalletRow = (w: Wallet, isArchived: boolean) => (
    <div key={w.id} className="table-row" style={{ opacity: isArchived ? 0.7 : 1 }}>
      <div style={{ width: 80 }}>
        <span className={`badge ${BADGE_COLORS[w.type] || 'badge-gray'}`}>{w.type}</span>
      </div>
      <div className="font-mono" style={{ flex: 1, fontSize: 12, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {w.publicKey}
      </div>
      <div className="font-mono" style={{ width: 110, textAlign: 'right', fontSize: 12 }}>
        {balances[w.id] !== undefined ? `${balances[w.id].toFixed(4)} SOL` : '---'}
      </div>
      <div style={{ width: 100, textAlign: 'right', fontSize: 11, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {w.label}
      </div>
      <div style={{ width: 180, display: 'flex', justifyContent: 'flex-end', gap: 4 }}>
        <button className="btn-ghost" onClick={() => copyToClipboard(w.publicKey, w.id)}>
          {copied === w.id ? 'Copied!' : 'Copy'}
        </button>
        <button className="btn-ghost" onClick={() => revealKey(w.id)}>
          {copied === `pk-${w.id}` ? 'Copied!' : 'Key'}
        </button>
        {isArchived ? (
          <button className="btn-ghost" style={{ color: '#34d399' }}
            onClick={() => handleUnarchive(w.id)}>
            Restore
          </button>
        ) : (
          <button className="btn-ghost" style={{ color: '#fb7185' }}
            onClick={() => handleArchive(w.id)}>
            Archive
          </button>
        )}
      </div>
    </div>
  )

  return (
    <div className="fade-up">
      <div style={{ marginBottom: 24 }}>
        <h1 className="page-title">Wallets</h1>
        <p className="page-subtitle">Manage your wallet vault for launches and trading</p>
      </div>

      {/* Actions Row */}
      <div className="grid-2" style={{ marginBottom: 20 }}>
        {/* Generate */}
        <div className="card">
          <h3 className="section-title">Generate Wallets</h3>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12 }}>
            <div>
              <label className="label">Count</label>
              <input type="number" className="input" style={{ width: 70 }}
                min={1} max={50} value={genCount}
                onChange={e => setGenCount(Number(e.target.value))} />
            </div>
            <div style={{ flex: 1 }}>
              <label className="label">Type</label>
              <select className="input" value={genType}
                onChange={e => setGenType(e.target.value)}>
                <option value="manual">Manual</option>
                <option value="dev">Dev</option>
                <option value="bundle">Bundle</option>
                <option value="holder">Holder</option>
              </select>
            </div>
            <button className="btn-primary" onClick={handleGenerate}>Generate</button>
          </div>
        </div>

        {/* Import */}
        <div className="card">
          <h3 className="section-title">Import Wallet</h3>
          <div className="space-y-sm">
            <input className="input font-mono" style={{ fontSize: 12 }}
              placeholder="Base58 private key..."
              value={importKey} onChange={e => setImportKey(e.target.value)} />
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label className="label">Label</label>
                <input className="input" placeholder="Label (optional)"
                  value={importLabel} onChange={e => setImportLabel(e.target.value)} />
              </div>
              <div>
                <label className="label">Type</label>
                <select className="input" value={importType}
                  onChange={e => setImportType(e.target.value)}>
                  <option value="manual">Manual</option>
                  <option value="funding">Funding</option>
                  <option value="dev">Dev</option>
                </select>
              </div>
              <button className="btn-primary" onClick={handleImport}>Import</button>
            </div>
          </div>
        </div>
      </div>

      {/* Creator Fees Collection */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: unclaimedFees.length > 0 ? 12 : 0 }}>
          <div>
            <h3 className="section-title" style={{ marginBottom: 2 }}>Creator Fees</h3>
            <p style={{ fontSize: 11, color: '#64748b', margin: 0 }}>
              Scan all launches for unclaimed fees, collect and sweep to funding wallet
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {unclaimedFees.filter(f => f.availableSol > 0).length > 0 && (
              <button className="btn-primary" style={{ fontSize: 12, padding: '8px 16px' }}
                disabled={collectingAllFees}
                onClick={handleCollectAllFees}>
                {collectingAllFees ? 'Collecting...' : `Collect All → Funding`}
              </button>
            )}
            <button className="btn-secondary" style={{ fontSize: 12 }}
              disabled={scanningFees}
              onClick={handleScanFees}>
              {scanningFees ? 'Scanning...' : 'Scan All Launches'}
            </button>
          </div>
        </div>

        {collectFeesResult && (
          <div style={{
            padding: '8px 12px', borderRadius: 8, marginBottom: 10,
            background: collectFeesResult.totalCollected > 0 ? 'rgba(16,185,129,0.08)' : 'rgba(100,116,139,0.08)',
            border: `1px solid ${collectFeesResult.totalCollected > 0 ? 'rgba(16,185,129,0.2)' : 'rgba(100,116,139,0.2)'}`,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <span style={{ fontSize: 12, color: collectFeesResult.totalCollected > 0 ? '#34d399' : '#94a3b8' }}>
              {collectFeesResult.totalCollected > 0
                ? `Collected ${collectFeesResult.totalCollected.toFixed(6)} SOL from ${collectFeesResult.count} launch(es) — ${collectFeesResult.totalSwept.toFixed(6)} SOL swept to funding${collectFeesResult.errors > 0 ? ` (${collectFeesResult.errors} failed)` : ''}`
                : 'No fees to collect'}
            </span>
            <button className="btn-ghost" style={{ fontSize: 10 }}
              onClick={() => setCollectFeesResult(null)}>Dismiss</button>
          </div>
        )}

        {unclaimedFees.length > 0 && (
          <div style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(37,51,70,0.4)' }}>
            <div style={{
              display: 'flex', padding: '6px 12px', fontSize: 10, fontWeight: 700, color: '#64748b',
              textTransform: 'uppercase', letterSpacing: 0.5,
              background: 'rgba(15,23,42,0.4)', borderBottom: '1px solid rgba(37,51,70,0.4)',
            }}>
              <div style={{ flex: 1 }}>Token</div>
              <div style={{ width: 120, textAlign: 'right' }}>Fees Available</div>
              <div style={{ width: 80, textAlign: 'right' }}>Date</div>
            </div>
            {unclaimedFees.map(f => (
              <div key={f.launchId} style={{
                display: 'flex', alignItems: 'center', padding: '6px 12px', fontSize: 12,
                borderBottom: '1px solid rgba(37,51,70,0.2)',
                opacity: f.availableSol > 0 ? 1 : 0.4,
              }}>
                <div style={{ flex: 1 }}>
                  <span style={{ fontWeight: 600, color: '#e2e8f0' }}>{f.tokenName}</span>
                  <span style={{ color: '#64748b', marginLeft: 6, fontSize: 10 }}>${f.tokenSymbol}</span>
                  <span className="font-mono" style={{ color: '#475569', marginLeft: 8, fontSize: 9 }}>
                    {f.mintAddress.slice(0, 6)}...{f.mintAddress.slice(-4)}
                  </span>
                </div>
                <div className="font-mono" style={{
                  width: 120, textAlign: 'right', fontWeight: 700,
                  color: f.availableSol > 0 ? '#34d399' : '#475569',
                }}>
                  {f.availableSol > 0 ? `${f.availableSol.toFixed(6)} SOL` : '—'}
                </div>
                <div style={{ width: 80, textAlign: 'right', fontSize: 10, color: '#475569' }}>
                  {new Date(f.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                </div>
              </div>
            ))}
            {(() => {
              const total = unclaimedFees.reduce((s, f) => s + f.availableSol, 0)
              return total > 0 ? (
                <div style={{
                  display: 'flex', alignItems: 'center', padding: '8px 12px',
                  background: 'rgba(16,185,129,0.04)', fontSize: 12,
                }}>
                  <div style={{ flex: 1, fontWeight: 700, color: '#94a3b8' }}>Total Unclaimed</div>
                  <div className="font-mono" style={{ width: 120, textAlign: 'right', fontWeight: 800, color: '#34d399' }}>
                    {total.toFixed(6)} SOL
                  </div>
                  <div style={{ width: 80 }} />
                </div>
              ) : null
            })()}
          </div>
        )}

        {scanningFees && unclaimedFees.length === 0 && (
          <div style={{ textAlign: 'center', padding: 16, color: '#64748b', fontSize: 12 }}>
            Scanning launches for unclaimed fees...
          </div>
        )}
      </div>

      {/* Filter & Refresh */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {TYPES.map(t => (
            <button key={t}
              className={`chip${filter === t ? ' active' : ''}`}
              onClick={() => setFilter(t)}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-secondary" style={{ fontSize: 12 }}
            onClick={() => setShowArchived(!showArchived)}>
            {showArchived ? 'Hide Archived' : `Show Archived`}
          </button>
          <button className="btn-secondary" style={{ fontSize: 12 }}
            onClick={refreshBalances} disabled={loading}>
            {loading ? 'Refreshing...' : 'Refresh Balances'}
          </button>
          <button className="btn-danger" style={{ fontSize: 12, padding: '8px 16px' }}
            onClick={handleGather} disabled={gathering}>
            {gathering ? 'Recovering...' : 'Recover All SOL'}
          </button>
          <button style={{
            fontSize: 12, padding: '8px 16px', borderRadius: 8, border: '1px solid rgba(251,191,36,0.3)',
            background: 'rgba(251,191,36,0.08)', color: '#fbbf24', fontWeight: 600, cursor: 'pointer',
          }}
            onClick={handleArchiveAll} disabled={archiving || wallets.filter(w => w.type !== 'funding').length === 0}>
            {archiving ? 'Archiving...' : `Archive All${filter !== 'all' ? ` ${filter.charAt(0).toUpperCase() + filter.slice(1)}` : ''}`}
          </button>
        </div>
      </div>

      {gatherResult && (
        <div style={{
          padding: '12px 16px', borderRadius: 10, marginBottom: 16,
          background: gatherResult.total > 0 ? 'rgba(16,185,129,0.08)' : 'rgba(100,116,139,0.08)',
          border: `1px solid ${gatherResult.total > 0 ? 'rgba(16,185,129,0.2)' : 'rgba(100,116,139,0.2)'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{ fontSize: 13, color: gatherResult.total > 0 ? '#34d399' : gatherResult.errors > 0 ? '#fb7185' : '#94a3b8' }}>
            {gatherResult.total > 0
              ? `Recovered ${gatherResult.total.toFixed(6)} SOL from ${gatherResult.count} wallet(s) → Funding${gatherResult.errors > 0 ? ` (${gatherResult.errors} failed)` : ''}`
              : gatherResult.errors > 0
                ? `Recovery failed for ${gatherResult.errors} wallet(s) — check console for details`
                : 'No SOL to recover from any wallets'}
          </span>
          <button className="btn-ghost" style={{ fontSize: 11 }}
            onClick={() => setGatherResult(null)}>Dismiss</button>
        </div>
      )}

      {/* Active Wallets Table */}
      <div className="card-flat">
        <div className="table-header">
          <div style={{ width: 80 }}>Type</div>
          <div style={{ flex: 1 }}>Public Key</div>
          <div style={{ width: 110, textAlign: 'right' }}>Balance</div>
          <div style={{ width: 100, textAlign: 'right' }}>Label</div>
          <div style={{ width: 180, textAlign: 'right' }}>Actions</div>
        </div>

        {wallets.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#64748b', fontSize: 13 }}>
            No wallets yet. Generate or import one above.
          </div>
        ) : wallets.map(w => renderWalletRow(w, false))}
      </div>

      {/* Archived Wallets */}
      {showArchived && (
        <div style={{ marginTop: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: '#94a3b8', margin: 0 }}>
              Archived Wallets
              <span style={{ fontSize: 12, color: '#475569', fontWeight: 400, marginLeft: 8 }}>
                ({archivedWallets.length})
              </span>
            </h3>
            {archivedWallets.length > 0 && (
              <button style={{
                fontSize: 11, padding: '6px 14px', borderRadius: 8, fontWeight: 600, cursor: 'pointer',
                border: '1px solid rgba(168,85,247,0.3)', background: 'rgba(168,85,247,0.08)', color: '#c084fc',
              }}
                disabled={closingATAs}
                onClick={handleCloseTokenAccounts}>
                {closingATAs ? 'Closing ATAs...' : 'Close All Token Accounts → Funding'}
              </button>
            )}
          </div>

          {closeATAsResult && (
            <div style={{
              padding: '10px 14px', borderRadius: 8, marginBottom: 10,
              background: closeATAsResult.totalClosed > 0 ? 'rgba(168,85,247,0.06)' : 'rgba(100,116,139,0.06)',
              border: `1px solid ${closeATAsResult.totalClosed > 0 ? 'rgba(168,85,247,0.2)' : 'rgba(100,116,139,0.2)'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <span style={{ fontSize: 12, color: closeATAsResult.totalClosed > 0 ? '#c084fc' : '#94a3b8' }}>
                {closeATAsResult.totalClosed > 0
                  ? `Closed ${closeATAsResult.totalClosed} token account(s) across ${closeATAsResult.walletsWithATAs} wallet(s) — recovered ~${closeATAsResult.totalRecoveredSol.toFixed(6)} SOL → Funding${closeATAsResult.errors > 0 ? ` (${closeATAsResult.errors} failed)` : ''}`
                  : 'No open token accounts found in archived wallets'}
              </span>
              <button className="btn-ghost" style={{ fontSize: 10 }}
                onClick={() => setCloseATAsResult(null)}>Dismiss</button>
            </div>
          )}

          <div className="card-flat">
            <div className="table-header">
              <div style={{ width: 80 }}>Type</div>
              <div style={{ flex: 1 }}>Public Key</div>
              <div style={{ width: 110, textAlign: 'right' }}>Balance</div>
              <div style={{ width: 100, textAlign: 'right' }}>Label</div>
              <div style={{ width: 180, textAlign: 'right' }}>Actions</div>
            </div>

            {archivedWallets.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: '#475569', fontSize: 13 }}>
                No archived wallets
              </div>
            ) : archivedWallets.map(w => renderWalletRow(w, true))}
          </div>
        </div>
      )}
    </div>
  )
}
