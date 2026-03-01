import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import axios from 'axios'
import { ArrowTopRightOnSquareIcon, ArrowPathIcon } from '@heroicons/react/24/outline'

interface Launch {
  id: string; tokenName: string; tokenSymbol: string
  mintAddress?: string; imageUrl?: string; status: string; createdAt: string; error?: string
}
interface AllLaunch extends Launch {}
interface WalletBalance {
  id: string; publicKey: string; type: string; label: string
  solBalance: number; tokenBalance: number; tokenRaw: string
}
interface LiveTrade {
  signature: string; mint: string; type: string; trader: string; traderShort: string
  solAmount: number; tokenAmount: number; marketCapSol: number | null
  timestamp: number; isOurWallet: boolean; walletType: string | null
  walletLabel: string | null
}
interface RapidSellSummary {
  totalWallets: number; confirmed: number; sent: number; skipped: number; errors: number
}

interface LaunchStage {
  stage: string
  message: string
  status: 'pending' | 'active' | 'done' | 'error'
}

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
  const [buyInputs, setBuyInputs] = useState<Record<string, string>>({})
  const [rapidSelling, setRapidSelling] = useState(false)
  const [rapidSellSummary, setRapidSellSummary] = useState<RapidSellSummary | null>(null)
  const [rapidSellErrors, setRapidSellErrors] = useState<string[]>([])
  const [collectingFees, setCollectingFees] = useState(false)
  const [collectFeesMsg, setCollectFeesMsg] = useState('')
  const [creatorFeesAvailable, setCreatorFeesAvailable] = useState<number | null>(null)
  const [devSolForFees, setDevSolForFees] = useState<number | null>(null)
  const [closingOut, setClosingOut] = useState(false)
  const [closeoutResult, setCloseoutResult] = useState<{ fees: number; recovered: number; errors: number } | null>(null)
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

  const handleManualBuy = async (walletId: string) => {
    const val = parseFloat(buyInputs[walletId] || '')
    if (!val || val <= 0) return
    await handleWalletBuy(walletId, val)
    setBuyInputs(prev => ({ ...prev, [walletId]: '' }))
  }

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

  const TOTAL_SUPPLY = 1_000_000_000
  const fmtSol = (n: number) => n >= 100 ? n.toFixed(1) : n >= 1 ? n.toFixed(2) : n.toFixed(4)
  const fmtTokens = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : n.toFixed(0)
  const fmtPct = (tokens: number) => {
    const pct = (tokens / TOTAL_SUPPLY) * 100
    return pct >= 10 ? pct.toFixed(1) : pct >= 0.01 ? pct.toFixed(2) : pct > 0 ? pct.toFixed(3) : '0'
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

  const BADGE_COLORS: Record<string, string> = {
    dev: '#818cf8',
    bundle: '#34d399',
    sniper: '#f472b6',
    holder: '#fbbf24',
    funding: '#60a5fa',
  }

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

        {activeMint && (
          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
            {([
              {
                label: 'Pump.fun',
                url: `https://pump.fun/coin/${activeMint}`,
                icon: <img src="/image/icons/Pump_fun_logo.png" alt="" style={{ width: 13, height: 13, objectFit: 'contain' }} />,
                color: '#9ae65c',
              },
              {
                label: 'GMGN',
                url: `https://gmgn.ai/sol/token/${activeMint}`,
                icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="#60a5fa" strokeWidth="2"/><path d="M12 6v6l4 2" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round"/></svg>,
                color: '#60a5fa',
              },
              {
                label: 'Solscan',
                url: `https://solscan.io/token/${activeMint}`,
                icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="3" stroke="#a78bfa" strokeWidth="2"/><path d="M8 12h8M12 8v8" stroke="#a78bfa" strokeWidth="2" strokeLinecap="round"/></svg>,
                color: '#a78bfa',
              },
              {
                label: 'Birdeye',
                url: `https://birdeye.so/token/${activeMint}?chain=solana`,
                icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="#34d399" strokeWidth="2"/><circle cx="12" cy="10" r="3" stroke="#34d399" strokeWidth="2"/><path d="M6 19c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke="#34d399" strokeWidth="2" strokeLinecap="round"/></svg>,
                color: '#34d399',
              },
              {
                label: 'DexScreener',
                url: `https://dexscreener.com/solana/${activeMint}`,
                icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M3 20l5-7 4 4 9-11" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>,
                color: '#fbbf24',
              },
            ] as const).map(link => (
              <a key={link.label} href={link.url} target="_blank" rel="noopener noreferrer"
                style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  padding: '4px 8px', borderRadius: 6, textDecoration: 'none',
                  fontSize: 10, fontWeight: 600, color: link.color,
                  background: 'rgba(15,23,42,0.5)', border: '1px solid rgba(37,51,70,0.4)',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(37,51,70,0.5)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(15,23,42,0.5)' }}>
                {link.icon}
                {link.label}
                <ArrowTopRightOnSquareIcon style={{ width: 10, height: 10, opacity: 0.4 }} />
              </a>
            ))}
          </div>
        )}
      </div>

      {/* Compact status bar — single 36px row, priority: launch > closeout > result */}
      {(() => {
        const hasLaunch = launchStages.length > 0 || launchError || launchResult
        const hasCloseout = showCloseoutButton
        const hasResult = !!closeoutResult

        if (!hasLaunch && !hasCloseout && !hasResult) return null

        const activeStage = launchStages.find(s => s.status === 'active')
        const lastDone = [...launchStages].reverse().find(s => s.status === 'done')
        const doneCount = launchStages.filter(s => s.status === 'done').length

        let bg = 'rgba(15,23,42,0.4)'
        let border = 'rgba(37,51,70,0.4)'
        if (hasLaunch) {
          if (launchError) { bg = 'rgba(244,63,94,0.06)'; border = 'rgba(244,63,94,0.15)' }
          else if (launchResult) { bg = 'rgba(52,211,153,0.06)'; border = 'rgba(52,211,153,0.15)' }
          else { bg = 'rgba(99,102,241,0.06)'; border = 'rgba(99,102,241,0.15)' }
        } else if (hasCloseout) {
          bg = 'rgba(16,185,129,0.06)'; border = 'rgba(16,185,129,0.2)'
        } else if (hasResult) {
          bg = closeoutResult!.recovered > 0 || closeoutResult!.fees > 0 ? 'rgba(16,185,129,0.06)' : 'rgba(100,116,139,0.06)'
          border = closeoutResult!.recovered > 0 || closeoutResult!.fees > 0 ? 'rgba(16,185,129,0.2)' : 'rgba(100,116,139,0.2)'
        }

        return (
          <div style={{
            marginBottom: 10, padding: '0 12px', height: 36, borderRadius: 8,
            background: bg, border: `1px solid ${border}`,
            display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, overflow: 'hidden',
          }}>
            {hasLaunch ? (
              <>
                {/* Indicator dot */}
                {launchError ? (
                  <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#fb7185', flexShrink: 0 }} />
                ) : launchResult ? (
                  <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#34d399', flexShrink: 0 }} />
                ) : (
                  <div style={{ width: 10, height: 10, border: '2px solid #818cf8', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />
                )}

                {/* Status text */}
                <span style={{ fontWeight: 700, color: launchError ? '#fb7185' : launchResult ? '#34d399' : '#818cf8', flexShrink: 0 }}>
                  {launchResult ? 'Launched' : launchError ? 'Failed' : 'Launching'}
                </span>

                {/* Stage info */}
                <span style={{ color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                  {launchError
                    ? launchError
                    : launchResult
                      ? <><span className="font-mono">{launchResult.mint.slice(0, 8)}...{launchResult.mint.slice(-4)}</span>
                          <a href={`https://pump.fun/coin/${launchResult.mint}`} target="_blank" rel="noopener noreferrer"
                            style={{ color: '#14b8a6', textDecoration: 'underline', marginLeft: 8 }}>Pump.fun</a></>
                      : activeStage
                        ? <>{doneCount > 0 && <span style={{ color: '#475569', marginRight: 6 }}>{doneCount} done</span>}{activeStage.message}</>
                        : lastDone?.message || '...'
                  }
                </span>

                {/* Dismiss */}
                {(launchResult || launchError) && (
                  <button className="btn-ghost" style={{ fontSize: 9, padding: '2px 6px', flexShrink: 0 }}
                    onClick={() => { setLaunchStages([]); setLaunchError(null); setLaunchResult(null); setActiveLaunchId(null) }}>
                    Dismiss
                  </button>
                )}
              </>
            ) : hasCloseout ? (
              <>
                <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#34d399', flexShrink: 0 }} />
                <span style={{ fontWeight: 700, color: '#34d399', flexShrink: 0 }}>95%+ sold</span>
                <span style={{ color: '#94a3b8', flex: 1 }}>Collect creator fees and recover SOL → funding</span>
                <button style={{
                  fontSize: 10, fontWeight: 700, padding: '4px 12px', borderRadius: 6, flexShrink: 0,
                  border: '1px solid rgba(20,184,166,0.3)', background: 'rgba(20,184,166,0.12)', color: '#14b8a6',
                  cursor: closingOut ? 'not-allowed' : 'pointer',
                }}
                  disabled={closingOut}
                  onClick={handleCollectFeesAndRecover}>
                  {closingOut ? 'Collecting...' : 'Collect & Recover'}
                </button>
              </>
            ) : hasResult && closeoutResult ? (
              <>
                <div style={{ width: 7, height: 7, borderRadius: '50%', background: closeoutResult.recovered > 0 || closeoutResult.fees > 0 ? '#34d399' : '#94a3b8', flexShrink: 0 }} />
                <span style={{ color: '#94a3b8', flex: 1 }}>
                  {closeoutResult.fees > 0 && `Fees: ${closeoutResult.fees.toFixed(6)} SOL · `}
                  Recovered: {closeoutResult.recovered.toFixed(6)} SOL
                  {closeoutResult.errors > 0 && ` (${closeoutResult.errors} failed)`}
                </span>
                <button className="btn-ghost" style={{ fontSize: 9, padding: '2px 6px', flexShrink: 0 }}
                  onClick={() => setCloseoutResult(null)}>Dismiss</button>
              </>
            ) : null}
          </div>
        )
      })()}

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

        {/* Live Trades */}
        <div className="card-flat" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '8px 10px', borderBottom: '1px solid rgba(37,51,70,0.5)', background: 'rgba(11,17,24,0.6)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div className="pulse-dot" style={{ width: 5, height: 5 }} />
                <span style={{ fontSize: 11, fontWeight: 700, color: '#fff' }}>Live Trades</span>
                <span style={{ fontSize: 10, color: '#475569' }}>{liveTrades.length}</span>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                <input type="checkbox" checked={hideOurs} onChange={e => setHideOurs(e.target.checked)} style={{ accentColor: '#14b8a6' }} />
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
            {filteredTrades.length === 0 && !liveError && (
              <div style={{ padding: 24, textAlign: 'center', color: '#475569', fontSize: 12 }}>
                {activeMint ? 'Waiting for trades...' : activeLaunchId && !launchResult ? 'Launch in progress...' : 'Select a token'}
              </div>
            )}
            {filteredTrades.map((t, i) => (
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

        {/* Row 2: Bulk Sell controls */}
        {walletBalances.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
            <span style={{
              fontSize: 10, fontWeight: 800, color: '#fb7185', textTransform: 'uppercase', letterSpacing: 1,
              padding: '3px 10px', borderRadius: 4, background: 'rgba(244,63,94,0.1)', border: '1px solid rgba(244,63,94,0.2)',
              alignSelf: 'center', lineHeight: '16px',
            }}>
              SELL
            </span>
            {([
              { key: 'all', label: 'All', types: undefined as string[] | undefined, color: '#e2e8f0' },
              { key: 'dev', label: 'Dev', types: ['dev'], color: BADGE_COLORS.dev },
              { key: 'bundle', label: 'Bundle', types: ['bundle'], color: BADGE_COLORS.bundle },
              { key: 'sniper', label: 'Sniper', types: ['sniper'], color: BADGE_COLORS.sniper },
              { key: 'holder', label: 'Holder', types: ['holder'], color: BADGE_COLORS.holder },
            ] as const).map(group => {
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
                      onClick={() => handleRapidSell(pct, group.types as string[] | undefined)}
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

            {/* Sell results inline */}
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
        )}
        {rapidSellErrors.length > 0 && (
          <div style={{ marginTop: 4, fontSize: 9, color: '#fb7185', lineHeight: 1.4 }}>
            {rapidSellErrors.map((e, i) => <span key={i} style={{ marginRight: 8 }}>{e}</span>)}
          </div>
        )}
      </div>

      {/* ── Wallet Grid (full width) ── */}
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
        {sortedWallets.map(w => {
          const hasTokens = w.tokenBalance > 0
          const isSelling = sellingWalletId === w.id
          const badgeColor = BADGE_COLORS[w.type] || '#94a3b8'
          return (
            <div key={w.id} className="card" style={{
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
                      const disabled = busy || w.solBalance < amt
                      return (
                        <button key={amt} disabled={disabled}
                          onClick={() => handleWalletBuy(w.id, amt)}
                          style={{
                            padding: '4px 0', fontSize: 9, fontWeight: 700, borderRadius: 4,
                            border: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
                            background: 'rgba(16,185,129,0.12)', color: '#34d399',
                            opacity: disabled ? 0.35 : 1, transition: 'background 0.15s',
                          }}
                          onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = 'rgba(16,185,129,0.3)' }}
                          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(16,185,129,0.12)' }}>
                          {busy ? '...' : `${amt}`}
                        </button>
                      )
                    })}
                  </div>
                  <div style={{ display: 'flex', gap: 3 }}>
                    <input type="number" step="0.01" min="0"
                      placeholder="SOL"
                      value={buyInputs[w.id] || ''}
                      onChange={e => setBuyInputs(prev => ({ ...prev, [w.id]: e.target.value }))}
                      onKeyDown={e => { if (e.key === 'Enter') handleManualBuy(w.id) }}
                      style={{
                        flex: 1, minWidth: 0, padding: '4px 6px', fontSize: 10,
                        background: 'rgba(15,23,42,0.5)', border: '1px solid rgba(37,51,70,0.5)',
                        borderRadius: 4, color: '#e2e8f0', outline: 'none',
                      }} />
                    <button
                      disabled={buyingKey === `${w.id}-manual` || !buyInputs[w.id]}
                      onClick={() => handleManualBuy(w.id)}
                      style={{
                        padding: '4px 10px', fontSize: 9, fontWeight: 700, borderRadius: 4,
                        border: 'none', cursor: !buyInputs[w.id] ? 'not-allowed' : 'pointer',
                        background: 'rgba(16,185,129,0.2)', color: '#34d399',
                        opacity: !buyInputs[w.id] ? 0.4 : 1, transition: 'background 0.15s',
                      }}
                      onMouseEnter={e => { if (buyInputs[w.id]) e.currentTarget.style.background = 'rgba(16,185,129,0.35)' }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'rgba(16,185,129,0.2)' }}>
                      Buy
                    </button>
                  </div>
                </div>
              )}

              {/* Sell buttons */}
              {hasTokens && (
                <div>
                  <div style={{ fontSize: 9, color: '#64748b', marginBottom: 3, fontWeight: 600 }}>SELL</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 3 }}>
                    {[25, 50, 100].map(pct => (
                      <button key={pct}
                        disabled={isSelling}
                        onClick={() => handleWalletSell(w.id, pct)}
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
                <div style={{ fontSize: 9, color: '#475569', textAlign: 'center', padding: '4px 0' }}>
                  Empty
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Launch History */}
      {allLaunches.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: '#fff', marginBottom: 10 }}>Launch History</h3>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {allLaunches.map(l => {
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
                }} onClick={() => { if (l.mintAddress) { setSelectedMint(l.mintAddress); setMintInput('') } }}>
                  {/* Token image */}
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
                  {/* Delete button */}
                  <button
                    onClick={e => { e.stopPropagation(); handleDeleteLaunch(l.id) }}
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
      )}
    </div>
  )
}
