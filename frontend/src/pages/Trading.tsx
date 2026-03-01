import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import axios from 'axios'
import { ArrowPathIcon } from '@heroicons/react/24/outline'
import type { Launch, AllLaunch, WalletBalance, LiveTrade, RapidSellSummary, LaunchStage, CloseoutResult } from '../types'
import { fmtSol, fmtTokens, fmtPct, BADGE_COLORS } from '../types'
import ExternalLinks from '../components/ui/ExternalLinks'
import StatusBar from '../components/ui/StatusBar'
import LiveTradesPanel from '../components/ui/LiveTradesPanel'
import BulkSellBar from '../components/ui/BulkSellBar'
import WalletCard from '../components/ui/WalletCard'
import LaunchHistory from '../components/ui/LaunchHistory'

export default function Trading() {
  const location = useLocation()
  const incomingLaunch = (location.state as { launchId?: string; holderAutoBuy?: boolean } | null)

  const [launches, setLaunches] = useState<Launch[]>([])
  const [allLaunches, setAllLaunches] = useState<AllLaunch[]>([])
  const [selectedMint, setSelectedMint] = useState('')
  const [mintInput, setMintInput] = useState('')
  const [walletBalances, setWalletBalances] = useState<WalletBalance[]>([])
  const [loadingBalances, setLoadingBalances] = useState(false)
  const [sellingWalletId, setSellingWalletId] = useState<string | null>(null)
  const [buyingKey, setBuyingKey] = useState<string | null>(null)
  // buyInputs moved into WalletCard component
  const [rapidSelling, setRapidSelling] = useState(false)
  const [rapidSellSummary, setRapidSellSummary] = useState<RapidSellSummary | null>(null)
  const [rapidSellErrors, setRapidSellErrors] = useState<string[]>([])
  const [collectingFees, setCollectingFees] = useState(false)
  const [collectFeesMsg, setCollectFeesMsg] = useState('')
  const [creatorFeesAvailable, setCreatorFeesAvailable] = useState<number | null>(null)
  const [devSolForFees, setDevSolForFees] = useState<number | null>(null)
  const [closingOut, setClosingOut] = useState(false)
  const [closeoutResult, setCloseoutResult] = useState<CloseoutResult | null>(null)
  const [liveTrades, setLiveTrades] = useState<LiveTrade[]>([])
  const [liveError, setLiveError] = useState('')
  const [hideOurs, setHideOurs] = useState(false)
  const esRef = useRef<EventSource | null>(null)
  const [maxTotalTokensByMint, setMaxTotalTokensByMint] = useState<Record<string, number>>({})

  const [launchStages, setLaunchStages] = useState<LaunchStage[]>([])
  const [launchError, setLaunchError] = useState<string | null>(null)
  const [launchResult, setLaunchResult] = useState<{ signature: string; mint: string } | null>(null)
  const [activeLaunchId, setActiveLaunchId] = useState<string | null>(null)
  const launchEsRef = useRef<EventSource | null>(null)
  const refreshAfterLaunchRef = useRef<() => void>(() => {})
  const launchInProgressRef = useRef(false)

  useEffect(() => {
    if (!incomingLaunch?.launchId || activeLaunchId) return
    const lid = incomingLaunch.launchId
    setActiveLaunchId(lid)
    setLaunchStages([])
    setLaunchError(null)
    setLaunchResult(null)
    setSelectedMint('')
    setMintInput('')
    setWalletBalances([])
    setLiveTrades([])
    launchInProgressRef.current = true

    const es = new EventSource(`/api/launch/${lid}/stream`)
    launchEsRef.current = es

    es.onmessage = (event) => {
      const data = JSON.parse(event.data)
      if (data.stage === 'done') {
        launchInProgressRef.current = false
        setLaunchResult({ signature: data.signature, mint: data.mint })
        setLaunchStages(prev => prev.map(s => s.status === 'active' ? { ...s, status: 'done' } : s))
        if (data.mint) {
          setSelectedMint(data.mint)
          setMintInput('')
        }
        refreshAfterLaunchRef.current()
        if (!incomingLaunch?.holderAutoBuy) {
          es.close()
          launchEsRef.current = null
        }
        return
      }
      if (data.stage === 'holder-done') {
        launchInProgressRef.current = false
        setLaunchStages(prev => prev.map(s => s.status === 'active' ? { ...s, status: 'done' } : s))
        es.close()
        launchEsRef.current = null
        return
      }
      if (data.stage === 'error') {
        launchInProgressRef.current = false
        setLaunchError(data.message)
        setLaunchStages(prev => prev.map(s => s.status === 'active' ? { ...s, status: 'error' } : s))
        es.close()
        launchEsRef.current = null
        return
      }
      setLaunchStages(prev => {
        const updated = prev.map(s => s.status === 'active' ? { ...s, status: 'done' as const } : s)
        return [...updated, { stage: data.stage, message: data.message, status: 'active' }]
      })
    }

    es.onerror = () => {
      launchInProgressRef.current = false
      setLaunchError('Connection to launch stream lost')
      es.close()
      launchEsRef.current = null
    }

    // Clear location state so a page refresh doesn't re-connect
    window.history.replaceState({}, '')

    return () => { es.close() }
  }, [incomingLaunch?.launchId])

  const selectedLaunch = launches.find(l => l.mintAddress === selectedMint)
  const activeMint = selectedMint || mintInput
  const prevNewestRef = useRef<string | null>(null)
  const selectedMintRef = useRef(selectedMint)
  selectedMintRef.current = selectedMint

  // Fetch launches
  const fetchLaunches = useCallback(async () => {
    const res = await axios.get('/api/launch')
    const all: AllLaunch[] = res.data
    setAllLaunches(all)
    // API returns newest-first; pick the first confirmed as newest
    const confirmed = all.filter(
      (l: Launch) => l.status === 'confirmed' && l.mintAddress,
    )
    setLaunches(confirmed)

    if (confirmed.length > 0 && !launchInProgressRef.current) {
      const newest = confirmed[0]
      const cur = selectedMintRef.current
      if (!cur || (prevNewestRef.current && prevNewestRef.current !== newest.mintAddress)) {
        setSelectedMint(newest.mintAddress!)
        setMintInput('')
      }
      prevNewestRef.current = newest.mintAddress!
    }
  }, [])

  useEffect(() => { fetchLaunches() }, [fetchLaunches])
  refreshAfterLaunchRef.current = fetchLaunches

  // Poll for new launches every 10s (detects when a new launch completes)
  useEffect(() => {
    const timer = setInterval(fetchLaunches, 10_000)
    return () => clearInterval(timer)
  }, [fetchLaunches])

  // Fetch wallet balances when mint changes
  const fetchBalances = useCallback(async () => {
    const mint = selectedMint || mintInput
    if (!mint || mint.length < 32) { setWalletBalances([]); return }
    // If we have a selectedMint (from our launches) but launches haven't loaded yet,
    // wait — otherwise we'd fetch with no launchId and get ALL wallets
    const launch = launches.find(l => l.mintAddress === mint)
    if (selectedMint && launches.length === 0) return
    setLoadingBalances(true)
    try {
      const res = await axios.post('/api/wallets/balances', {
        mint,
        launchId: launch?.id,
      })
      setWalletBalances(res.data)
    } catch { setWalletBalances([]) }
    finally { setLoadingBalances(false) }
  }, [selectedMint, mintInput, launches])

  useEffect(() => { fetchBalances() }, [fetchBalances])

  // Load max total tokens from localStorage (persists across refresh)
  useEffect(() => {
    try {
      const stored = localStorage.getItem('pump-launcher:maxTokens')
      if (stored) setMaxTotalTokensByMint(JSON.parse(stored))
    } catch {}
  }, [])

  // Auto-refresh wallet balances every 30s
  useEffect(() => {
    const timer = setInterval(() => { fetchBalances() }, 30_000)
    return () => clearInterval(timer)
  }, [fetchBalances])

  // Live trades SSE
  useEffect(() => {
    const mint = selectedMint || mintInput
    if (!mint || mint.length < 32) {
      if (esRef.current) { esRef.current.close(); esRef.current = null }
      setLiveTrades([]); setLiveError(''); return
    }
    if (esRef.current) esRef.current.close()
    setLiveTrades([]); setLiveError('')

    const es = new EventSource(`/api/live-trades?mint=${mint}`)
    esRef.current = es
    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.type === 'error') setLiveError(data.error)
        else if (data.type === 'initial' && data.trades) {
          setLiveTrades(data.trades.sort((a: LiveTrade, b: LiveTrade) => b.timestamp - a.timestamp))
          setLiveError('')
        } else if (data.type === 'trade' && data.trade) {
          setLiveTrades(prev => {
            const incoming = data.trade as LiveTrade
            // Only block duplicate buys from injected launch trades — let sells through
            if (incoming.type === 'buy' && !incoming.signature.startsWith('launch:')) {
              const hasInjectedBuy = prev.some((t: LiveTrade) =>
                t.signature.startsWith('launch:') && t.trader === incoming.trader && t.type === 'buy'
              )
              if (hasInjectedBuy) return prev
            }
            const updated = [incoming, ...prev.filter((t: LiveTrade) => t.signature !== incoming.signature)]
            return updated.sort((a: LiveTrade, b: LiveTrade) => b.timestamp - a.timestamp).slice(0, 100)
          })
          setLiveError('')
        }
      } catch {}
    }
    es.onerror = () => setLiveError('Live trades connection lost — reconnecting...')
    return () => { es.close() }
  }, [selectedMint, mintInput])

  // Per-wallet sell
  const handleWalletSell = async (walletId: string, pct: number) => {
    const mint = activeMint
    if (!mint) return
    setSellingWalletId(walletId)
    try {
      await axios.post('/api/trading/rapid-sell', {
        mint,
        percentage: pct,
        walletIds: [walletId],
        launchId: selectedLaunch?.id,
        parallel: true,
      })
      await fetchBalances()
    } catch (err: any) { console.error(err) }
    finally { setSellingWalletId(null) }
  }

  // Rapid sell (all or by wallet types)
  const [sellGroup, setSellGroup] = useState<string | null>(null)
  const handleRapidSell = async (pct: number, walletTypes?: string[]) => {
    if (!activeMint) return
    const groupKey = walletTypes ? walletTypes.join(',') : 'all'
    setSellGroup(groupKey); setRapidSelling(true); setRapidSellSummary(null); setRapidSellErrors([])
    try {
      const res = await axios.post('/api/trading/rapid-sell', {
        mint: activeMint,
        percentage: pct,
        launchId: selectedLaunch?.id,
        parallel: true,
        ...(walletTypes ? { walletTypes } : {}),
      })
      setRapidSellSummary(res.data?.summary || null)
      const errs = (res.data?.results || [])
        .filter((r: any) => r.status === 'error' && r.error)
        .map((r: any) => `${r.wallet.slice(0, 6)}...: ${r.error}`)
      setRapidSellErrors(errs.slice(0, 5))
      await fetchBalances()
    } catch (err: any) { console.error(err) }
    finally { setRapidSelling(false); setSellGroup(null) }
  }

  // Per-wallet buy (SOL amount)
  const handleWalletBuy = async (walletId: string, solAmount: number) => {
    const mint = activeMint
    if (!mint || solAmount <= 0) return
    const key = `${walletId}-${solAmount}`
    setBuyingKey(key)
    try {
      await axios.post('/api/trading/execute', {
        type: 'buy',
        mint,
        walletId,
        amount: solAmount,
      })
      await fetchBalances()
    } catch (err: any) { console.error(err) }
    finally { setBuyingKey(null) }
  }

  // handleManualBuy moved into WalletCard component

  const fetchCreatorFeesAvailable = useCallback(async () => {
    if (!selectedLaunch?.id) { setCreatorFeesAvailable(null); setDevSolForFees(null); return }
    try {
      const res = await axios.get(`/api/trading/creator-fees-available?launchId=${selectedLaunch.id}`)
      setCreatorFeesAvailable(Number(res.data.availableSol ?? 0))
      setDevSolForFees(Number(res.data.devSol ?? 0))
    } catch {
      setCreatorFeesAvailable(null)
      setDevSolForFees(null)
    }
  }, [selectedLaunch?.id])

  useEffect(() => {
    fetchCreatorFeesAvailable()
    if (!selectedLaunch?.id) return
    const t = setInterval(fetchCreatorFeesAvailable, 30_000)
    return () => clearInterval(t)
  }, [fetchCreatorFeesAvailable, selectedLaunch?.id])

  const needsFunding = devSolForFees !== null && devSolForFees < 0.000008
  const handleCollectCreatorFees = async () => {
    if (!selectedLaunch?.id) return
    setCollectingFees(true); setCollectFeesMsg('')
    try {
      const res = await axios.post('/api/trading/collect-creator-fees', { launchId: selectedLaunch.id })
      if (res.data?.status === 'confirmed') {
        const collected = Number(res.data.collectedSol || 0).toFixed(6)
        const swept = Number(res.data.sweptSol || 0)
        const funded = res.data.fundedFromFunding
        let msg = `Collected ${collected} SOL`
        if (swept > 0) msg += ` → ${swept.toFixed(6)} SOL swept to funding`
        if (funded) msg += ' (funded via funding wallet)'
        setCollectFeesMsg(msg)
        fetchCreatorFeesAvailable()
      } else {
        setCollectFeesMsg(res.data?.reason || 'No creator fees to collect')
        fetchCreatorFeesAvailable()
      }
    } catch (err: unknown) {
      setCollectFeesMsg((err as { response?: { data?: { error?: string }; status?: number }; message?: string }).response?.data?.error || (err as { message?: string }).message || 'Failed')
    } finally { setCollectingFees(false) }
  }

  const handleCollectFeesAndRecover = async () => {
    if (!activeMint || !walletBalances.length) return
    if (!confirm('Collect creator fees and recover all SOL from this launch\'s wallets back to funding?')) return
    setClosingOut(true)
    setCloseoutResult(null)
    let feesCollected = 0
    let totalRecovered = 0
    let errors = 0
    try {
      if (selectedLaunch?.id) {
        try {
          const feeRes = await axios.post('/api/trading/collect-creator-fees', { launchId: selectedLaunch.id })
          if (feeRes.data?.status === 'confirmed') {
            feesCollected = Number(feeRes.data.collectedSol || 0)
          }
        } catch { /* ignore */ }
      }
      const gatherRes = await axios.post('/api/wallets/gather', {
        launchId: selectedLaunch?.id || undefined,
      })
      totalRecovered = gatherRes.data?.totalRecovered || 0
      errors = (gatherRes.data?.wallets || []).filter((w: { error?: string }) => w.error).length
      setCloseoutResult({ fees: feesCollected, recovered: totalRecovered, errors })
      await fetchBalances()
    } catch (err: any) {
      setCloseoutResult({ fees: feesCollected, recovered: totalRecovered, errors: 1 })
    } finally { setClosingOut(false) }
  }

  const handleDeleteLaunch = async (id: string) => {
    if (!confirm('Delete this launch from history?')) return
    try {
      await axios.delete(`/api/launch/${id}`)
      await fetchLaunches()
    } catch (err: any) { console.error(err) }
  }

  const externalVolume = useMemo(() => {
    const ext = liveTrades.filter(t => !t.isOurWallet)
    let buys = 0, sells = 0
    ext.forEach(t => { if (t.type === 'buy') buys += t.solAmount; else sells += t.solAmount })
    return { buys, sells, net: buys - sells, count: ext.length }
  }, [liveTrades])

  const ourPnl = useMemo(() => {
    const ours = liveTrades.filter(t => t.isOurWallet)
    let buys = 0, sells = 0
    ours.forEach(t => { if (t.type === 'buy') buys += t.solAmount; else sells += t.solAmount })
    return { buys, sells, profit: sells - buys, count: ours.length }
  }, [liveTrades])

  const filteredTrades = hideOurs ? liveTrades.filter(t => !t.isOurWallet) : liveTrades

  // fmtSol, fmtTokens, fmtPct, BADGE_COLORS imported from ../types

  const sortedWallets = useMemo(() => {
    const order: Record<string, number> = { dev: 0, bundle: 1, sniper: 2, holder: 3 }
    return [...walletBalances].sort((a, b) => (order[a.type] ?? 9) - (order[b.type] ?? 9))
  }, [walletBalances])

  const walletCounts = useMemo(() => {
    const counts: Record<string, { count: number; withTokens: number }> = {}
    for (const w of walletBalances) {
      if (!counts[w.type]) counts[w.type] = { count: 0, withTokens: 0 }
      counts[w.type].count++
      if (w.tokenBalance > 0) counts[w.type].withTokens++
    }
    return counts
  }, [walletBalances])

  const totalTokens = walletBalances.reduce((s, w) => s + w.tokenBalance, 0)
  const totalSol = walletBalances.reduce((s, w) => s + w.solBalance, 0)

  // Update max total tokens for 95% sold detection (persist to localStorage)
  useEffect(() => {
    if (!activeMint || !walletBalances.length) return
    setMaxTotalTokensByMint(prev => {
      const max = prev[activeMint] ?? 0
      const newMax = Math.max(max, totalTokens)
      if (newMax <= max) return prev
      const next = { ...prev, [activeMint]: newMax }
      try { localStorage.setItem('pump-launcher:maxTokens', JSON.stringify(next)) } catch {}
      return next
    })
  }, [activeMint, walletBalances.length, totalTokens])

  const maxTotalTokens = maxTotalTokensByMint[activeMint] ?? 0
  const showCloseoutButton = activeMint && walletBalances.length > 0 && (
    (totalTokens === 0 && maxTotalTokens > 0) || (maxTotalTokens > 0 && totalTokens <= 0.05 * maxTotalTokens)
  )

  return (
    <div className="fade-up">
      {/* Current token profile + mint input */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        {selectedLaunch ? (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px',
            borderRadius: 10, background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)',
            flexShrink: 0,
          }}>
            {selectedLaunch.imageUrl ? (
              <img src={selectedLaunch.imageUrl} alt="" style={{ width: 32, height: 32, borderRadius: 8, objectFit: 'cover' }} />
            ) : (
              <div style={{ width: 32, height: 32, borderRadius: 8, background: '#1e293b', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: '#475569' }}>
                {selectedLaunch.tokenSymbol?.[0] || '?'}
              </div>
            )}
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0', lineHeight: 1.2 }}>
                {selectedLaunch.tokenName}
                <span style={{ fontSize: 10, color: '#64748b', fontWeight: 500, marginLeft: 6 }}>${selectedLaunch.tokenSymbol}</span>
              </div>
              <div className="font-mono" style={{ fontSize: 10, color: '#64748b', cursor: 'pointer' }}
                onClick={() => navigator.clipboard.writeText(selectedLaunch.mintAddress || '')}
                title="Click to copy">
                {selectedLaunch.mintAddress?.slice(0, 8)}...{selectedLaunch.mintAddress?.slice(-6)}
              </div>
            </div>
          </div>
        ) : activeMint ? (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px',
            borderRadius: 10, background: 'rgba(15,23,42,0.5)', border: '1px solid rgba(37,51,70,0.4)',
            flexShrink: 0,
          }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: '#1e293b', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: '#475569' }}>?</div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8' }}>External Token</div>
              <div className="font-mono" style={{ fontSize: 10, color: '#64748b' }}>{activeMint.slice(0, 8)}...{activeMint.slice(-6)}</div>
            </div>
          </div>
        ) : activeLaunchId && !launchResult ? (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px',
            borderRadius: 10, background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.15)',
            flexShrink: 0,
          }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: '#1e293b', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ width: 14, height: 14, border: '2px solid #818cf8', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#818cf8' }}>Launching token...</div>
              <div style={{ fontSize: 10, color: '#64748b' }}>Mint address will appear when ready</div>
            </div>
          </div>
        ) : null}

        <div style={{ flex: 1, minWidth: 200 }}>
          <input className="input font-mono" style={{ fontSize: 11, padding: '8px 12px' }}
            placeholder="Or paste any mint address..."
            value={mintInput || (selectedMint && !mintInput ? selectedMint : '')}
            onChange={e => {
              const v = e.target.value
              setMintInput(v)
              if (v.length >= 32) setSelectedMint('')
              else if (v === '') {
                // Cleared input — revert to newest launch
                const newest = launches[launches.length - 1]
                if (newest?.mintAddress) { setSelectedMint(newest.mintAddress) }
              }
            }}
            onFocus={e => {
              if (selectedMint && !mintInput) {
                setMintInput(selectedMint)
                setTimeout(() => e.target.select(), 0)
              }
            }}
            onBlur={() => {
              if (mintInput === selectedMint) setMintInput('')
            }}
          />
        </div>

        <ExternalLinks mint={activeMint} />
      </div>

      <StatusBar
        launchStages={launchStages}
        launchError={launchError}
        launchResult={launchResult}
        showCloseoutButton={!!showCloseoutButton}
        closingOut={closingOut}
        closeoutResult={closeoutResult}
        onDismissLaunch={() => { setLaunchStages([]); setLaunchError(null); setLaunchResult(null); setActiveLaunchId(null) }}
        onCollectAndRecover={handleCollectFeesAndRecover}
        onDismissCloseout={() => setCloseoutResult(null)}
      />

      {/* Top row: Chart + Live Trades */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 16, marginBottom: 16 }}>
        {/* Birdeye Chart */}
        <div className="card-flat" style={{ overflow: 'hidden' }}>
          <div style={{ padding: '6px 12px', borderBottom: '1px solid rgba(37,51,70,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8' }}>Price Chart</span>
            {selectedLaunch && (
              <span style={{ fontWeight: 600, color: '#fff', fontSize: 13 }}>
                {selectedLaunch.tokenName} <span className="font-mono" style={{ fontSize: 11, color: '#64748b' }}>${selectedLaunch.tokenSymbol}</span>
              </span>
            )}
          </div>
          <div style={{ height: 360 }}>
            {activeMint ? (
              <iframe
                src={`https://birdeye.so/tv-widget/${activeMint}?chain=solana&viewMode=pair&chartInterval=1&chartType=CANDLE&chartTimezone=America%2FLos_Angeles&chartLeftToolbar=show&theme=dark`}
                style={{ width: '100%', height: '100%', border: 'none' }}
                allow="clipboard-write"
                sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
                title="Birdeye Chart"
              />
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#475569', fontSize: 13 }}>
                {activeLaunchId && !launchResult ? 'Waiting for launch to complete...' : 'Select or paste a token to view chart'}
              </div>
            )}
          </div>
        </div>

        <LiveTradesPanel
          trades={filteredTrades}
          totalCount={liveTrades.length}
          hideOurs={hideOurs}
          onToggleHideOurs={setHideOurs}
          liveError={liveError}
          externalVolume={externalVolume}
          ourPnl={ourPnl}
          emptyMessage={activeMint ? 'Waiting for trades...' : activeLaunchId && !launchResult ? 'Launch in progress...' : 'Select a token'}
        />
      </div>

      {/* ── Action Bar ── */}
      <div className="card-flat" style={{ padding: '10px 14px', marginBottom: 12 }}>
        {/* Row 1: Header + Portfolio + Refresh */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: walletBalances.length > 0 ? 10 : 0, flexWrap: 'wrap' }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: '#fff', margin: 0 }}>Wallets</h3>
          {walletBalances.length > 0 && (
            <>
              <div style={{ width: 1, height: 16, background: 'rgba(37,51,70,0.5)' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 11 }}>
                <span style={{ color: '#64748b' }}>{walletBalances.length} wallets</span>
                <span className="font-mono" style={{ color: '#34d399', fontWeight: 700 }}>{fmtSol(totalSol)} SOL</span>
                <span className="font-mono" style={{ color: '#fbbf24', fontWeight: 700 }}>{fmtTokens(totalTokens)} tokens</span>
                {totalTokens > 0 && <span className="font-mono" style={{ color: '#c084fc', fontWeight: 700 }}>({fmtPct(totalTokens)}%)</span>}
              </div>
              <div style={{ width: 1, height: 16, background: 'rgba(37,51,70,0.5)' }} />
              {/* Wallet type breakdown */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10 }}>
                {Object.entries(walletCounts).map(([type, c]) => (
                  <span key={type} style={{ color: BADGE_COLORS[type] || '#94a3b8', fontWeight: 600 }}>
                    {type.charAt(0).toUpperCase() + type.slice(1)} {c.count}
                    {c.withTokens > 0 && <span style={{ color: '#475569', fontWeight: 400 }}> ({c.withTokens})</span>}
                  </span>
                ))}
              </div>
            </>
          )}
          <div style={{ flex: 1 }} />
          <button className="btn-secondary" style={{ fontSize: 10, padding: '4px 12px', display: 'flex', alignItems: 'center', gap: 4 }}
            disabled={loadingBalances} onClick={fetchBalances}>
            <ArrowPathIcon style={{ width: 12, height: 12 }} />
            {loadingBalances ? 'Loading...' : 'Refresh'}
          </button>
        </div>

        {/* Creator Fees row */}
        {selectedLaunch?.id && creatorFeesAvailable !== null && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
            marginBottom: walletBalances.length > 0 ? 10 : 0,
            padding: '6px 12px', borderRadius: 8,
            background: creatorFeesAvailable > 0 ? 'rgba(52,211,153,0.06)' : 'rgba(15,23,42,0.3)',
            border: `1px solid ${creatorFeesAvailable > 0 ? 'rgba(52,211,153,0.2)' : 'rgba(37,51,70,0.3)'}`,
          }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Creator Fees
            </span>
            <span className="font-mono" style={{
              fontSize: 13, fontWeight: 800,
              color: creatorFeesAvailable > 0 ? '#34d399' : '#475569',
            }}>
              {creatorFeesAvailable > 0 ? `${creatorFeesAvailable.toFixed(6)} SOL` : 'None'}
            </span>
            <button className="btn-secondary" style={{
              fontSize: 10, padding: '4px 12px', fontWeight: 700,
              background: creatorFeesAvailable > 0
                ? (needsFunding ? 'rgba(251,191,36,0.12)' : 'rgba(52,211,153,0.12)')
                : undefined,
              borderColor: creatorFeesAvailable > 0
                ? (needsFunding ? 'rgba(251,191,36,0.25)' : 'rgba(52,211,153,0.25)')
                : undefined,
              color: creatorFeesAvailable > 0
                ? (needsFunding ? '#fbbf24' : '#34d399')
                : undefined,
            }}
              disabled={collectingFees || creatorFeesAvailable === 0}
              onClick={handleCollectCreatorFees}>
              {collectingFees
                ? (needsFunding ? 'Funding & Collecting...' : 'Collecting...')
                : (needsFunding && creatorFeesAvailable > 0
                  ? 'Collect (via Funding)'
                  : 'Collect → Funding')}
            </button>
            {collectFeesMsg && <span style={{ fontSize: 10, color: '#94a3b8' }}>{collectFeesMsg}</span>}
          </div>
        )}

        <BulkSellBar
          walletBalances={walletBalances}
          walletCounts={walletCounts}
          rapidSelling={rapidSelling}
          sellGroup={sellGroup}
          rapidSellSummary={rapidSellSummary}
          rapidSellErrors={rapidSellErrors}
          activeMint={activeMint}
          onRapidSell={handleRapidSell}
        />
      </div>

      {walletBalances.length === 0 && !loadingBalances && (
        <div className="card" style={{ textAlign: 'center', padding: 32, color: '#475569' }}>
          {activeMint ? 'No wallets found for this launch' : activeLaunchId && !launchResult ? 'Waiting for launch to complete...' : 'Select a token above to see wallets'}
        </div>
      )}

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
        gap: 10,
      }}>
        {sortedWallets.map(w => (
          <WalletCard
            key={w.id}
            wallet={w}
            isSelling={sellingWalletId === w.id}
            buyingKey={buyingKey}
            onSell={handleWalletSell}
            onBuy={handleWalletBuy}
          />
        ))}
      </div>

      <LaunchHistory
        launches={allLaunches}
        selectedMint={selectedMint}
        onSelect={(mint) => { setSelectedMint(mint); setMintInput('') }}
        onDelete={handleDeleteLaunch}
      />
    </div>
  )
}
