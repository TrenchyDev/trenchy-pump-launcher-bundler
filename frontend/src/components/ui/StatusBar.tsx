import type { LaunchStage, CloseoutResult } from '../../types'

interface Props {
  launchStages: LaunchStage[]
  launchError: string | null
  launchResult: { signature: string; mint: string } | null
  showCloseoutButton: boolean
  closingOut: boolean
  closeoutResult: CloseoutResult | null
  onDismissLaunch: () => void
  onCollectAndRecover: () => void
  onDismissCloseout: () => void
}

export default function StatusBar({
  launchStages, launchError, launchResult,
  showCloseoutButton, closingOut, closeoutResult,
  onDismissLaunch, onCollectAndRecover, onDismissCloseout,
}: Props) {
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
          {launchError ? (
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#fb7185', flexShrink: 0 }} />
          ) : launchResult ? (
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#34d399', flexShrink: 0 }} />
          ) : (
            <div style={{ width: 10, height: 10, border: '2px solid #818cf8', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />
          )}

          <span style={{ fontWeight: 700, color: launchError ? '#fb7185' : launchResult ? '#34d399' : '#818cf8', flexShrink: 0 }}>
            {launchResult ? 'Launched' : launchError ? 'Failed' : 'Launching'}
          </span>

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

          {(launchResult || launchError) && (
            <button className="btn-ghost" style={{ fontSize: 9, padding: '2px 6px', flexShrink: 0 }}
              onClick={onDismissLaunch}>
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
            onClick={onCollectAndRecover}>
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
            onClick={onDismissCloseout}>Dismiss</button>
        </>
      ) : null}
    </div>
  )
}
