import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import type { SessionClip } from '../store'
import { fetchLibrary, fetchClip, fetchSession, LibraryClip, FOOTAGE_BASE } from '../api/library'
import { parseGPX } from '../hooks/useGPX'
import UploadZone from './UploadZone'

type LoadChannel = 'front' | 'rear' | 'both'
type DisplayItem = { primary: LibraryClip; peer?: LibraryClip }

interface Props {
  onClose: () => void
  initialTab?: 'library' | 'upload'
  checked: Set<string>
  setChecked: React.Dispatch<React.SetStateAction<Set<string>>>
}

export default function LibraryModal({ onClose, initialTab = 'library', checked, setChecked }: Props) {
  const { loadLibraryClip, loadSession, buildMultiSession, extractionStatus } = useStore()
  const [tab, setTab] = useState<'library' | 'upload'>(initialTab)
  const [clips, setClips] = useState<LibraryClip[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [loadingId, setLoadingId] = useState<string | null>(null)

  useEffect(() => {
    fetchLibrary()
      .then(setClips)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  // Auto-close after successful upload — only if extraction completed while this modal was open
  const prevExtractionStatus = useRef(extractionStatus)
  useEffect(() => {
    const prev = prevExtractionStatus.current
    prevExtractionStatus.current = extractionStatus
    if (tab === 'upload' && prev === 'extracting' && extractionStatus === 'done') {
      const id = setTimeout(onClose, 900)
      return () => clearTimeout(id)
    }
  }, [extractionStatus, tab, onClose])

  // Close on Escape
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  // Deduplicate into pairs: primary = front, peer = rear
  const displayItems = useMemo<DisplayItem[]>(() => {
    const seen = new Set<string>()
    const clipMap = new Map(clips.map(c => [c.id, c]))
    const items: DisplayItem[] = []

    for (const clip of clips) {
      if (seen.has(clip.id)) continue
      seen.add(clip.id)

      if (clip.peer_clip_id && !seen.has(clip.peer_clip_id)) {
        const peer = clipMap.get(clip.peer_clip_id)
        if (peer) {
          seen.add(peer.id)
          if (clip.channel === 'front') {
            items.push({ primary: clip, peer })
          } else {
            items.push({ primary: peer, peer: clip })
          }
          continue
        }
      }
      items.push({ primary: clip })
    }
    return items
  }, [clips])

  // Group by date (newest first)
  const grouped = useMemo(() => {
    const groups: Record<string, DisplayItem[]> = {}
    for (const item of displayItems) {
      const date = item.primary.recorded_at?.slice(0, 10) ?? 'Unknown'
      if (!groups[date]) groups[date] = []
      groups[date].push(item)
    }
    return Object.entries(groups).sort(([a], [b]) => b.localeCompare(a))
  }, [displayItems])

  const itemKey = (item: DisplayItem) => item.primary.session_id ?? item.primary.id

  const checkedItems = useMemo(
    () => displayItems.filter(item => checked.has(itemKey(item))),
    [checked, displayItems]
  )

  const anySelected = checkedItems.length > 0
  const allHavePeer = checkedItems.length > 0 && checkedItems.every(item => !!item.peer)

  const toggleCheck = (item: DisplayItem) => {
    const key = itemKey(item)
    setChecked(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  // ── Single-item handlers ─────────────────────────────────────────────────

  const loadSingle = async (clip: LibraryClip) => {
    setLoadingId(clip.id)
    try {
      const detail = await fetchClip(clip.id)
      loadLibraryClip(detail)
      onClose()
    } catch (e: any) { setError(e.message) }
    finally { setLoadingId(null) }
  }

  const loadBoth = async (item: DisplayItem) => {
    if (!item.peer || !item.primary.session_id) { loadSingle(item.primary); return }
    setLoadingId(item.primary.id)
    try {
      const sessionClips = await fetchSession(item.primary.session_id)
      loadSession(sessionClips)
      onClose()
    } catch (e: any) { setError(e.message) }
    finally { setLoadingId(null) }
  }

  // ── Multi-select load ────────────────────────────────────────────────────

  const handleMultiLoad = async (channel: LoadChannel) => {
    // Single item + both → use synchronized front+rear session
    if (checkedItems.length === 1 && channel === 'both') {
      loadBoth(checkedItems[0])
      return
    }

    // Sort chronologically regardless of selection order
    const sorted = [...checkedItems].sort((a, b) =>
      (a.primary.recorded_at ?? '').localeCompare(b.primary.recorded_at ?? '')
    )

    setLoadingId('multi')
    try {
      const sessionClips: SessionClip[] = []

      for (const item of sorted) {
        // Decide which clip to use as the primary (video + GPS)
        const primary = (channel === 'rear' && item.peer) ? item.peer : item.primary
        const peerClip = (channel === 'both' && item.peer) ? item.peer : undefined

        const detail = await fetchClip(primary.id)
        const dur = detail.duration_sec ?? 0
        const gpxPoints = detail.gpx ? parseGPX(detail.gpx) : []

        sessionClips.push({
          clipId: primary.id,
          channel: primary.channel,
          trimStart: 0,
          trimEnd: dur,
          videoUrl: `${FOOTAGE_BASE}/api/footage/${primary.id}`,
          peerVideoUrl: peerClip ? `${FOOTAGE_BASE}/api/footage/${peerClip.id}` : undefined,
          gpxPoints,
          videoOffset: 0,
          color: '',
          filename: primary.filename,
          recordedAt: primary.recorded_at,
        })
      }

      buildMultiSession(sessionClips)
      onClose()
    } catch (e: any) { setError(e.message) }
    finally { setLoadingId(null) }
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,.65)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        background: 'var(--s1)',
        border: '1px solid var(--b3)',
        borderRadius: 10,
        width: 'min(740px, 96vw)',
        height: 'min(82vh, 720px)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: '0 24px 80px rgba(0,0,0,.7)',
      }}>

        {/* ── Header ── */}
        <div style={{
          padding: '10px 16px',
          borderBottom: '1px solid var(--b2)',
          display: 'flex', alignItems: 'center', gap: 10,
          flexShrink: 0,
        }}>
          {/* Tabs */}
          <div style={{ display: 'flex', gap: 2 }}>
            {(['library', 'upload'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{
                  fontFamily: 'var(--mono)', fontSize: 11, padding: '4px 12px',
                  background: tab === t ? 'var(--acc-dim)' : 'transparent',
                  border: `1px solid ${tab === t ? 'rgba(245,197,66,.4)' : 'var(--b2)'}`,
                  borderRadius: 6, color: tab === t ? 'var(--acc)' : 'var(--txt2)',
                  cursor: 'pointer', transition: 'all .1s',
                }}
              >
                {t === 'library' ? 'Library' : '+ Upload'}
              </button>
            ))}
          </div>
          {tab === 'library' && !loading && !error && (
            <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--txt3)' }}>
              {displayItems.length} recording{displayItems.length !== 1 ? 's' : ''}
            </span>
          )}
          <div style={{ flex: 1 }} />
          {tab === 'library' && anySelected && (
            <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--acc)', marginRight: 4 }}>
              {checkedItems.length} selected
            </span>
          )}
          <button
            onClick={onClose}
            style={{
              background: 'transparent', border: '1px solid var(--b2)',
              borderRadius: 6, color: 'var(--txt2)', cursor: 'pointer',
              fontFamily: 'var(--mono)', fontSize: 14, padding: '2px 9px',
              transition: 'all .1s',
            }}
          >✕</button>
        </div>

        {/* ── Upload tab ── */}
        {tab === 'upload' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '24px 32px' }}>
            <UploadZone />
          </div>
        )}

        {/* ── Library tab body ── */}
        {tab === 'library' && <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading && (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--txt3)', fontFamily: 'var(--mono)', fontSize: 11 }}>
              Loading library…
            </div>
          )}

          {error && !loading && (
            <div style={{ padding: 20, color: 'var(--red)', fontFamily: 'var(--mono)', fontSize: 11, lineHeight: 1.9 }}>
              ✗ {error}<br />
              <span style={{ color: 'var(--txt3)', fontSize: 10 }}>
                Make sure footage is mounted:<br />
                <code style={{ color: 'var(--txt2)' }}>-v /your/footage:/footage</code>
              </span>
            </div>
          )}

          {!loading && !error && displayItems.length === 0 && (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--txt3)', fontFamily: 'var(--mono)', fontSize: 11, lineHeight: 2.2 }}>
              No clips indexed yet.<br />
              <code style={{ color: 'var(--txt2)' }}>-v /footage:/footage</code>
            </div>
          )}

          {grouped.map(([date, items]) => (
            <div key={date}>
              {/* Date header */}
              <div style={{
                fontSize: 9, textTransform: 'uppercase', letterSpacing: '.12em',
                color: 'var(--txt3)', fontFamily: 'var(--mono)',
                padding: '8px 16px 4px',
                position: 'sticky', top: 0, zIndex: 1,
                background: 'var(--s1)', borderBottom: '1px solid var(--b1)',
              }}>
                {formatDate(date)}
              </div>

              {items.map(item => {
                const key = itemKey(item)
                const isChecked = checked.has(key)
                const isRowLoading = loadingId === item.primary.id || loadingId === (item.primary.session_id ?? '__')
                const hasBoth = !!item.peer

                return (
                  <div key={key} style={{
                    padding: '9px 16px',
                    borderBottom: '1px solid var(--b1)',
                    background: isChecked ? 'var(--acc-dim)' : 'transparent',
                    transition: 'background .1s',
                  }}>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                      {/* Checkbox */}
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleCheck(item)}
                        style={{
                          cursor: 'pointer', accentColor: 'var(--acc)',
                          width: 15, height: 15, flexShrink: 0, marginTop: 2,
                        }}
                      />

                      {/* Content */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        {/* Top row: time + badges + stats */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                          {item.primary.recorded_at && (
                            <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--txt)', fontWeight: 600 }}>
                              {new Date(item.primary.recorded_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                            </span>
                          )}
                          <ChannelBadge channel={item.primary.channel} />
                          {item.peer && <ChannelBadge channel={item.peer.channel} />}
                          <span style={{ flex: 1 }} />
                          {item.primary.duration_sec != null && (
                            <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--txt3)' }}>
                              {fmtDur(item.primary.duration_sec)}
                            </span>
                          )}
                          {item.primary.max_speed_kmh != null && (
                            <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--txt2)' }}>
                              {Math.round(item.primary.max_speed_kmh)} km/h
                            </span>
                          )}
                        </div>

                        {/* Filename */}
                        <div style={{
                          fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--txt3)',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          marginBottom: anySelected ? 0 : 6,
                        }}>
                          {item.primary.filename}
                        </div>

                        {/* Per-row action buttons — hidden when any checkbox is selected */}
                        {!anySelected && (
                          <div style={{ display: 'flex', gap: 5 }}>
                            {hasBoth ? (
                              <>
                                <RowBtn onClick={() => loadSingle(item.primary)} loading={isRowLoading} dim>Front</RowBtn>
                                <RowBtn onClick={() => loadSingle(item.peer!)} loading={isRowLoading} dim>Rear</RowBtn>
                                <RowBtn onClick={() => loadBoth(item)} loading={isRowLoading} accent>Load Both</RowBtn>
                              </>
                            ) : (
                              <RowBtn onClick={() => loadSingle(item.primary)} loading={isRowLoading}>Load</RowBtn>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Loading progress bar */}
                    {isRowLoading && (
                      <div style={{ marginTop: 6, height: 2, background: 'var(--s3)', borderRadius: 1, overflow: 'hidden' }}>
                        <div style={{
                          height: '100%',
                          background: 'linear-gradient(90deg,var(--acc2),var(--acc))',
                          animation: 'dashtrack-progress 1.4s ease infinite',
                        }} />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
        </div>}

        {/* ── Footer — appears when 1+ items are checked (library tab only) ── */}
        {tab === 'library' && anySelected && (
          <div style={{
            borderTop: '1px solid var(--b2)',
            padding: '10px 16px',
            background: 'var(--s2)',
            display: 'flex', alignItems: 'center', gap: 8,
            flexShrink: 0,
            flexWrap: 'wrap',
          }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--txt2)' }}>
              {checkedItems.length} recording{checkedItems.length !== 1 ? 's' : ''} — load as:
            </span>
            <div style={{ flex: 1 }} />

            {loadingId === 'multi' ? (
              <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--acc)' }}>Loading…</span>
            ) : (
              <>
                <FooterBtn onClick={() => handleMultiLoad('front')}>Front</FooterBtn>
                <FooterBtn onClick={() => handleMultiLoad('rear')} disabled={!checkedItems.some(i => !!i.peer)}>
                  Rear
                </FooterBtn>
                <FooterBtn onClick={() => handleMultiLoad('both')} accent disabled={!allHavePeer}>
                  Both
                </FooterBtn>
                <div style={{ width: 1, height: 20, background: 'var(--b3)' }} />
                <FooterBtn onClick={() => setChecked(new Set())}>Clear</FooterBtn>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────

function ChannelBadge({ channel }: { channel: string }) {
  const color = channel === 'front' ? 'var(--acc)' : channel === 'rear' ? '#4da6ff' : 'var(--txt3)'
  return (
    <span style={{
      fontFamily: 'var(--mono)', fontSize: 9, fontWeight: 700,
      color, border: `1px solid ${color}`, borderRadius: 3,
      padding: '1px 4px', opacity: 0.9, letterSpacing: '.05em',
    }}>
      {channel === 'front' ? 'F' : channel === 'rear' ? 'R' : '?'}
    </span>
  )
}

function RowBtn({ children, onClick, loading, dim, accent }: {
  children: React.ReactNode
  onClick: () => void
  loading?: boolean
  dim?: boolean
  accent?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      style={{
        fontFamily: 'var(--mono)', fontSize: 10,
        padding: '3px 9px',
        background: accent ? 'var(--acc-dim)' : dim ? 'transparent' : 'var(--s3)',
        border: `1px solid ${accent ? 'rgba(245,197,66,.4)' : 'var(--b2)'}`,
        borderRadius: 5,
        color: accent ? 'var(--acc)' : 'var(--txt2)',
        cursor: loading ? 'wait' : 'pointer',
        opacity: loading ? 0.5 : 1,
        transition: 'all .1s',
      }}
    >
      {children}
    </button>
  )
}

function FooterBtn({ children, onClick, accent, disabled }: {
  children: React.ReactNode
  onClick: () => void
  accent?: boolean
  disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        fontFamily: 'var(--mono)', fontSize: 11,
        padding: '5px 14px',
        background: accent ? 'var(--acc-dim)' : 'var(--s3)',
        border: `1px solid ${accent ? 'rgba(245,197,66,.4)' : 'var(--b2)'}`,
        borderRadius: 6,
        color: accent ? 'var(--acc)' : disabled ? 'var(--txt3)' : 'var(--txt2)',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        transition: 'all .1s',
      }}
    >
      {children}
    </button>
  )
}

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtDur(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  return h ? `${h}h ${m}m` : m ? `${m}m ${s}s` : `${s}s`
}

function formatDate(dateStr: string): string {
  if (dateStr === 'Unknown') return 'Unknown date'
  try {
    return new Date(dateStr + 'T00:00:00').toLocaleDateString(undefined, {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    })
  } catch { return dateStr }
}
