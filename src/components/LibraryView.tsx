import { useEffect, useMemo, useState } from 'react'
import { MdErrorOutline } from 'react-icons/md'
import { useStore } from '../store'
import { fetchLibrary, fetchClip, fetchSession, LibraryClip } from '../api/library'

interface Props {
  selectionMode?: boolean
  selectedIds?: Set<string>
  onSelect?: (clip: LibraryClip) => void
}

export default function LibraryView({ selectionMode = false, selectedIds = new Set(), onSelect }: Props) {
  const { loadLibraryClip, loadSession } = useStore()
  const [clips, setClips] = useState<LibraryClip[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [loadingId, setLoadingId] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetchLibrary()
      .then(setClips)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  // Deduplicate session pairs — show front+rear as a single display item
  const displayItems = useMemo(() => {
    const seen = new Set<string>()
    const clipMap = new Map(clips.map(c => [c.id, c]))
    const items: { primary: LibraryClip; peer?: LibraryClip }[] = []

    for (const clip of clips) {
      if (seen.has(clip.id)) continue
      seen.add(clip.id)

      if (clip.peer_clip_id && !seen.has(clip.peer_clip_id)) {
        const peer = clipMap.get(clip.peer_clip_id)
        if (peer) {
          seen.add(peer.id)
          // Always put front first
          if (clip.channel === 'front') {
            items.push({ primary: clip, peer })
          } else {
            items.push({ primary: peer ?? clip, peer: peer ? clip : undefined })
          }
          continue
        }
      }
      items.push({ primary: clip })
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

          {items.map(({ primary, peer }) => {
            const isPrimarySelected = selectedIds.has(primary.id)
            const isPeerSelected = peer ? selectedIds.has(peer.id) : false
            const isLoading = loadingId === primary.id || loadingId === (primary.session_id ?? '')
            const hasSession = !!primary.session_id && !!peer

            return (
              <ClipRow
                key={primary.id}
                primary={primary}
                peer={peer}
                selected={isPrimarySelected}
                peerSelected={isPeerSelected}
                loading={isLoading}
                selectionMode={selectionMode}
                onLoadSingle={() => handleLoad(primary)}
                onLoadPeer={peer && !selectionMode ? () => handleLoad(peer) : undefined}
                onLoadSession={hasSession && !selectionMode
                  ? () => handleLoadSession(primary.session_id!, primary.id)
                  : undefined
                }
                onSelectPeer={peer && selectionMode ? () => onSelect?.(peer) : undefined}
              />
            )
          })}
        </div>
      ))}
    </div>
  )
}

// ── ClipRow ───────────────────────────────────────────────────

interface ClipRowProps {
  primary: LibraryClip
  peer?: LibraryClip
  selected: boolean       // primary is selected
  peerSelected?: boolean  // peer is selected
  loading: boolean
  selectionMode: boolean
  onLoadSingle: () => void
  onLoadPeer?: () => void
  onLoadSession?: () => void
  onSelectPeer?: () => void
}

function ClipRow({ primary, peer, selected, peerSelected, loading, selectionMode, onLoadSingle, onLoadPeer, onLoadSession, onSelectPeer }: ClipRowProps) {
  const dur = primary.duration_sec ? fmtDur(primary.duration_sec) : '—'
  const spd = primary.max_speed_kmh ? `${Math.round(primary.max_speed_kmh)} km/h` : '—'
  const time = primary.recorded_at
    ? new Date(primary.recorded_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null

  return (
    <div style={{
      padding: '7px 12px',
      borderBottom: '1px solid var(--b1)',
      background: (selected || peerSelected) ? 'var(--acc-dim)' : 'transparent',
      transition: 'background .1s',
    }}>
      {/* Top row: time + channel badges + duration */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
        {time && (
          <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--txt)', fontWeight: 600 }}>
            {time}
          </span>
        )}
        <ChannelBadge channel={primary.channel} />
        {peer && <ChannelBadge channel={peer.channel} />}
        <span style={{ flex: 1 }} />
        <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--txt3)' }}>{dur}</span>
        {primary.max_speed_kmh && (
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
        <div style={{ display: 'flex', gap: 5 }}>
          {onLoadSession ? (
            <>
              <ActionBtn onClick={onLoadSingle} loading={loading} dim>Front</ActionBtn>
              <ActionBtn onClick={onLoadPeer ?? (() => {})} loading={loading} dim>Rear</ActionBtn>
              <ActionBtn onClick={onLoadSession} loading={loading}>Load Both</ActionBtn>
            </>
          ) : (
            <ActionBtn onClick={onLoadSingle} loading={loading}>Load</ActionBtn>
          )}
        </div>
      )}

      {selectionMode && (
        <div style={{ display: 'flex', gap: 5 }}>
          {peer ? (
            <>
              <ActionBtn onClick={onLoadSingle} loading={false} active={selected}>
                {selected ? '✓ F' : '+ F'}
              </ActionBtn>
              <ActionBtn onClick={() => onSelectPeer?.()} loading={false} active={!!peerSelected}>
                {peerSelected ? '✓ R' : '+ R'}
              </ActionBtn>
            </>
          ) : (
            <ActionBtn onClick={onLoadSingle} loading={false} active={selected}>
              {selected ? '✓ Selected' : '+ Add to session'}
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
