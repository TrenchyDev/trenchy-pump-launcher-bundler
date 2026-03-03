import { useState, useRef, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import { PhotoIcon, SparklesIcon } from '@heroicons/react/24/outline'
import Tip from '../components/ui/Tip'

interface LaunchForm {
  tokenName: string
  tokenSymbol: string
  description: string
  imageUrl: string
  website: string
  twitter: string
  telegram: string
  devBuyAmount: number
  bundleWalletCount: number
  bundleSwapAmounts: number[]
  holderWalletCount: number
  holderSwapAmounts: number[]
  holderAutoBuy: boolean
  holderAutoBuyDelay: number
  useJito: boolean
  useLUT: boolean
  strictBundle: boolean
  mintAddressMode: 'random' | 'vanity'
  vanityMintPublicKey: string
  devWalletId: string
  bundleWalletIds: (string | null)[]
  holderWalletIds: (string | null)[]
}

interface AvailableWallet {
  id: string
  publicKey: string
  type: string
  label: string
}

interface VanityPoolStatus {
  available: number
  used: number
  total: number
  generating: boolean
  stats?: { checked: number; found: number; elapsed: number; rate: number } | null
}

interface VanityAddress {
  publicKey: string
  suffix: string
  status: 'available' | 'used'
  createdAt: string
}

const fmtNum = (n: number) => {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return String(n)
}

const DEV_PRESETS = [0.1, 0.25, 0.5, 1.0, 1.5, 2.0]
const BUNDLE_PRESETS = [0.1, 0.25, 0.5, 1.0]
const HOLDER_PRESETS = [0.1, 0.25, 0.5, 1.0]

export default function Launch() {
  const navigate = useNavigate()
  const [form, setForm] = useState<LaunchForm>({
    tokenName: '',
    tokenSymbol: '',
    description: '',
    imageUrl: '',
    website: '',
    twitter: '',
    telegram: '',
    devBuyAmount: 0.5,
    bundleWalletCount: 4,
    bundleSwapAmounts: [0.5, 0.5, 0.5, 0.5],
    holderWalletCount: 0,
    holderSwapAmounts: [],
    holderAutoBuy: false,
    holderAutoBuyDelay: 0,
    useJito: true,
    useLUT: false,
    strictBundle: true,
    mintAddressMode: (localStorage.getItem('mintAddressMode') as 'random' | 'vanity') || 'random',
    vanityMintPublicKey: '',
    devWalletId: '',
    bundleWalletIds: [null, null, null, null],
    holderWalletIds: [],
  })

  const [launching, setLaunching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [fundingBalance, setFundingBalance] = useState<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [vanityPool, setVanityPool] = useState<VanityPoolStatus>({ available: 0, used: 0, total: 0, generating: false })
  const [vanityAddresses, setVanityAddresses] = useState<VanityAddress[]>([])
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiGenerating, setAiGenerating] = useState(false)
  const [aiRefFile, setAiRefFile] = useState<File | null>(null)
  const [aiRefPreview, setAiRefPreview] = useState<string | null>(null)
  const aiRefInputRef = useRef<HTMLInputElement>(null)
  const [availableWallets, setAvailableWallets] = useState<AvailableWallet[]>([])
  const [copiedMint, setCopiedMint] = useState(false)
  const [randomPreview, setRandomPreview] = useState<string | null>(null)

  useEffect(() => {
    const fetchBal = () => { axios.get('/api/wallets/funding').then(r => setFundingBalance(r.data.balance)).catch(() => {}) }
    fetchBal()
    const iv = setInterval(fetchBal, 15_000)
    return () => clearInterval(iv)
  }, [])

  useEffect(() => {
    axios.get('/api/wallets/available').then(r => setAvailableWallets(r.data)).catch(() => {})
    if (form.mintAddressMode === 'random') {
      axios.get('/api/vanity/preview-random').then(r => setRandomPreview(r.data.publicKey)).catch(() => {})
    }
  }, [])

  const fetchVanityPool = useCallback(() => {
    axios.get('/api/vanity/pool-status').then(r => setVanityPool(r.data)).catch(() => {})
    axios.get('/api/vanity/pool').then(r => {
      const addrs = (r.data.addresses || []).filter((a: VanityAddress) => a.status === 'available')
      setVanityAddresses(addrs)
      if (addrs.length > 0 && form.mintAddressMode === 'vanity') {
        updateForm({ vanityMintPublicKey: addrs[0].publicKey })
      }
    }).catch(() => {})
  }, [form.mintAddressMode])

  useEffect(() => {
    fetchVanityPool()
    const iv = setInterval(fetchVanityPool, vanityPool.generating ? 2_000 : 10_000)
    return () => clearInterval(iv)
  }, [fetchVanityPool, vanityPool.generating])

  const uploadImage = useCallback(async (file: File) => {
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('image', file)
      const res = await axios.post('/api/upload/image', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      const url = res.data.url as string
      setForm(prev => ({ ...prev, imageUrl: url }))
      setImagePreview(URL.createObjectURL(file))
    } catch (err: unknown) {
      console.error('Upload failed:', err)
    } finally {
      setUploading(false)
    }
  }, [])

  const handleFileDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file && file.type.startsWith('image/')) uploadImage(file)
  }, [uploadImage])

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) uploadImage(file)
  }, [uploadImage])

  const clearImage = () => {
    setForm(prev => ({ ...prev, imageUrl: '' }))
    setImagePreview(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const generateWithAi = useCallback(async () => {
    const prompt = aiPrompt.trim()
    if (!prompt || aiGenerating) return
    setAiGenerating(true)
    setError(null)
    try {
      const formData = new FormData()
      formData.append('prompt', prompt)
      if (aiRefFile) formData.append('image', aiRefFile)
      const res = await axios.post<{ name: string; symbol: string; description: string; imageUrl: string }>(
        '/api/ai/generate-token',
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      )
      const { name, symbol, description, imageUrl } = res.data
      updateForm({ tokenName: name, tokenSymbol: symbol, description, imageUrl })
      if (imageUrl) setImagePreview(imageUrl)
    } catch (err: unknown) {
      const msg = err && typeof err === 'object' && 'response' in err && typeof (err as any).response?.data?.error === 'string'
        ? (err as any).response.data.error
        : err instanceof Error ? err.message : 'AI generation failed'
      setError(msg)
    } finally {
      setAiGenerating(false)
    }
  }, [aiPrompt, aiGenerating, aiRefFile])

  const setAiRef = (file: File | null) => {
    if (aiRefPreview) URL.revokeObjectURL(aiRefPreview)
    setAiRefFile(file)
    setAiRefPreview(file ? URL.createObjectURL(file) : null)
  }

  const updateForm = (updates: Partial<LaunchForm>) =>
    setForm(prev => ({ ...prev, ...updates }))

  const setMintMode = (mode: 'random' | 'vanity') => {
    localStorage.setItem('mintAddressMode', mode)
    updateForm({ mintAddressMode: mode, vanityMintPublicKey: mode === 'vanity' ? (vanityAddresses[0]?.publicKey || '') : '' })
    if (mode === 'random') {
      axios.get('/api/vanity/preview-random').then(r => setRandomPreview(r.data.publicKey)).catch(() => {})
    }
  }

  const copyMintAddress = (addr: string) => {
    navigator.clipboard.writeText(addr)
    setCopiedMint(true)
    setTimeout(() => setCopiedMint(false), 1500)
  }

  const refreshRandomPreview = () => {
    axios.get('/api/vanity/preview-random').then(r => setRandomPreview(r.data.publicKey)).catch(() => {})
  }

  const startVanity = () => {
    axios.post('/api/vanity/start', { suffix: 'pump' }).then(() => fetchVanityPool()).catch(() => {})
  }

  const stopVanity = () => {
    axios.post('/api/vanity/stop').then(() => fetchVanityPool()).catch(() => {})
  }

  const fillTestLaunch = () => {
    updateForm({
      tokenName: 'Trencher Bundler',
      tokenSymbol: 'TRENCHER',
      description: 'test launch for\nhttps://github.com/dogtoshi-sz/pumpfun-bundler-launcher-react-dashboard',
      website: 'https://github.com/dogtoshi-sz/pumpfun-bundler-launcher-react-dashboard',
      twitter: 'https://github.com/dogtoshi-sz/pumpfun-bundler-launcher-react-dashboard',
      telegram: 'https://github.com/dogtoshi-sz/pumpfun-bundler-launcher-react-dashboard',
      devBuyAmount: 0.1,
      bundleWalletCount: 2,
      bundleSwapAmounts: [0.1, 0.1],
      holderWalletCount: 0,
      holderSwapAmounts: [],
    })
  }

  const setBundleCount = (count: number) => {
    const amounts = Array(count).fill(0.5)
    for (let i = 0; i < Math.min(count, form.bundleSwapAmounts.length); i++)
      amounts[i] = form.bundleSwapAmounts[i]
    const ids: (string | null)[] = Array(count).fill(null)
    for (let i = 0; i < Math.min(count, form.bundleWalletIds.length); i++)
      ids[i] = form.bundleWalletIds[i]
    const extra: Partial<LaunchForm> = { bundleWalletCount: count, bundleSwapAmounts: amounts, bundleWalletIds: ids }
    if (count > 3) extra.useLUT = true
    updateForm(extra)
  }

  const setBundleAmount = (idx: number, val: number) => {
    const amounts = [...form.bundleSwapAmounts]
    amounts[idx] = val
    updateForm({ bundleSwapAmounts: amounts })
  }

  const setHolderCount = (count: number) => {
    const amounts = Array(count).fill(0.5)
    for (let i = 0; i < Math.min(count, form.holderSwapAmounts.length); i++)
      amounts[i] = form.holderSwapAmounts[i]
    const ids: (string | null)[] = Array(count).fill(null)
    for (let i = 0; i < Math.min(count, form.holderWalletIds.length); i++)
      ids[i] = form.holderWalletIds[i]
    updateForm({ holderWalletCount: count, holderSwapAmounts: amounts, holderWalletIds: ids })
  }

  const setHolderAmount = (idx: number, val: number) => {
    const amounts = [...form.holderSwapAmounts]
    amounts[idx] = val
    updateForm({ holderSwapAmounts: amounts })
  }

  const setBundleWalletId = (idx: number, id: string | null) => {
    const ids = [...form.bundleWalletIds]
    ids[idx] = id
    updateForm({ bundleWalletIds: ids })
  }

  const setHolderWalletId = (idx: number, id: string | null) => {
    const ids = [...form.holderWalletIds]
    ids[idx] = id
    updateForm({ holderWalletIds: ids })
  }

  const selectedIds = new Set([
    form.devWalletId,
    ...form.bundleWalletIds.filter(Boolean),
    ...form.holderWalletIds.filter(Boolean),
  ].filter(Boolean))

  const walletOptions = (currentId: string | null) =>
    availableWallets.filter(w => w.id === currentId || !selectedIds.has(w.id))

  const WalletSelect = ({ value, onChange, slot }: { value: string | null; onChange: (id: string | null) => void; slot: string }) => {
    const opts = walletOptions(value)
    if (availableWallets.length === 0) return null
    return (
      <select
        className="input font-mono"
        style={{ padding: '3px 6px', fontSize: 10, maxWidth: 140, color: value ? '#a78bfa' : '#64748b' }}
        value={value || ''}
        onChange={e => onChange(e.target.value || null)}
        title={`Select wallet for ${slot}`}
      >
        <option value="">Auto</option>
        {opts.map(w => (
          <option key={w.id} value={w.id}>
            {w.label.length > 12 ? w.label.slice(0, 12) + '…' : w.label} ({w.publicKey.slice(0, 4)}…{w.publicKey.slice(-4)})
          </option>
        ))}
      </select>
    )
  }

  const tipSol = form.useJito ? 0.005 : 0
  const devOverhead = tipSol + 0.1
  const totalSol =
    form.devBuyAmount + devOverhead +
    form.bundleSwapAmounts.reduce((a, b) => a + b, 0) + form.bundleWalletCount * 0.02 +
    form.holderSwapAmounts.reduce((a, b) => a + b, 0) + form.holderWalletCount * 0.01
  const insufficientFunds = fundingBalance !== null && fundingBalance < totalSol

  const handleLaunch = async () => {
    if (!form.tokenName || !form.tokenSymbol) return
    setLaunching(true)
    setError(null)

    try {
      const payload = {
        ...form,
        devWalletId: form.devWalletId || undefined,
        bundleWalletIds: form.bundleWalletIds.some(Boolean) ? form.bundleWalletIds : undefined,
        holderWalletIds: form.holderWalletIds.some(Boolean) ? form.holderWalletIds : undefined,
      }
      const res = await axios.post('/api/launch', payload)
      const { launchId } = res.data
      navigate('/trading', { state: { launchId, holderAutoBuy: form.holderAutoBuy } })
    } catch (err: unknown) {
      const msg = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: string }; status?: number }; message?: string }).response?.data?.error
          || (err as { message?: string }).message
        : String(err)
      setError(msg || 'Launch failed')
      setLaunching(false)
    }
  }

  return (
    <div className="fade-up">
      <div style={{ marginBottom: 24, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h1 className="page-title">Launch Token</h1>
          <p className="page-subtitle">Create and deploy a new token on Pump.fun with bundled buys</p>
        </div>
        <button className="btn-ghost" style={{ fontSize: 11, border: '1px solid #253346', borderRadius: 6, padding: '6px 12px' }}
          onClick={fillTestLaunch}>
          Fill Test Launch
        </button>
      </div>

      {/* Vanity Mint — sleek top bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16,
        padding: '8px 14px', borderRadius: 8,
        background: 'rgba(15,23,42,0.5)', border: '1px solid rgba(37,51,70,0.5)',
      }}>
        <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: '#64748b' }}>Mint</span>
        <div style={{ display: 'flex', gap: 4 }}>
          <button className={`chip${form.mintAddressMode === 'random' ? ' active' : ''}`}
            style={{ padding: '3px 10px', fontSize: 10 }} onClick={() => setMintMode('random')}>Random</button>
          <button className={`chip${form.mintAddressMode === 'vanity' ? ' active' : ''}`}
            style={{ padding: '3px 10px', fontSize: 10 }} onClick={() => setMintMode('vanity')}>Vanity</button>
        </div>
        {form.mintAddressMode === 'vanity' ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
            {vanityAddresses.length > 0 ? (
              <>
                <span style={{ fontSize: 9, color: '#475569' }}>Next:</span>
                <span className="font-mono" style={{ fontSize: 11, color: '#14b8a6', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' }}
                  onClick={() => copyMintAddress(vanityAddresses[0].publicKey)}
                  title={vanityAddresses[0].publicKey}>
                  {vanityAddresses[0].publicKey.slice(0, 8)}...{vanityAddresses[0].publicKey.slice(-6)}
                </span>
                <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 4px', borderRadius: 3, background: 'rgba(20,184,166,0.12)', color: '#14b8a6' }}>pump</span>
                <button className="btn-ghost" style={{ fontSize: 9, padding: '2px 6px', color: copiedMint ? '#34d399' : '#475569', flexShrink: 0 }}
                  onClick={() => copyMintAddress(vanityAddresses[0].publicKey)}>
                  {copiedMint ? '✓' : 'Copy'}
                </button>
              </>
            ) : (
              <span style={{ fontSize: 10, color: '#fb7185' }}>No vanity addresses</span>
            )}
            {vanityPool.generating && vanityPool.stats ? (
              <span className="font-mono" style={{ fontSize: 9, color: '#fbbf24', flexShrink: 0, animation: 'pulse 2s ease-in-out infinite', marginLeft: 'auto' }}>
                {fmtNum(vanityPool.stats.checked)} checked · {fmtNum(vanityPool.stats.rate)}/s · {vanityPool.stats.found} found
              </span>
            ) : (
              <span style={{ fontSize: 10, color: '#475569', marginLeft: 'auto', flexShrink: 0 }}>
                <span style={{ color: vanityPool.available > 0 ? '#34d399' : '#fb7185', fontWeight: 600 }}>{vanityPool.available}</span> left
              </span>
            )}
            {vanityPool.generating ? (
              <button className="btn-ghost" style={{ fontSize: 9, color: '#fb7185', padding: '2px 6px', flexShrink: 0 }} onClick={stopVanity}>Stop</button>
            ) : (
              <button className="btn-ghost" style={{ fontSize: 9, color: '#14b8a6', padding: '2px 6px', flexShrink: 0 }} onClick={startVanity}>+ Gen</button>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
            {randomPreview ? (
              <>
                <span style={{ fontSize: 9, color: '#475569' }}>Next:</span>
                <span className="font-mono" style={{ fontSize: 11, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' }}
                  onClick={() => copyMintAddress(randomPreview)}
                  title={randomPreview}>
                  {randomPreview.slice(0, 8)}...{randomPreview.slice(-4)}
                </span>
                <button className="btn-ghost" style={{ fontSize: 9, padding: '2px 6px', color: copiedMint ? '#34d399' : '#475569', flexShrink: 0 }}
                  onClick={() => copyMintAddress(randomPreview)}>
                  {copiedMint ? '✓' : 'Copy'}
                </button>
                <button className="btn-ghost" style={{ fontSize: 9, padding: '2px 6px', color: '#475569', flexShrink: 0 }}
                  onClick={refreshRandomPreview}>↻</button>
              </>
            ) : (
              <span style={{ fontSize: 10, color: '#475569' }}>Generating preview...</span>
            )}
          </div>
        )}
      </div>

      <div className="grid-form">
        {/* ── Left column: Form ── */}
        <div className="space-y">
          {/* Token Details — compact: image top, links under description */}
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <h3 className="section-title" style={{ margin: 0 }}>Token Details</h3>
              {/* AI Generate — inline toggle */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <input
                  ref={aiRefInputRef}
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={e => setAiRef(e.target.files?.[0] ?? null)}
                />
                {aiRefPreview ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                    <img src={aiRefPreview} alt="Ref" style={{ width: 20, height: 20, borderRadius: 4, objectFit: 'cover', border: '1px solid #253346' }} />
                    <button type="button" className="btn-ghost" style={{ padding: 1, fontSize: 9, color: '#94a3b8' }} onClick={() => setAiRef(null)}>×</button>
                  </div>
                ) : (
                  <button type="button" className="btn-ghost" style={{ padding: '2px 6px', fontSize: 9, color: '#475569' }} onClick={() => aiRefInputRef.current?.click()}>ref</button>
                )}
                <input
                  className="input"
                  style={{ width: 150, padding: '3px 6px', fontSize: 10 }}
                  placeholder="AI prompt..."
                  value={aiPrompt}
                  onChange={e => setAiPrompt(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && generateWithAi()}
                  disabled={aiGenerating}
                />
                <button
                  className="btn-ghost"
                  style={{ padding: '3px 6px', fontSize: 10, color: aiGenerating ? '#a78bfa' : '#64748b', display: 'flex', alignItems: 'center', gap: 3 }}
                  onClick={generateWithAi}
                  disabled={!aiPrompt.trim() || aiGenerating}
                >
                  <SparklesIcon style={{ width: 11, height: 11 }} />
                  {aiGenerating ? '...' : 'AI'}
                </button>
              </div>
            </div>
            {/* Image at top */}
            <div style={{ marginBottom: 14 }}>
              {imagePreview || form.imageUrl ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <img src={imagePreview || form.imageUrl} alt="Token"
                    style={{ width: 56, height: 56, borderRadius: 10, objectFit: 'cover', border: '1px solid #253346' }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn-ghost" style={{ fontSize: 11 }} onClick={() => fileInputRef.current?.click()}>Replace</button>
                      <button className="btn-ghost" style={{ fontSize: 11, color: '#fb7185' }} onClick={clearImage}>Remove</button>
                    </div>
                    <input className="input font-mono" style={{ fontSize: 10, marginTop: 6, padding: '4px 8px' }} placeholder="or paste URL"
                      value={form.imageUrl.startsWith('/api/') ? '' : form.imageUrl}
                      onChange={e => { updateForm({ imageUrl: e.target.value }); setImagePreview(null) }} />
                  </div>
                </div>
              ) : (
                <div
                  onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleFileDrop}
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    border: `2px dashed ${dragOver ? '#14b8a6' : '#253346'}`,
                    borderRadius: 10,
                    padding: '14px 12px',
                    textAlign: 'center',
                    cursor: 'pointer',
                    transition: 'border-color 0.15s, background 0.15s',
                    background: dragOver ? 'rgba(20,184,166,0.04)' : 'transparent',
                  }}
                >
                  {uploading ? (
                    <span style={{ fontSize: 12, color: '#14b8a6' }}>Uploading...</span>
                  ) : (
                    <>
                      <PhotoIcon style={{ width: 24, height: 24, color: '#475569', marginBottom: 4, display: 'inline-block' }} />
                      <div style={{ fontSize: 11, color: '#94a3b8' }}>Drop image or click · PNG/JPG max 5MB</div>
                    </>
                  )}
                </div>
              )}
              <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFileSelect} />
            </div>

            <div className="grid-2" style={{ gap: 12 }}>
              <div>
                <label className="label">Token Name</label>
                <input className="input" style={{ padding: '8px 10px', fontSize: 13 }} placeholder="My Token" value={form.tokenName}
                  onChange={e => updateForm({ tokenName: e.target.value })} />
              </div>
              <div>
                <label className="label">Symbol</label>
                <input className="input" style={{ padding: '8px 10px', fontSize: 13 }} placeholder="MTK" value={form.tokenSymbol}
                  onChange={e => updateForm({ tokenSymbol: e.target.value })} />
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
              <label className="label">Description</label>
              <textarea className="input" style={{ padding: '8px 10px', fontSize: 12, minHeight: 56 }} placeholder="Token description..."
                value={form.description} onChange={e => updateForm({ description: e.target.value })} />
            </div>
            {/* Links — enter any URL; we route to the correct pump.fun field by domain */}
            <div style={{ marginTop: 12, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <input className="input" style={{ flex: 1, minWidth: 120, fontSize: 11, padding: '6px 10px' }} placeholder="Link 1 (any URL)"
                value={form.website} onChange={e => updateForm({ website: e.target.value })} />
              <input className="input" style={{ flex: 1, minWidth: 120, fontSize: 11, padding: '6px 10px' }} placeholder="Link 2 (any URL)"
                value={form.twitter} onChange={e => updateForm({ twitter: e.target.value })} />
              <input className="input" style={{ flex: 1, minWidth: 120, fontSize: 11, padding: '6px 10px' }} placeholder="Link 3 (any URL)"
                value={form.telegram} onChange={e => updateForm({ telegram: e.target.value })} />
            </div>
          </div>

          {/* Wallet Configuration — Bundle + Holder in one card with sub-boxes */}
          <div className="card">
            <h3 className="section-title">Wallet Configuration</h3>

            {/* Dev Buy — compact */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <label className="label" style={{ display: 'flex', alignItems: 'center', margin: 0 }}>Dev Buy<Tip text="The SOL amount the dev wallet will use to buy tokens. The full amount goes to buying — overhead (gas, rent) is added automatically on top." /></label>
                <WalletSelect value={form.devWalletId || null} onChange={id => updateForm({ devWalletId: id || '' })} slot="Dev" />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="number" className="input font-mono" style={{ width: 80, padding: '6px 10px', fontSize: 12 }}
                  value={form.devBuyAmount} step={0.01} min={0}
                  onChange={e => updateForm({ devBuyAmount: Number(e.target.value) })} />
                <span style={{ fontSize: 11, color: '#64748b' }}>SOL</span>
                <div style={{ display: 'flex', gap: 3 }}>
                  {DEV_PRESETS.map(p => (
                    <button key={p} className={`chip${form.devBuyAmount === p ? ' active' : ''}`} style={{ padding: '4px 8px', fontSize: 11 }}
                      onClick={() => updateForm({ devBuyAmount: p })}>{p}</button>
                  ))}
                </div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
              {/* Bundle Wallets — outlined sub-box */}
              <div style={{
                padding: 12,
                borderRadius: 8,
                border: '1px solid rgba(37,51,70,0.6)',
                background: 'rgba(15,23,42,0.3)',
              }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#34d399', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8, display: 'flex', alignItems: 'center' }}>Bundle<Tip text="Wallets that buy atomically in the same Jito bundle as the dev buy. They appear as separate buyers on-chain but execute in one block. MEV-protected." /></div>
                <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
                  {[0, 1, 2, 3, 4, 5].map(n => (
                    <button key={n} className={`chip${form.bundleWalletCount === n ? ' active' : ''}`}
                      style={{ width: 28, padding: '4px 0', fontSize: 10 }} onClick={() => setBundleCount(n)}>{n}</button>
                  ))}
                </div>
                {form.bundleWalletCount > 0 && (
                  <>
                    <div style={{ display: 'flex', gap: 3, alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ fontSize: 10, color: '#64748b' }}>Set all:</span>
                      {BUNDLE_PRESETS.map(p => (
                        <button key={p} className="chip" style={{ padding: '2px 6px', fontSize: 10 }}
                          onClick={() => updateForm({ bundleSwapAmounts: form.bundleSwapAmounts.map(() => p) })}>{p}</button>
                      ))}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {form.bundleSwapAmounts.map((amt, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 10, color: '#64748b', width: 24 }}>B{i + 1}</span>
                          <input type="number" className="input font-mono" style={{ flex: 1, padding: '4px 8px', fontSize: 11 }}
                            value={amt} step={0.01} min={0} onChange={e => setBundleAmount(i, Number(e.target.value))} />
                          <span style={{ fontSize: 10, color: '#64748b' }}>SOL</span>
                          <WalletSelect value={form.bundleWalletIds[i] ?? null} onChange={id => setBundleWalletId(i, id)} slot={`B${i + 1}`} />
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>

              {/* Holder Wallets — outlined sub-box */}
              <div style={{
                padding: 12,
                borderRadius: 8,
                border: '1px solid rgba(37,51,70,0.6)',
                background: 'rgba(15,23,42,0.3)',
              }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#fbbf24', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8, display: 'flex', alignItems: 'center' }}>Holder<Tip text="Wallets funded at launch but buy AFTER the bundle lands. Useful for manual market-making. Can auto-buy with a configurable delay." /></div>
                <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' }}>
                  {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => (
                    <button key={n} className={`chip${form.holderWalletCount === n ? ' active' : ''}`}
                      style={{ width: 26, padding: '4px 0', fontSize: 10 }} onClick={() => setHolderCount(n)}>{n}</button>
                  ))}
                </div>
                {form.holderWalletCount > 0 && (
                  <>
                    <div style={{ display: 'flex', gap: 3, alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ fontSize: 10, color: '#64748b' }}>Set all:</span>
                      {HOLDER_PRESETS.map(p => (
                        <button key={p} className="chip" style={{ padding: '2px 6px', fontSize: 10 }}
                          onClick={() => updateForm({ holderSwapAmounts: form.holderSwapAmounts.map(() => p) })}>{p}</button>
                      ))}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
                      {form.holderSwapAmounts.map((amt, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 10, color: '#64748b', width: 24 }}>H{i + 1}</span>
                          <input type="number" className="input font-mono" style={{ flex: 1, padding: '4px 8px', fontSize: 11 }}
                            value={amt} step={0.01} min={0} onChange={e => setHolderAmount(i, Number(e.target.value))} />
                          <span style={{ fontSize: 10, color: '#64748b' }}>SOL</span>
                          <WalletSelect value={form.holderWalletIds[i] ?? null} onChange={id => setHolderWalletId(i, id)} slot={`H${i + 1}`} />
                        </div>
                      ))}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }} onClick={() => updateForm({ holderAutoBuy: !form.holderAutoBuy })}>
                      <div className={`toggle-track${form.holderAutoBuy ? ' on' : ''}`} style={{ flexShrink: 0 }}>
                        <div className="toggle-knob" />
                      </div>
                      <span style={{ fontSize: 11, color: '#94a3b8' }}>Auto-buy after launch</span>
                      {form.holderAutoBuy && (
                        <span onClick={e => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <input type="number" className="input font-mono" style={{ width: 50, padding: '2px 6px', fontSize: 10 }}
                            value={form.holderAutoBuyDelay} step={0.5} min={0}
                            onChange={e => updateForm({ holderAutoBuyDelay: Number(e.target.value) })} />
                          <span style={{ fontSize: 9, color: '#64748b' }}>s delay</span>
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Options */}
          <div className="card">
            <h3 className="section-title">Options</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}
              onClick={() => updateForm({ useJito: !form.useJito })}>
              <div className={`toggle-track${form.useJito ? ' on' : ''}`}>
                <div className="toggle-knob" />
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 500, color: '#fff', display: 'flex', alignItems: 'center' }}>Jito Bundle<Tip text="Submits the token creation and all initial buys as a single atomic Jito bundle. All transactions land in the same block — MEV protected, can't be front-run." /></div>
                <div style={{ fontSize: 12, color: '#64748b' }}>
                  Submit create + buys as atomic Jito bundle
                </div>
              </div>
            </div>

            {form.useJito && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', marginTop: 16 }}
                onClick={() => updateForm({ useLUT: !form.useLUT })}>
                <div className={`toggle-track${form.useLUT ? ' on' : ''}`}>
                  <div className="toggle-knob" />
                </div>
                <div>
                <div style={{ fontSize: 14, fontWeight: 500, color: '#fff', display: 'flex', alignItems: 'center' }}>Address Lookup Table<Tip text="Creates an on-chain lookup table to compress transaction size. Required for 3+ bundle wallets. Takes ~55s on first launch, then reuses the existing one." /></div>
                <div style={{ fontSize: 12, color: '#64748b' }}>
                  Compress transactions via LUT (~55s setup on first launch, reused after)
                </div>
                </div>
              </div>
            )}

            {form.useJito && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', marginTop: 16 }}
                onClick={() => updateForm({ strictBundle: !form.strictBundle })}>
                <div className={`toggle-track${form.strictBundle ? ' on' : ''}`}>
                  <div className="toggle-knob" />
                </div>
                <div>
                <div style={{ fontSize: 14, fontWeight: 500, color: '#fff', display: 'flex', alignItems: 'center' }}>Strict Bundle Only<Tip text="If ON, the launch will only succeed if the Jito bundle lands. If OFF, falls back to regular RPC transactions (faster but not MEV-protected)." /></div>
                <div style={{ fontSize: 12, color: '#64748b' }}>
                  Never fall back to RPC buys if Jito bundle does not fully confirm
                </div>
                </div>
              </div>
            )}
          </div>

          {/* Launch Button */}
          <button className="btn-primary" style={{
              width: '100%', padding: '14px 0', fontSize: 15,
              ...(insufficientFunds ? { background: '#991b1b', borderColor: '#dc2626' } : {}),
            }}
            disabled={launching || !form.tokenName || !form.tokenSymbol || insufficientFunds}
            onClick={handleLaunch}>
            {launching ? 'Launching...'
              : insufficientFunds ? `Insufficient Funds (need ${totalSol.toFixed(3)} SOL, have ${fundingBalance?.toFixed(3)})`
              : `Launch Token (${totalSol.toFixed(3)} SOL)`}
          </button>
        </div>

        {/* ── Right column: Summary / Preview / Progress ── */}
        <div className="space-y">
          {/* Summary */}
          <div className="card">
            <h3 className="section-title">Summary</h3>
            <div>
              <div className="summary-row">
                <span className="label-side">Dev Buy</span>
                <span className="value-side accent">{form.devBuyAmount} SOL</span>
              </div>
              {form.bundleSwapAmounts.map((amt, i) => (
                <div key={i} className="summary-row">
                  <span className="label-side">Bundle {i + 1}</span>
                  <span className="value-side">{amt} SOL</span>
                </div>
              ))}
              {form.holderSwapAmounts.map((amt, i) => (
                <div key={i} className="summary-row">
                  <span className="label-side">Holder {i + 1}</span>
                  <span className="value-side">{amt} SOL</span>
                </div>
              ))}
              {form.useJito && (
                <div className="summary-row">
                  <span className="label-side">Jito Tip</span>
                  <span className="value-side">~{tipSol.toFixed(3)} SOL</span>
                </div>
              )}
              <div className="summary-row">
                <span className="label-side" style={{ display: 'flex', alignItems: 'center' }}>Fees<Tip text="On-chain transaction fees and account rent costs. These are small and non-recoverable." width={180} /></span>
                <span className="value-side" style={{ fontSize: 11 }}>~{((1 + form.bundleWalletCount + form.holderWalletCount) * 0.003).toFixed(4)} SOL</span>
              </div>
              <div className="summary-row">
                <span className="label-side" style={{ display: 'flex', alignItems: 'center' }}>Buffer<Tip text="Extra SOL for gas and trading overhead per wallet. Most of it is returned when collecting SOL back to funding." width={200} /></span>
                <span className="value-side" style={{ fontSize: 11 }}>~{(0.1 + form.bundleWalletCount * 0.02 + form.holderWalletCount * 0.01 - (1 + form.bundleWalletCount + form.holderWalletCount) * 0.003).toFixed(3)} SOL</span>
              </div>
              <div style={{ fontSize: 9, color: '#475569', marginTop: -2, marginBottom: 4, paddingLeft: 2, lineHeight: 1.35 }}>
                <span style={{ fontStyle: 'italic' }}>Extra SOL for gas &amp; trading overhead per wallet. Most is returned when collecting SOL back.</span>
              </div>
              <div className="summary-row total">
                <span className="label-side">Total</span>
                <span className="value-side" style={insufficientFunds ? { color: '#ef4444' } : undefined}>{totalSol.toFixed(3)} SOL</span>
              </div>
            </div>

            <details style={{ marginTop: 14, borderTop: '1px solid rgba(37,51,70,0.5)', paddingTop: 12 }}>
              <summary style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', cursor: 'pointer', userSelect: 'none' }}>
                Where does the SOL go?
              </summary>
              <div style={{ fontSize: 10, color: '#64748b', lineHeight: 1.6, marginTop: 8 }}>
                <p style={{ marginBottom: 6 }}>
                  <strong style={{ color: '#cbd5e1' }}>Funding wallet</strong> sends everything below. Total leaves your wallet once; the rest is where it ends up.
                </p>
                <ul style={{ margin: 0, paddingLeft: 14 }}>
                  <li><strong>Dev Buy + Bundle + Holder amounts</strong> → Used to <strong>buy tokens</strong>. That SOL goes to the bonding curve; you get tokens in each wallet.</li>
                  <li><strong>Jito Tip</strong> → Paid to Jito for the bundle. <strong>Gone.</strong></li>
                  <li><strong>Fees</strong> → Tiny on-chain cost (account rent, tx fees). <strong>Gone.</strong></li>
                  <li><strong>Buffer</strong> → Extra SOL sent so each wallet can pay for its own ATA + gas. It sits in those wallets after the buy. <strong>Recoverable</strong> when you “Collect SOL back” on the Trading page.</li>
                </ul>
                <p style={{ marginTop: 8, marginBottom: 0 }}>
                  So most of the “expensive” number is either <strong>tokens you get</strong> or <strong>buffer you get back</strong>. Only the tip + fees are actually spent.
                </p>
              </div>
            </details>
          </div>

          {/* Token Preview */}
          {form.tokenName && (
            <div className="card">
              <h3 className="section-title">Preview</h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                {(imagePreview || form.imageUrl) ? (
                  <img src={imagePreview || form.imageUrl} alt="Token"
                    style={{ width: 48, height: 48, borderRadius: 12, objectFit: 'cover', border: '1px solid #253346' }} />
                ) : (
                  <div style={{
                    width: 48, height: 48, borderRadius: 12,
                    background: 'linear-gradient(135deg, #14b8a6, #0d9488)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 18, fontWeight: 700, color: '#fff',
                  }}>
                    {form.tokenSymbol?.[0] || '?'}
                  </div>
                )}
                <div>
                  <div style={{ fontWeight: 600, color: '#fff' }}>{form.tokenName}</div>
                  <div className="font-mono" style={{ fontSize: 12, color: '#64748b' }}>
                    ${form.tokenSymbol || '---'}
                  </div>
                </div>
              </div>
              {form.description && (
                <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 12, lineHeight: 1.5 }}>
                  {form.description}
                </p>
              )}
            </div>
          )}

          {/* Error shown inline if launch POST fails before redirect */}
          {error && (
            <div className="card" style={{ borderColor: 'rgba(244,63,94,0.2)' }}>
              <div style={{ color: '#fb7185', fontSize: 12 }}>{error}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
