import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MdErrorOutline } from 'react-icons/md'
import { useStore } from '../store'
import { fetchLibrary, fetchClip, fetchSession, LibraryClip } from '../api/library'
import { byChannel, channelColor, channelLabel, channelShort } from '../channels'
import { cvtSpeed, speedUnit } from '../units'

const PAGE_SIZE = 100

interface Props {
  selectionMode?: boolean
  selectedIds?: Set<string>
  onSelect?: (clip: LibraryClip) => void
}

export default function LibraryView({ selectionMode = false, selectedIds = new Set(), onSelect }: Props) {
  const { loadLibraryClip, loadSession } = useStore()
  const [clips, setClips] = useState<LibraryClip[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [offsetRef] = useState({ value: 0 })
  const [error, setError] = useState<string | null>(null)
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    offsetRef.value = 0
    fetchLibrary(0, PAGE_SIZE)
      .then(data => {
        setClips(data)
        setHasMore(data.length === PAGE_SIZE)
        offsetRef.value = PAGE_SIZE
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const loadMore = useCallback(() => {
    if (loadingMore || !hasMore) return
    setLoadingMore(true)
    fetchLibrary(offsetRef.value, PAGE_SIZE)
      .then(data => {
        setClips(prev => [...prev, ...data])
        setHasMore(data.length === PAGE_SIZE)
        offsetRef.value += PAGE_SIZE
      })
      .catch(e => setError(e.message))
      .finally(() => setLoadingMore(false))
  }, [loadingMore, hasMore])

  // Infinite scroll — trigger loadMore when sentinel enters viewport
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) loadMore()
    }, { rootMargin: '300px' })
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [loadMore])

  // Group a session's channels (front / interior / rear) into one display item,
  // preserving first-appearance order and canonical channel order within a card.
  const displayItems = useMemo(() => {
    const bySession = new Map<string, LibraryClip[]>()
    for (const clip of clips) {
      if (!clip.session_id) continue
      const g = bySession.get(clip.session_id)
      if (g) g.push(clip)
      else bySession.set(clip.session_id, [clip])
    }
    const emitted = new Set<string>()
    const items: { primary: LibraryClip; peers: LibraryClip[] }[] = []
    for (const clip of clips) {
      if (clip.session_id) {
        if (emitted.has(clip.session_id)) continue
        emitted.add(clip.session_id)
        const group = [...(bySession.get(clip.session_id) ?? [clip])].sort(byChannel(c => c.channel))
        items.push({ primary: group[0], peers: group.slice(1) })
      } else {
        items.push({ primary: clip, peers: [] })
      }
    }
    return items
  }, [clips])

  // Group by date
  const grouped = useMemo(() => {
    const groups: Record<string, typeof displayItems> = {}
    for (const item of displayItems) {
      const date = item.primary.recorded_at?.slice(0, 10) ?? 'Unknown date'
      if (!groups[date]) groups[date] = []
      groups[date].push(item)
    }
    return Object.entries(groups).sort(([a], [b]) => b.localeCompare(a))
  }, [displayItems])

  const handleLoad = async (clip: LibraryClip) => {
    if (selectionMode) { onSelect?.(clip); return }
    setLoadingId(clip.id)
    try {
      const detail = await fetchClip(clip.id)
      loadLibraryClip(detail)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoadingId(null)
    }
  }

  const handleLoadSession = async (sessionId: string, representativeId: string) => {
    setLoadingId(representativeId)
    try {
      const sessionClips = await fetchSession(sessionId)
      loadSession(sessionClips)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoadingId(null)
    }
  }

  if (loading) return (
    <div style={{ padding: 20, textAlign: 'center', color: 'var(--txt3)', fontFamily: 'var(--mono)', fontSize: 11 }}>
      Loading library…
    </div>
  )

  if (error) return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ color: 'var(--red)', fontFamily: 'var(--mono)', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}><MdErrorOutline size={14} style={{ flexShrink: 0 }} /> {error}</div>
      <div style={{ color: 'var(--txt3)', fontFamily: 'var(--mono)', fontSize: 10, lineHeight: 1.6 }}>
        Mount a footage volume:<br />
        <code>-v /your/footage:/footage</code>
      </div>
    </div>
  )

  if (clips.length === 0) return (
    <div style={{ padding: 20, textAlign: 'center', color: 'var(--txt3)', fontFamily: 'var(--mono)', fontSize: 11, lineHeight: 2 }}>
      No clips indexed yet.<br />
      Mount footage directory:<br />
      <code style={{ color: 'var(--txt2)' }}>-v /footage:/footage</code>
    </div>
  )

  return (
    <div style={{ flex: 1, overflowY: 'auto' }}>
      {grouped.map(([date, items]) => (
        <div key={date}>
          <div style={{
            fontSize: 9, textTransform: 'uppercase', letterSpacing: '.1em',
            color: 'var(--txt3)', fontFamily: 'var(--mono)',
            padding: '8px 12px 4px',
            position: 'sticky', top: 0, background: 'var(--s1)', zIndex: 1,
            borderBottom: '1px solid var(--b1)',
          }}>
            {formatDate(date)}
          </div>

          {items.map(({ primary, peers }) => {
            const allClips = [primary, ...peers]
            const isLoading = loadingId === primary.id || loadingId === (primary.session_id ?? '')
            const hasSession = !!primary.session_id && peers.length > 0

            return (
              <ClipRow
                key={primary.id}
                clips={allClips}
                selectedIds={selectedIds}
                loading={isLoading}
                selectionMode={selectionMode}
                onLoadClip={c => handleLoad(c)}
                onLoadSession={hasSession && !selectionMode
                  ? () => handleLoadSession(primary.session_id!, primary.id)
                  : undefined
                }
                onSelectClip={c => onSelect?.(c)}
              />
            )
          })}
        </div>
      ))}

      {/* Infinite scroll sentinel */}
      <div ref={sentinelRef} style={{ height: 1 }} />
      {loadingMore && (
        <div style={{ padding: '10px 12px', textAlign: 'center', color: 'var(--txt3)', fontFamily: 'var(--mono)', fontSize: 10 }}>
          Loading more…
        </div>
      )}
    </div>
  )
}

// ── ClipRow ───────────────────────────────────────────────────

interface ClipRowProps {
  clips: LibraryClip[]              // [primary, ...peers] in canonical order
  selectedIds: Set<string>
  loading: boolean
  selectionMode: boolean
  onLoadClip: (clip: LibraryClip) => void
  onLoadSession?: () => void
  onSelectClip: (clip: LibraryClip) => void
}

function ClipRow({ clips, selectedIds, loading, selectionMode, onLoadClip, onLoadSession, onSelectClip }: ClipRowProps) {
  const units = useStore(s => s.units)
  const primary = clips[0]
  const hasSession = clips.length > 1
  const anySelected = clips.some(c => selectedIds.has(c.id))
  const dur = primary.duration_sec ? fmtDur(primary.duration_sec) : '—'
  const spd = primary.max_speed_mps ? `${Math.round(cvtSpeed(primary.max_speed_mps, units))} ${speedUnit(units)}` : '—'
  const time = primary.recorded_at
    ? new Date(primary.recorded_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null

  return (
    <div style={{
      padding: '7px 12px',
      borderBottom: '1px solid var(--b1)',
      background: anySelected ? 'var(--acc-dim)' : 'transparent',
      transition: 'background .1s',
    }}>
      {/* Top row: time + channel badges + duration */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
        {time && (
          <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--txt)', fontWeight: 600 }}>
            {time}
          </span>
        )}
        {clips.map(c => <ChannelBadge key={c.id} channel={c.channel} />)}
        <span style={{ flex: 1 }} />
        <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--txt3)' }}>{dur}</span>
        {primary.max_speed_mps && (
          <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--txt2)' }}>{spd}</span>
        )}
      </div>

      {/* Filename */}
      <div style={{
        fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--txt3)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 5,
      }}>
        {primary.filename}
      </div>

      {/* Action buttons */}
      {!selectionMode && (
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {hasSession ? (
            <>
              {clips.map(c => (
                <ActionBtn key={c.id} onClick={() => onLoadClip(c)} loading={loading} dim>
                  {channelLabel(c.channel)}
                </ActionBtn>
              ))}
              {onLoadSession && <ActionBtn onClick={onLoadSession} loading={loading}>Load all</ActionBtn>}
            </>
          ) : (
            <ActionBtn onClick={() => onLoadClip(primary)} loading={loading}>Load</ActionBtn>
          )}
        </div>
      )}

      {selectionMode && (
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {hasSession ? (
            clips.map(c => {
              const sel = selectedIds.has(c.id)
              return (
                <ActionBtn key={c.id} onClick={() => onSelectClip(c)} loading={false} active={sel}>
                  {sel ? '✓ ' : '+ '}{channelShort(c.channel)}
                </ActionBtn>
              )
            })
          ) : (
            <ActionBtn onClick={() => onSelectClip(primary)} loading={false} active={selectedIds.has(primary.id)}>
              {selectedIds.has(primary.id) ? '✓ Selected' : '+ Add to session'}
            </ActionBtn>
          )}
        </div>
      )}

      {loading && (
        <div style={{ marginTop: 4, height: 2, background: 'var(--s3)', borderRadius: 1, overflow: 'hidden' }}>
          <div style={{
            height: '100%', background: 'linear-gradient(90deg,var(--acc2),var(--acc))',
            animation: 'dashtrack-progress 1.4s ease infinite',
          }} />
        </div>
      )}
    </div>
  )
}

function ChannelBadge({ channel }: { channel: string }) {
  const color = channelColor(channel)
  return (
    <span style={{
      fontFamily: 'var(--mono)', fontSize: 9, fontWeight: 700,
      color, border: `1px solid ${color}`, borderRadius: 3,
      padding: '1px 4px', opacity: 0.9, letterSpacing: '.05em',
    }}>
      {channelShort(channel)}
    </span>
  )
}

function ActionBtn({ children, onClick, loading, dim, active }: {
  children: React.ReactNode
  onClick: () => void
  loading?: boolean
  dim?: boolean
  active?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      style={{
        fontFamily: 'var(--mono)', fontSize: 10,
        padding: '3px 8px',
        background: active ? 'var(--acc-dim)' : dim ? 'transparent' : 'var(--s3)',
        border: `1px solid ${active ? 'rgba(245,197,66,.4)' : 'var(--b2)'}`,
        borderRadius: 5, color: active ? 'var(--acc)' : 'var(--txt2)',
        cursor: loading ? 'wait' : 'pointer',
        opacity: loading ? 0.6 : 1,
        transition: 'all .1s',
      }}
    >
      {children}
    </button>
  )
}

// ── Helpers ───────────────────────────────────────────────────

function fmtDur(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  return h ? `${h}h ${m}m` : m ? `${m}m ${s}s` : `${s}s`
}

function formatDate(dateStr: string): string {
  if (dateStr === 'Unknown date') return dateStr
  try {
    return new Date(dateStr + 'T00:00:00').toLocaleDateString(undefined, {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    })
  } catch {
    return dateStr
  }
}
