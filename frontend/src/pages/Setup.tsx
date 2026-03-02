import { useState } from 'react'
import { Keypair } from '@solana/web3.js'
import bs58 from 'bs58'
import axios from 'axios'
import {
  DocumentDuplicateIcon,
  ArrowDownTrayIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  CodeBracketIcon,
} from '@heroicons/react/24/outline'

const GITHUB_URL = 'https://github.com/TrenchyDev/trenchy-pump-launcher-bundler'

const SESSION_KEY = 'trencher_session_id'
const FUNDING_KEY = 'trencher_funding_key'

function getOrCreateSessionId(): string {
  let id = localStorage.getItem(SESSION_KEY)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(SESSION_KEY, id)
  }
  return id
}

type Step = 'choose' | 'create' | 'import' | 'save-key' | 'done'

export default function Setup({ onReady }: { onReady: () => void }) {
  const [step, setStep] = useState<Step>('choose')
  const [privateKey, setPrivateKey] = useState('')
  const [generatedKeypair, setGeneratedKeypair] = useState<Keypair | null>(null)
  const [confirmedSaved, setConfirmedSaved] = useState(false)
  const [copied, setCopied] = useState<'pub' | 'priv' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  function handleCreateNew() {
    setError(null)
    const kp = Keypair.generate()
    setGeneratedKeypair(kp)
    setPrivateKey(bs58.encode(kp.secretKey))
    setStep('save-key')
    setConfirmedSaved(false)
  }

  function handleImport() {
    setError(null)
    setStep('import')
    setPrivateKey('')
  }

  function copyToClipboard(text: string, which: 'pub' | 'priv') {
    navigator.clipboard.writeText(text)
    setCopied(which)
    setTimeout(() => setCopied(null), 2000)
  }

  function downloadKeyFile() {
    if (!generatedKeypair) return
    const pk = bs58.encode(generatedKeypair.secretKey)
    const blob = new Blob(
      [
        `Trencher Funding Wallet - SAVE SECURELY\n`,
        `Generated: ${new Date().toISOString()}\n\n`,
        `Public Key (address):\n${generatedKeypair.publicKey.toBase58()}\n\n`,
        `Private Key (Base58) - KEEP SECRET:\n${pk}\n`,
      ],
      { type: 'text/plain' },
    )
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `trencher-funding-${generatedKeypair.publicKey.toBase58().slice(0, 8)}.txt`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  async function handleConfirmAndContinue() {
    setError(null)
    setLoading(true)
    try {
      const sessionId = getOrCreateSessionId()
      const key = privateKey.trim()
      if (!key) {
        setError('Private key is required')
        return
      }

      await axios.post('/api/funding/save', { sessionId, privateKey: key })
      localStorage.setItem(FUNDING_KEY, key)
      onReady()
    } catch (err: any) {
      const msg = err.response?.data?.error ?? err.message ?? 'Failed to save. Check your key format.'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  async function handleImportSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const sessionId = getOrCreateSessionId()
      const key = privateKey.trim()
      if (!key) {
        setError('Enter your private key')
        return
      }

      Keypair.fromSecretKey(bs58.decode(key))
      await axios.post('/api/funding/save', { sessionId, privateKey: key })
      localStorage.setItem(FUNDING_KEY, key)
      onReady()
    } catch (err: any) {
      if (err.message?.includes('Invalid')) {
        setError('Invalid Base58 private key. Check the format.')
      } else {
        setError(err.response?.data?.error ?? 'Failed to import.')
      }
    } finally {
      setLoading(false)
    }
  }

  const containerStyle = {
    minHeight: '100vh',
    background: '#0b1118',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'var(--font-sans)',
  }

  const cardStyle = {
    background: 'rgba(17, 25, 33, 0.95)',
    border: '1px solid rgba(37, 51, 70, 0.5)',
    borderRadius: 12,
    padding: 28,
    backdropFilter: 'blur(12px)',
  }

  return (
    <div style={containerStyle}>
      <div style={{
        width: '100%',
        maxWidth: 480,
        padding: '0 24px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}>
        {/* Logo + branding — centered */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          marginBottom: 32,
          width: '100%',
        }}>
          <div style={{
            width: 80,
            height: 80,
            borderRadius: 20,
            background: 'linear-gradient(135deg, rgba(20, 184, 166, 0.15) 0%, rgba(20, 184, 166, 0.05) 100%)',
            border: '1px solid rgba(20, 184, 166, 0.2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 20,
          }}>
            <img
              src="/image/trencherlogo.png"
              alt="Trencher"
              style={{ height: 48, width: 'auto', objectFit: 'contain' }}
              onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
            />
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#e2e8f0', marginBottom: 8, textAlign: 'center' }}>
            {step === 'choose' && 'Funding wallet'}
            {step === 'create' && 'Create new wallet'}
            {step === 'import' && 'Import wallet'}
            {step === 'save-key' && 'Save your key'}
          </h1>
          <p style={{ fontSize: 14, color: '#64748b', textAlign: 'center', lineHeight: 1.5, maxWidth: 360 }}>
            {step === 'choose' && 'Create a new wallet or import an existing one.'}
            {step === 'import' && 'Paste your Base58 private key.'}
            {step === 'save-key' && 'Store this key securely. You cannot recover it later.'}
          </p>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginTop: 20,
              fontSize: 13,
              color: '#64748b',
              textDecoration: 'none',
              transition: 'color 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = '#14b8a6' }}
            onMouseLeave={e => { e.currentTarget.style.color = '#64748b' }}
          >
            <CodeBracketIcon style={{ width: 18, height: 18 }} />
            View on GitHub
          </a>
        </div>

        {/* Step: Choose */}
        {step === 'choose' && (
          <div style={{ ...cardStyle, width: '100%' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <button
                className="btn-primary"
                onClick={handleCreateNew}
                style={{ width: '100%', padding: '14px', fontSize: 14, fontWeight: 600 }}
              >
                Create new wallet
              </button>
              <button
                onClick={handleImport}
                style={{
                  width: '100%',
                  padding: '14px',
                  fontSize: 14,
                  fontWeight: 600,
                  background: 'rgba(37, 51, 70, 0.5)',
                  border: '1px solid rgba(37, 51, 70, 0.8)',
                  borderRadius: 8,
                  color: '#e2e8f0',
                  cursor: 'pointer',
                  transition: 'border-color 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = 'rgba(20, 184, 166, 0.5)')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = 'rgba(37, 51, 70, 0.8)')}
              >
                Import existing wallet
              </button>
            </div>
          </div>
        )}

        {/* Step: Save key (after create) */}
        {step === 'save-key' && generatedKeypair && (
          <div style={{ ...cardStyle, width: '100%' }}>
            <div style={{
              background: 'rgba(245, 158, 11, 0.08)',
              border: '1px solid rgba(245, 158, 11, 0.3)',
              borderRadius: 8,
              padding: '12px 14px',
              marginBottom: 20,
              display: 'flex',
              gap: 10,
              alignItems: 'flex-start',
            }}>
              <ExclamationTriangleIcon style={{ width: 20, height: 20, color: '#f59e0b', flexShrink: 0, marginTop: 1 }} />
              <div style={{ fontSize: 12, color: '#fbbf24', lineHeight: 1.5 }}>
                Save your private key now. If you lose it, you cannot recover this wallet or any SOL in it.
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#64748b', marginBottom: 6 }}>
                Public address
              </label>
              <div style={{
                display: 'flex',
                gap: 8,
                alignItems: 'center',
                background: 'rgba(15, 23, 42, 0.6)',
                border: '1px solid rgba(37, 51, 70, 0.5)',
                borderRadius: 8,
                padding: '10px 12px',
              }}>
                <code style={{ flex: 1, fontSize: 12, fontFamily: 'var(--font-mono)', color: '#94a3b8', wordBreak: 'break-all' }}>
                  {generatedKeypair.publicKey.toBase58()}
                </code>
                <button
                  type="button"
                  onClick={() => copyToClipboard(generatedKeypair.publicKey.toBase58(), 'pub')}
                  style={{
                    padding: 6,
                    background: 'rgba(37, 51, 70, 0.5)',
                    border: 'none',
                    borderRadius: 6,
                    cursor: 'pointer',
                    color: copied === 'pub' ? '#34d399' : '#94a3b8',
                  }}
                  title="Copy"
                >
                  {copied === 'pub' ? <CheckCircleIcon style={{ width: 18, height: 18 }} /> : <DocumentDuplicateIcon style={{ width: 18, height: 18 }} />}
                </button>
              </div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#64748b', marginBottom: 6 }}>
                Private key (Base58)
              </label>
              <div style={{
                display: 'flex',
                gap: 8,
                alignItems: 'center',
                background: 'rgba(15, 23, 42, 0.6)',
                border: '1px solid rgba(239, 68, 68, 0.2)',
                borderRadius: 8,
                padding: '10px 12px',
              }}>
                <code style={{ flex: 1, fontSize: 11, fontFamily: 'var(--font-mono)', color: '#f87171', wordBreak: 'break-all' }}>
                  {privateKey}
                </code>
                <button
                  type="button"
                  onClick={() => copyToClipboard(privateKey, 'priv')}
                  style={{
                    padding: 6,
                    background: 'rgba(37, 51, 70, 0.5)',
                    border: 'none',
                    borderRadius: 6,
                    cursor: 'pointer',
                    color: copied === 'priv' ? '#34d399' : '#94a3b8',
                  }}
                  title="Copy"
                >
                  {copied === 'priv' ? <CheckCircleIcon style={{ width: 18, height: 18 }} /> : <DocumentDuplicateIcon style={{ width: 18, height: 18 }} />}
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={downloadKeyFile}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                width: '100%',
                padding: '10px',
                marginBottom: 16,
                background: 'rgba(37, 51, 70, 0.5)',
                border: '1px solid rgba(37, 51, 70, 0.8)',
                borderRadius: 8,
                color: '#94a3b8',
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              <ArrowDownTrayIcon style={{ width: 18, height: 18 }} />
              Download as .txt file
            </button>

            <label style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              marginBottom: 20,
              cursor: 'pointer',
              fontSize: 13,
              color: '#94a3b8',
            }}>
              <input
                type="checkbox"
                checked={confirmedSaved}
                onChange={e => setConfirmedSaved(e.target.checked)}
                style={{ width: 18, height: 18 }}
              />
              I have saved my private key securely
            </label>

            {error && (
              <div style={{ marginBottom: 16, fontSize: 12, color: '#f87171' }}>{error}</div>
            )}

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                onClick={() => { setStep('choose'); setGeneratedKeypair(null); setPrivateKey(''); setError(null); }}
                style={{
                  flex: 1,
                  padding: '10px',
                  background: 'transparent',
                  border: '1px solid rgba(37, 51, 70, 0.8)',
                  borderRadius: 8,
                  color: '#94a3b8',
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                Back
              </button>
              <button
                className="btn-primary"
                disabled={!confirmedSaved || loading}
                onClick={handleConfirmAndContinue}
                style={{ flex: 1, padding: '10px', fontSize: 13, fontWeight: 600 }}
              >
                {loading ? 'Saving...' : 'Continue'}
              </button>
            </div>
          </div>
        )}

        {/* Step: Import */}
        {step === 'import' && (
          <div style={{ ...cardStyle, width: '100%' }}>
            {error && (
              <div style={{
                background: 'rgba(239, 68, 68, 0.08)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                borderRadius: 8,
                padding: '10px 14px',
                marginBottom: 20,
                fontSize: 12,
                color: '#f87171',
              }}>
                {error}
              </div>
            )}

            <form onSubmit={handleImportSubmit}>
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 6 }}>
                  Private key (Base58)
                </label>
                <textarea
                  className="input"
                  value={privateKey}
                  onChange={e => setPrivateKey(e.target.value)}
                  placeholder="Paste your Base58 private key..."
                  rows={3}
                  style={{
                    width: '100%',
                    fontSize: 12,
                    fontFamily: 'var(--font-mono)',
                    resize: 'vertical',
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  type="button"
                  onClick={() => { setStep('choose'); setPrivateKey(''); setError(null); }}
                  style={{
                    flex: 1,
                    padding: '10px',
                    background: 'transparent',
                    border: '1px solid rgba(37, 51, 70, 0.8)',
                    borderRadius: 8,
                    color: '#94a3b8',
                    fontSize: 13,
                    cursor: 'pointer',
                  }}
                >
                  Back
                </button>
                <button
                  className="btn-primary"
                  type="submit"
                  disabled={loading || !privateKey.trim()}
                  style={{ flex: 1, padding: '10px', fontSize: 13, fontWeight: 600 }}
                >
                  {loading ? 'Importing...' : 'Import & continue'}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  )
}

export { SESSION_KEY, FUNDING_KEY, getOrCreateSessionId }
