import { useEffect, useState } from 'react'
import axios from 'axios'
import { Keypair } from '@solana/web3.js'
import bs58 from 'bs58'
import { SESSION_KEY, FUNDING_KEY, getOrCreateSessionId } from './Setup'

interface EnvEntry {
  key: string
  label: string
  value: string
  sensitive: boolean
  required: boolean
  isSet: boolean
}

export default function Settings() {
  const [entries, setEntries] = useState<EnvEntry[]>([])
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [revealed, setRevealed] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [fundingStatus, setFundingStatus] = useState<{ publicKey: string; balance?: number } | null>(null)
  const [switchWalletMode, setSwitchWalletMode] = useState(false)
  const [newPrivateKey, setNewPrivateKey] = useState('')
  const [switchError, setSwitchError] = useState<string | null>(null)
  const [switchLoading, setSwitchLoading] = useState(false)

  useEffect(() => {
    axios.get('/api/env').then(r => {
      setEntries(r.data.entries)
      const d: Record<string, string> = {}
      for (const e of r.data.entries) d[e.key] = e.value
      setDraft(d)
    })
  }, [])

  useEffect(() => {
    axios.get('/api/wallets/funding').then(r => {
      if (r.data.publicKey) setFundingStatus({ publicKey: r.data.publicKey, balance: r.data.balance })
    }).catch(() => setFundingStatus(null))
  }, [])

  const dirty = entries.some(e => draft[e.key] !== e.value)
  const missingRequired = entries.filter(e => e.required && !draft[e.key]?.trim())

  async function save() {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      await axios.put('/api/env', { values: draft })
      const r = await axios.get('/api/env')
      setEntries(r.data.entries)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err: any) {
      setError(err.response?.data?.error ?? err.message)
    } finally {
      setSaving(false)
    }
  }

  function mask(val: string) {
    if (!val) return ''
    if (val.length <= 8) return '•'.repeat(val.length)
    return val.slice(0, 4) + '•'.repeat(Math.min(val.length - 8, 20)) + val.slice(-4)
  }

  async function handleSwitchWallet(e: React.FormEvent) {
    e.preventDefault()
    setSwitchError(null)
    setSwitchLoading(true)
    try {
      const key = newPrivateKey.trim()
      if (!key) {
        setSwitchError('Enter private key')
        return
      }
      Keypair.fromSecretKey(bs58.decode(key))
      const sessionId = localStorage.getItem(SESSION_KEY) || getOrCreateSessionId()
      await axios.post('/api/funding/save', { sessionId, privateKey: key })
      localStorage.setItem(FUNDING_KEY, key)
      const r = await axios.get('/api/wallets/funding')
      setFundingStatus({ publicKey: r.data.publicKey, balance: r.data.balance })
      setSwitchWalletMode(false)
      setNewPrivateKey('')
    } catch (err: any) {
      setSwitchError(err.message?.includes('Invalid') ? 'Invalid Base58 key' : err.response?.data?.error ?? 'Failed')
    } finally {
      setSwitchLoading(false)
    }
  }

  return (
    <div className="fade-up" style={{ maxWidth: 720 }}>
      <div style={{ marginBottom: 24 }}>
        <h1 className="page-title">Settings</h1>
        <p className="page-subtitle">Environment configuration</p>
      </div>

      {/* Funding wallet / Switch */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid rgba(37, 51, 70, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>Funding wallet</span>
          {!switchWalletMode && (
            <button
              onClick={() => setSwitchWalletMode(true)}
              style={{
                padding: '6px 12px',
                fontSize: 12,
                background: 'rgba(37, 51, 70, 0.5)',
                border: '1px solid rgba(37, 51, 70, 0.8)',
                borderRadius: 6,
                color: '#14b8a6',
                cursor: 'pointer',
              }}
            >
              Switch wallet
            </button>
          )}
        </div>
        <div style={{ padding: '16px 20px' }}>
          {!switchWalletMode ? (
            <div>
              {fundingStatus ? (
                <div style={{ fontSize: 13, color: '#94a3b8' }}>
                  <div style={{ fontFamily: 'var(--font-mono)', wordBreak: 'break-all', marginBottom: 4 }}>
                    {fundingStatus.publicKey}
                  </div>
                  {fundingStatus.balance != null && (
                    <div style={{ fontSize: 12, color: '#64748b' }}>
                      Balance: {fundingStatus.balance.toFixed(4)} SOL
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ fontSize: 13, color: '#64748b' }}>Loading...</div>
              )}
            </div>
          ) : (
            <form onSubmit={handleSwitchWallet}>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 6 }}>
                  New private key (Base58)
                </label>
                <textarea
                  className="input"
                  value={newPrivateKey}
                  onChange={e => setNewPrivateKey(e.target.value)}
                  placeholder="Paste new funding wallet private key..."
                  rows={2}
                  style={{ width: '100%', fontSize: 12, fontFamily: 'var(--font-mono)' }}
                />
              </div>
              {switchError && <div style={{ fontSize: 12, color: '#f87171', marginBottom: 8 }}>{switchError}</div>}
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => { setSwitchWalletMode(false); setNewPrivateKey(''); setSwitchError(null); }}
                  style={{
                    padding: '8px 0',
                    flex: 1,
                    background: 'transparent',
                    border: '1px solid rgba(37, 51, 70, 0.8)',
                    borderRadius: 6,
                    color: '#94a3b8',
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={switchLoading || !newPrivateKey.trim()}
                  className="btn-primary"
                  style={{ padding: '8px 0', flex: 1, fontSize: 12 }}
                >
                  {switchLoading ? 'Saving...' : 'Switch'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>

      {missingRequired.length > 0 && (
        <div style={{
          background: 'rgba(239, 68, 68, 0.08)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          borderRadius: 10,
          padding: '14px 18px',
          marginBottom: 20,
          display: 'flex',
          alignItems: 'flex-start',
          gap: 12,
        }}>
          <div style={{
            width: 22, height: 22, borderRadius: '50%',
            background: 'rgba(239, 68, 68, 0.2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0, marginTop: 1,
          }}>
            <span style={{ color: '#f87171', fontSize: 14, fontWeight: 700 }}>!</span>
          </div>
          <div>
            <div style={{ color: '#f87171', fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
              Required configuration missing
            </div>
            <div style={{ color: '#fca5a5', fontSize: 12, lineHeight: 1.5 }}>
              Set the following before launching: {missingRequired.map(e => {
                const entry = entries.find(x => x.key === e)
                return entry?.label ?? e
              }).join(', ')}
            </div>
          </div>
        </div>
      )}

      <div className="card" style={{ padding: 0 }}>
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid rgba(37, 51, 70, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>Environment Variables</span>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {saved && <span style={{ fontSize: 12, color: '#34d399' }}>Saved</span>}
            {error && <span style={{ fontSize: 12, color: '#f87171' }}>{error}</span>}
            <button
              className="btn-primary"
              disabled={!dirty || saving}
              onClick={save}
              style={{ padding: '7px 16px', fontSize: 12 }}
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>

        <div style={{ padding: '8px 0' }}>
          {entries.map(entry => (
            <div key={entry.key} style={{
              padding: '14px 20px',
              borderBottom: '1px solid rgba(37, 51, 70, 0.25)',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8' }}>
                  {entry.label}
                </label>
                {entry.required && !draft[entry.key]?.trim() && (
                  <span style={{
                    fontSize: 9, fontWeight: 700, color: '#f87171',
                    background: 'rgba(239,68,68,0.12)', padding: '1px 6px',
                    borderRadius: 4, textTransform: 'uppercase',
                  }}>Required</span>
                )}
                {!entry.required && (
                  <span style={{
                    fontSize: 9, fontWeight: 600, color: '#64748b',
                    background: 'rgba(100,116,139,0.1)', padding: '1px 6px',
                    borderRadius: 4, textTransform: 'uppercase',
                  }}>Optional</span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  className="input"
                  type={entry.sensitive && !revealed[entry.key] ? 'password' : 'text'}
                  value={entry.sensitive && !revealed[entry.key] ? (draft[entry.key] ? mask(draft[entry.key]) : '') : (draft[entry.key] ?? '')}
                  placeholder={`Enter ${entry.label.toLowerCase()}`}
                  onFocus={() => { if (entry.sensitive) setRevealed(r => ({ ...r, [entry.key]: true })) }}
                  onBlur={() => { if (entry.sensitive) setRevealed(r => ({ ...r, [entry.key]: false })) }}
                  onChange={e => setDraft(d => ({ ...d, [entry.key]: e.target.value }))}
                  style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}
                />
              </div>
              <div style={{ fontSize: 10, color: '#475569', fontFamily: 'var(--font-mono)' }}>
                {entry.key}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{
        marginTop: 16,
        padding: '12px 16px',
        borderRadius: 8,
        background: 'rgba(37, 51, 70, 0.2)',
        fontSize: 11,
        color: '#64748b',
        lineHeight: 1.6,
      }}>
        Changes are written to the <code style={{ color: '#94a3b8' }}>.env</code> file and applied to the running server immediately.
        Some changes (like RPC endpoint) may require restarting active operations to take full effect.
      </div>
    </div>
  )
}
