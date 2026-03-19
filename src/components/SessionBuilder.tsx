import { useState, useMemo } from 'react'
import { MdErrorOutline, MdArrowUpward, MdArrowDownward, MdClose } from 'react-icons/md'
import { useStore, SessionClip } from '../store'
import { fetchClip, LibraryClip, FOOTAGE_BASE } from '../api/library'
import LibraryView from './LibraryView'
import { parseGPX, fmtTime } from '../hooks/useGPX'

export default function SessionBuilder() {
  const { buildMultiSession, setAppMode } = useStore()
  const [selectedClips, setSelectedClips] = useState<LibraryClip[]>([])
  const [clipDetails, setClipDetails] = useState<Map<string, { duration: number; gpx: string | null }>>(new Map())
  const [trims, setTrims] = useState<Map<string, [number, number]>>(new Map())
  const [building, setBuilding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedIds = useMemo(() => new Set(selectedClips.map(c => c.id)), [selectedClips])

  const handleSelect = async (clip: LibraryClip) => {
    if (selectedIds.has(clip.id)) {
      setSelectedClips(prev => prev.filter(c => c.id !== clip.id))
      setTrims(prev => { const m = new Map(prev); m.delete(clip.id); return m })
      return
    }

    setSelectedClips(prev => [...prev, clip])

    // Fetch duration if not yet known
    if (!clipDetails.has(clip.id)) {
      try {
        const detail = await fetchClip(clip.id)
        const dur = detail.duration_sec ?? 0
        setClipDetails(prev => new Map(prev).set(clip.id, { duration: dur, gpx: detail.gpx }))
        setTrims(prev => new Map(prev).set(clip.id, [0, dur]))
      } catch (e: any) {
        setError(e.message)
      }
    }
  }

  const removeClip = (id: string) => {
    setSelectedClips(prev => prev.filter(c => c.id !== id))
    setTrims(prev => { const m = new Map(prev); m.delete(id); return m })
  }

  const moveClip = (id: string, dir: -1 | 1) => {
    setSelectedClips(prev => {
      const idx = prev.findIndex(c => c.id === id)
      if (idx < 0) return prev
      const next = [...prev]
      const swapIdx = idx + dir
      if (swapIdx < 0 || swapIdx >= next.length) return prev
      ;[next[idx], next[swapIdx]] = [next[swapIdx], next[idx]]
      return next
    })
  }

  const handleBuild = async () => {
    if (selectedClips.length === 0) return
    setBuilding(true)
    setError(null)

    try {
      const sessionClips: SessionClip[] = []
      const clipById = new Map(selectedClips.map(c => [c.id, c]))
      const processed = new Set<string>()

      for (const clip of selectedClips) {
        if (processed.has(clip.id)) continue

        // Detect F+R pair: if both channels of the same session are selected, group them
        const peerClipEntry = clip.peer_clip_id ? clipById.get(clip.peer_clip_id) : undefined
        let primary = clip
        let secondary = peerClipEntry ?? null

        if (secondary) {
          // Always use front as primary
          if (clip.channel === 'rear') {
            primary = secondary
            secondary = clip
          }
          processed.add(secondary.id)
        }
        processed.add(primary.id)

        let detail = clipDetails.get(primary.id)
        if (!detail) {
          const d = await fetchClip(primary.id)
          detail = { duration: d.duration_sec ?? 0, gpx: d.gpx }
          setClipDetails(prev => new Map(prev).set(primary.id, detail!))
        }

        const [trimStart, trimEnd] = trims.get(primary.id) ?? [0, detail.duration]
        const allPoints = detail.gpx ? parseGPX(detail.gpx) : []
        const gpxPoints = allPoints.filter(p => p.videoSec >= trimStart && p.videoSec <= trimEnd)

        sessionClips.push({
          clipId: primary.id,
          channel: primary.channel,
          trimStart,
          trimEnd,
          videoUrl: `${FOOTAGE_BASE}/api/footage/${primary.id}`,
          peerVideoUrl: secondary ? `${FOOTAGE_BASE}/api/footage/${secondary.id}` : undefined,
          gpxPoints,
          videoOffset: 0,
          color: '',
          filename: primary.filename,
          recordedAt: primary.recorded_at,
        })
      }

      buildMultiSession(sessionClips)
      setAppMode('upload')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBuilding(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>

      {/* Header */}
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--b2)', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--txt2)', flex: 1 }}>
          Session Builder
          {selectedClips.length > 0 && (
            <span style={{ color: 'var(--acc)', marginLeft: 6 }}>({selectedClips.length} clips)</span>
          )}
        </span>
        <SmallBtn
          onClick={handleBuild}
          disabled={selectedClips.length === 0 || building}
          accent
        >
          {building ? 'Building…' : 'Build Session'}
        </SmallBtn>
        <SmallBtn onClick={() => setAppMode('library')}>Cancel</SmallBtn>
      </div>

      {error && (
        <div style={{ padding: '6px 12px', color: 'var(--red)', fontFamily: 'var(--mono)', fontSize: 10, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
          <MdErrorOutline size={14} style={{ flexShrink: 0 }} /> {error}
        </div>
      )}

      {/* Selected clips list */}
      {selectedClips.length > 0 && (
        <div style={{ flexShrink: 0, borderBottom: '1px solid var(--b2)', maxHeight: 200, overflowY: 'auto' }}>
          <div style={{ padding: '5px 12px 2px', fontSize: 9, textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--txt3)', fontFamily: 'var(--mono)' }}>
            Session clips — drag to reorder
          </div>
          {selectedClips.map((clip, i) => {
            const detail = clipDetails.get(clip.id)
            const [trimStart, trimEnd] = trims.get(clip.id) ?? [0, detail?.duration ?? 0]
            const dur = detail?.duration ?? 0

            return (
              <div key={clip.id} style={{ padding: '5px 12px', borderBottom: '1px solid var(--b1)', display: 'flex', alignItems: 'center', gap: 6 }}>
                {/* Order indicator with segment color */}
                <div style={{
                  width: 14, height: 14, borderRadius: '50%', flexShrink: 0,
                  background: SEGMENT_COLORS[i % SEGMENT_COLORS.length],
                  fontFamily: 'var(--mono)', fontSize: 9, color: '#000', fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>{i + 1}</div>

                {/* Filename */}
                <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--txt2)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {clip.filename}
                </span>

                {/* Trim range */}
                {dur > 0 && (
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--txt3)', whiteSpace: 'nowrap' }}>
                    {fmtTime(trimStart)}–{fmtTime(trimEnd)}
                  </span>
                )}

                {/* Move buttons */}
                <SmallBtn onClick={() => moveClip(clip.id, -1)} disabled={i === 0}><MdArrowUpward size={13} /></SmallBtn>
                <SmallBtn onClick={() => moveClip(clip.id, 1)} disabled={i === selectedClips.length - 1}><MdArrowDownward size={13} /></SmallBtn>
                <SmallBtn onClick={() => removeClip(clip.id)}><MdClose size={13} /></SmallBtn>
              </div>
            )
          })}
        </div>
      )}

      {/* Library list in selection mode */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '5px 12px 2px', fontSize: 9, textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--txt3)', fontFamily: 'var(--mono)', flexShrink: 0 }}>
          Click clips to add to session
        </div>
        <LibraryView
          selectionMode
          selectedIds={selectedIds}
          onSelect={handleSelect}
        />
      </div>
    </div>
  )
}

const SEGMENT_COLORS = ['#f5c542', '#00e5a0', '#4da6ff', '#ff6b6b', '#c084fc', '#fb923c']

function SmallBtn({ children, onClick, disabled, accent }: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  accent?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        fontFamily: 'var(--mono)', fontSize: 10, padding: '3px 7px',
        background: accent ? 'var(--acc-dim)' : 'var(--s3)',
        border: `1px solid ${accent ? 'rgba(245,197,66,.4)' : 'var(--b2)'}`,
        borderRadius: 5, color: accent ? 'var(--acc)' : 'var(--txt2)',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      {children}
    </button>
  )
}
