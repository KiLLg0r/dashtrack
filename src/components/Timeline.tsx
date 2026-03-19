import { useMemo, useRef, useEffect } from 'react'
import { useStore, GPSPoint } from '../store'
import { totalDistance, fmtDuration } from '../hooks/useGPX'

export default function Timeline() {
  const { points, currentIdx, extractionStatus, multiSession } = useStore()
  const activeRef       = useRef<HTMLDivElement>(null)
  const scrollRef       = useRef<HTMLDivElement>(null)
  const isAutoScrolling = useRef(false)
  const userScrolled    = useRef(false)

  // Build display items — flat list of waypoints with optional segment dividers
  const items = useMemo(() => {
    if (!points.length) return []

    if (multiSession) {
      // One group per segment, each downsampled to ~30 items (max 120 total)
      const maxPerSeg = Math.max(10, Math.floor(120 / multiSession.clips.length))
      const result: Array<
        | { type: 'divider'; segIdx: number; label: string; color: string }
        | { type: 'point'; idx: number; p: GPSPoint }
      > = []

      multiSession.clips.forEach((clip, si) => {
        const offset = multiSession.clipPointOffsets[si]
        const segPts = clip.gpxPoints
        const step = Math.max(1, Math.floor(segPts.length / maxPerSeg))
        const dateStr = clip.recordedAt
          ? new Date(clip.recordedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
          : clip.filename

        result.push({ type: 'divider', segIdx: si, label: `${si + 1}. ${dateStr}`, color: clip.color })
        segPts.forEach((p, i) => {
          if (i % step === 0 || i === segPts.length - 1) {
            result.push({ type: 'point', idx: offset + i, p })
          }
        })
      })
      return result
    }

    // Single clip — downsample to ~120 items
    const step = Math.max(1, Math.floor(points.length / 120))
    return points
      .map((p, i) => ({ type: 'point' as const, idx: i, p }))
      .filter((_, i) => i % step === 0 || i === points.length - 1)
  }, [points, multiSession])

  const stats = useMemo(() => {
    if (!points.length) return null
    const dist = totalDistance(points)
    const spds = points.map(p => p.speed).filter(s => s > 0)
    const maxSpd = spds.length ? Math.round(Math.max(...spds)) : null
    const dur = points[0].time && points[points.length - 1].time
      ? fmtDuration(points[points.length - 1].time!.getTime() - points[0].time!.getTime())
      : null
    return {
      dist: dist > 1000 ? `${(dist / 1000).toFixed(1)} km` : `${Math.round(dist)} m`,
      maxSpd: maxSpd ? `${maxSpd} km/h` : '—',
      pts: points.length,
      dur: dur ?? (multiSession ? `${multiSession.clips.length} clips` : '—'),
    }
  }, [points, multiSession])

  // Track manual scroll — suppress auto-scroll until user explicitly clicks a waypoint
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = () => { if (!isAutoScrolling.current) userScrolled.current = true }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    if (userScrolled.current) return
    if (!activeRef.current) return
    isAutoScrolling.current = true
    activeRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    const id = setTimeout(() => { isAutoScrolling.current = false }, 600)
    return () => clearTimeout(id)
  }, [currentIdx])

  const seekToIdx = (idx: number) => {
    userScrolled.current = false
    window.dispatchEvent(new CustomEvent('dashtrack:seek', { detail: { idx } }))
    useStore.getState().setCurrentIdx(idx)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', flex: 1 }}>

      {/* Stats row */}
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 1, background: 'var(--b1)', borderBottom: '1px solid var(--b2)', flexShrink: 0 }}>
          {[['Distance', stats.dist], ['Duration', stats.dur], ['Max spd', stats.maxSpd], ['Points', String(stats.pts)]].map(([label, val]) => (
            <div key={label} style={{ background: 'var(--s1)', padding: '6px 10px' }}>
              <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--txt3)', fontFamily: 'var(--mono)' }}>{label}</div>
              <div style={{ fontSize: 13, fontFamily: 'var(--mono)', color: 'var(--txt)' }}>{val}</div>
            </div>
          ))}
        </div>
      )}

      {/* List */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: 10 }}>
        {!points.length ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 12, color: 'var(--txt3)', textAlign: 'center', padding: 20 }}>
            {extractionStatus === 'extracting' || extractionStatus === 'uploading' ? (
              <>
                <div style={{ fontSize: 13, color: 'var(--txt2)' }}>Extracting GPS data…</div>
                <div style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--txt3)' }}>waypoints will appear here</div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 13, color: 'var(--txt2)' }}>Drop a dashcam video to begin</div>
                <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--txt3)', lineHeight: 2 }}>
                  GPS is extracted automatically<br />from the video file
                </div>
              </>
            )}
          </div>
        ) : (
          <>
            {!multiSession && (
              <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--txt3)', fontFamily: 'var(--mono)', marginBottom: 6 }}>
                Waypoints — click to seek
              </div>
            )}

            {items.map((item, i) => {
              if (item.type === 'divider') {
                // Find which clip we're currently in
                const segOffset = multiSession!.clipPointOffsets[item.segIdx]
                const nextOffset = multiSession!.clipPointOffsets[item.segIdx + 1] ?? points.length
                const isActiveSegment = currentIdx >= segOffset && currentIdx < nextOffset

                return (
                  <div key={`div-${item.segIdx}`} style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '6px 4px 4px',
                    borderTop: item.segIdx > 0 ? '1px solid var(--b2)' : 'none',
                    marginTop: item.segIdx > 0 ? 4 : 0,
                  }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: item.color, flexShrink: 0 }} />
                    <span style={{
                      fontFamily: 'var(--mono)', fontSize: 9, textTransform: 'uppercase', letterSpacing: '.08em',
                      color: isActiveSegment ? item.color : 'var(--txt3)',
                    }}>
                      {item.label}
                    </span>
                  </div>
                )
              }

              const { idx, p } = item
              const step = multiSession ? 1 : Math.max(1, Math.floor(points.length / 120))
              const active = Math.abs(idx - currentIdx) < step

              return (
                <div
                  key={idx}
                  ref={active ? activeRef : undefined}
                  onClick={() => seekToIdx(idx)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '5px 7px',
                    borderRadius: 6, cursor: 'pointer',
                    border: `1px solid ${active ? 'rgba(245,197,66,.22)' : 'transparent'}`,
                    background: active ? 'var(--acc-dim)' : 'transparent',
                    transition: 'all .1s',
                  }}
                >
                  <div style={{ width: 7, height: 7, borderRadius: '50%', background: active ? 'var(--acc)' : 'var(--txt3)', flexShrink: 0 }} />
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: active ? 'var(--acc)' : 'var(--txt2)', minWidth: 52 }}>
                    {p.time ? p.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : `pt ${idx}`}
                  </span>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--txt3)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.lat.toFixed(5)}, {p.lon.toFixed(5)}
                  </span>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--txt2)' }}>
                    {p.speed > 0 ? `${Math.round(p.speed)}km/h` : ''}
                  </span>
                </div>
              )
            })}
          </>
        )}
      </div>
    </div>
  )
}
