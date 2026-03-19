import { useEffect, useMemo, useRef, useState } from 'react'
import { DayPicker } from 'react-day-picker'
import type { DateRange } from 'react-day-picker'
import 'react-day-picker/style.css'
import { MdClose, MdExpandMore, MdCalendarMonth, MdUpload } from 'react-icons/md'
import { useStore } from '../store'
import type { SessionClip } from '../store'
import { fetchLibrary, fetchClip, fetchSession, LibraryClip, FOOTAGE_BASE } from '../api/library'
import { parseGPX } from '../hooks/useGPX'
import UploadZone from './UploadZone'

type LoadChannel = 'front' | 'rear' | 'both'
type ChannelFilter = 'all' | 'front' | 'rear'
type DisplayItem = { primary: LibraryClip; peer?: LibraryClip }

function buildPresets(): { label: string; range: DateRange }[] {
  const d = (y: number, m: number, day: number) => new Date(y, m, day)
  const now  = new Date()
  const y    = now.getFullYear()
  const mo   = now.getMonth()
  const day  = now.getDate()
  const dow  = now.getDay() // 0=Sun
  const weekStart = day - ((dow + 6) % 7) // Mon-based

  return [
    { label: 'Today',      range: { from: d(y, mo, day),     to: d(y, mo, day) } },
    { label: 'Yesterday',  range: { from: d(y, mo, day - 1), to: d(y, mo, day - 1) } },
    { label: 'This week',  range: { from: d(y, mo, weekStart), to: d(y, mo, weekStart + 6) } },
    { label: 'Last week',  range: { from: d(y, mo, weekStart - 7), to: d(y, mo, weekStart - 1) } },
    { label: 'This month', range: { from: d(y, mo, 1), to: d(y, mo + 1, 0) } },
    { label: 'Last month', range: { from: d(y, mo - 1, 1), to: d(y, mo, 0) } },
    { label: 'This year',  range: { from: d(y, 0, 1), to: d(y, 11, 31) } },
  ]
}
const DATE_PRESETS = buildPresets()

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
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>('all')
  const [dateRange, setDateRange] = useState<DateRange | undefined>()
  const [showDatePicker, setShowDatePicker] = useState(false)
  const datePickerRef = useRef<HTMLDivElement>(null)
  const [collapsedDates, setCollapsedDates] = useState<Set<string>>(new Set())

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
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showDatePicker) { setShowDatePicker(false); return }
        onClose()
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose, showDatePicker])

  // Close date picker on outside click
  useEffect(() => {
    if (!showDatePicker) return
    const h = (e: MouseEvent) => {
      if (datePickerRef.current && !datePickerRef.current.contains(e.target as Node))
        setShowDatePicker(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [showDatePicker])

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

  // Apply channel filter
  const filteredItems = useMemo(() => {
    if (channelFilter === 'front') {
      return displayItems.filter(item => item.primary.channel === 'front')
    }
    if (channelFilter === 'rear') {
      return displayItems.filter(item =>
        item.primary.channel === 'rear' || (item.peer?.channel === 'rear')
      )
    }
    return displayItems
  }, [displayItems, channelFilter])

  // Group by date (newest first), then apply date range filter
  const grouped = useMemo(() => {
    const groups: Record<string, DisplayItem[]> = {}
    for (const item of filteredItems) {
      const date = item.primary.recorded_at?.slice(0, 10) ?? 'Unknown'
      if (!groups[date]) groups[date] = []
      groups[date].push(item)
    }
    let entries = Object.entries(groups).sort(([a], [b]) => b.localeCompare(a))
    if (dateRange?.from) {
      const norm = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
      const from = norm(dateRange.from)
      const to   = norm(dateRange.to ?? dateRange.from)
      entries = entries.filter(([date]) => {
        if (date === 'Unknown') return false
        const d = norm(new Date(date + 'T12:00:00'))
        return d >= from && d <= to
      })
    }
    return entries
  }, [filteredItems, dateRange])

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

  const toggleDateCollapse = (date: string) => {
    setCollapsedDates(prev => {
      const next = new Set(prev)
      next.has(date) ? next.delete(date) : next.add(date)
      return next
    })
  }

  const selectAll = () => {
    const allKeys = grouped.flatMap(([, items]) => items).map(item => itemKey(item))
    setChecked(new Set(allKeys))
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
    if (checkedItems.length === 1 && channel === 'both') {
      loadBoth(checkedItems[0])
      return
    }

    const sorted = [...checkedItems].sort((a, b) =>
      (a.primary.recorded_at ?? '').localeCompare(b.primary.recorded_at ?? '')
    )

    setLoadingId('multi')
    try {
      const sessionClips: SessionClip[] = []

      for (const item of sorted) {
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

  const totalVisible = grouped.reduce((sum, [, items]) => sum + items.length, 0)

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
                  display: 'flex', alignItems: 'center', gap: 5,
                }}
              >
                {t === 'library' ? 'Library' : <><MdUpload size={14} />Upload</>}
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
              padding: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all .1s',
            }}
          ><MdClose size={16} /></button>
        </div>

        {/* ── Filter bar (library tab only) ── */}
        {tab === 'library' && !loading && !error && displayItems.length > 0 && (
          <div style={{
            padding: '7px 16px',
            borderBottom: '1px solid var(--b1)',
            display: 'flex', alignItems: 'center', gap: 8,
            flexShrink: 0,
            background: 'var(--s2)',
          }}>
            {/* Channel filter */}
            <div style={{ display: 'flex', gap: 3 }}>
              {(['all', 'front', 'rear'] as const).map(ch => {
                const active = channelFilter === ch
                const accent = ch === 'rear' ? '#4da6ff' : ch === 'all' ? 'var(--grn)' : 'var(--acc)'
                const accentDim = ch === 'rear' ? 'rgba(77,166,255,.1)' : ch === 'all' ? 'rgba(0,229,160,.1)' : 'var(--acc-dim)'
                const accentBorder = ch === 'rear' ? 'rgba(77,166,255,.4)' : ch === 'all' ? 'rgba(0,229,160,.4)' : 'rgba(245,197,66,.4)'
                return (
                  <button
                    key={ch}
                    onClick={() => setChannelFilter(ch)}
                    style={{
                      fontFamily: 'var(--mono)', fontSize: 10,
                      padding: '3px 8px',
                      background: active ? accentDim : 'transparent',
                      border: `1px solid ${active ? accentBorder : 'var(--b2)'}`,
                      borderRadius: 5,
                      color: active ? accent : 'var(--txt3)',
                      cursor: 'pointer', transition: 'all .1s',
                    }}
                  >
                    {ch === 'all' ? 'All' : ch === 'front' ? 'F' : 'R'}
                  </button>
                )
              })}
            </div>

            <div style={{ width: 1, height: 16, background: 'var(--b3)', flexShrink: 0 }} />

            {/* Date range picker */}
            <div ref={datePickerRef} style={{ position: 'relative' }}>
              <button
                onClick={() => setShowDatePicker(p => !p)}
                style={{
                  fontFamily: 'var(--mono)', fontSize: 10,
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '3px 8px',
                  background: dateRange?.from ? 'var(--acc-dim)' : 'transparent',
                  border: `1px solid ${dateRange?.from ? 'rgba(245,197,66,.4)' : 'var(--b2)'}`,
                  borderRadius: 5,
                  color: dateRange?.from ? 'var(--acc)' : 'var(--txt3)',
                  cursor: 'pointer', transition: 'all .1s',
                }}
              >
                <MdCalendarMonth size={13} />
                {dateRange?.from
                  ? dateRange.to && dateRange.to.getTime() !== dateRange.from.getTime()
                    ? `${fmtDate(dateRange.from)} – ${fmtDate(dateRange.to)}`
                    : fmtDate(dateRange.from)
                  : 'Date range'}
              </button>

              {showDatePicker && (
                <div style={{
                  position: 'absolute', top: 'calc(100% + 6px)', left: 0,
                  zIndex: 200,
                  background: 'var(--s1)',
                  border: '1px solid var(--b3)',
                  borderRadius: 10,
                  boxShadow: '0 8px 32px rgba(0,0,0,.6)',
                  padding: '4px 8px 8px',
                }}>
                  <style>{`
                    .dt-rdp { --rdp-accent-color:#f5c542; --rdp-accent-background-color:rgba(245,197,66,.12);
                      --rdp-range_middle-background-color:rgba(245,197,66,.1); --rdp-range_middle-color:#f5c542;
                      --rdp-range_start-color:#09090c; --rdp-range_end-color:#09090c;
                      --rdp-range_start-date-background-color:#c99b10; --rdp-range_end-date-background-color:#c99b10;
                      --rdp-day-height:34px; --rdp-day-width:34px;
                      --rdp-day_button-height:32px; --rdp-day_button-width:32px;
                      --rdp-day_button-border-radius:6px;
                      --rdp-nav_button-height:1.4rem; --rdp-nav_button-width:1.4rem;
                      --rdp-nav-height:2.2rem;
                      color:#dde2ec; font-family:'JetBrains Mono',monospace; font-size:11px; }
                    .dt-rdp .rdp-chevron { fill:#6e7a8a; width:14px; height:14px }
                    .dt-rdp .rdp-month_caption { justify-content:center; font-size:11px; font-weight:600; color:#dde2ec }
                    .dt-rdp .rdp-weekday { color:#6e7a8a; font-size:10px }
                    .dt-rdp .rdp-day_button:hover:not(:disabled) { background:rgba(255,255,255,.06) }
                    .dt-rdp .rdp-selected { font-size:inherit; font-weight:inherit }
                    .dt-rdp .rdp-selected .rdp-day_button { border-color:transparent }
                    .dt-rdp .rdp-today:not(.rdp-outside):not(.rdp-selected) .rdp-day_button { color:#f5c542 }
                    .dt-rdp .rdp-outside { opacity:.35 }
                  `}</style>
                  <div style={{ display: 'flex' }}>
                    {/* Presets */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '8px 8px 8px 4px', borderRight: '1px solid var(--b2)', minWidth: 96 }}>
                      {DATE_PRESETS.map(({ label, range }) => {
                        const rf = range.from!
                        const rt = range.to ?? rf
                        const active = dateRange?.from?.getTime() === rf.getTime() &&
                          (dateRange?.to?.getTime() ?? rf.getTime()) === rt.getTime()
                        return (
                          <button
                            key={label}
                            onClick={() => setDateRange(active ? undefined : range)}
                            style={{
                              fontFamily: 'var(--mono)', fontSize: 11,
                              padding: '4px 8px', textAlign: 'left',
                              background: active ? 'var(--acc-dim)' : 'transparent',
                              border: `1px solid ${active ? 'rgba(245,197,66,.4)' : 'transparent'}`,
                              borderRadius: 5,
                              color: active ? 'var(--acc)' : 'var(--txt3)',
                              cursor: 'pointer', transition: 'all .1s', whiteSpace: 'nowrap',
                            }}
                          >{label}</button>
                        )
                      })}
                    </div>

                    <DayPicker
                      className="dt-rdp"
                      mode="range"
                      selected={dateRange}
                      onSelect={setDateRange}
                      showOutsideDays
                    />
                  </div>
                </div>
              )}
            </div>
            {dateRange?.from && (
              <button
                onClick={() => { setDateRange(undefined); setShowDatePicker(false) }}
                title="Clear date filter"
                style={{
                  background: 'transparent', border: '1px solid var(--b2)',
                  borderRadius: 5, color: 'var(--txt3)', cursor: 'pointer',
                  padding: '3px 5px', display: 'flex', alignItems: 'center',
                }}
              ><MdClose size={13} /></button>
            )}

            <div style={{ flex: 1 }} />

            {/* Showing count */}
            {(channelFilter !== 'all' || dateRange?.from) && (
              <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--txt3)' }}>
                {totalVisible} shown
              </span>
            )}

            {/* Select all */}
            <button
              onClick={selectAll}
              disabled={totalVisible === 0}
              style={{
                fontFamily: 'var(--mono)', fontSize: 10,
                padding: '3px 9px',
                background: 'transparent',
                border: '1px solid var(--b2)',
                borderRadius: 5, color: 'var(--txt3)',
                cursor: totalVisible === 0 ? 'default' : 'pointer',
                opacity: totalVisible === 0 ? 0.4 : 1,
                transition: 'all .1s',
              }}
            >
              Select all
            </button>
          </div>
        )}

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

          {!loading && !error && displayItems.length > 0 && totalVisible === 0 && (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--txt3)', fontFamily: 'var(--mono)', fontSize: 11 }}>
              No recordings match the current filter.
            </div>
          )}

          {grouped.map(([date, items]) => {
            const isCollapsed = collapsedDates.has(date)
            return (
              <div key={date}>
                {/* Date header — clickable to collapse/expand */}
                <button
                  onClick={() => toggleDateCollapse(date)}
                  style={{
                    width: '100%', textAlign: 'left',
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '9px 16px 7px',
                    position: 'sticky', top: 0, zIndex: 1,
                    background: 'var(--s1)',
                    border: 'none', borderBottom: '1px solid var(--b1)',
                    cursor: 'pointer',
                    transition: 'background .1s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--s2)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'var(--s1)')}
                >
                  <span style={{
                    fontSize: 11, fontWeight: 700,
                    color: 'var(--txt2)', fontFamily: 'var(--mono)',
                    letterSpacing: '.04em',
                  }}>
                    {formatDate(date)}
                  </span>
                  <span style={{
                    fontSize: 10, color: 'var(--txt3)', fontFamily: 'var(--mono)',
                  }}>
                    ({items.length})
                  </span>
                  <MdExpandMore
                    size={18}
                    style={{
                      marginLeft: 'auto',
                      color: 'var(--txt3)',
                      transform: isCollapsed ? 'rotate(-90deg)' : 'none',
                      transition: 'transform .15s',
                      flexShrink: 0,
                    }}
                  />
                </button>

                {/* Clip rows — hidden when collapsed */}
                {!isCollapsed && items.map(item => {
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
                            {channelFilter !== 'rear' && <ChannelBadge channel={item.primary.channel} />}
                            {item.peer && channelFilter !== 'front' && <ChannelBadge channel={item.peer.channel} />}
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
                              {hasBoth && channelFilter === 'all' ? (
                                <>
                                  <RowBtn onClick={() => loadSingle(item.primary)} loading={isRowLoading} dim>Front</RowBtn>
                                  <RowBtn onClick={() => loadSingle(item.peer!)} loading={isRowLoading} dim>Rear</RowBtn>
                                  <RowBtn onClick={() => loadBoth(item)} loading={isRowLoading} green>Load Both</RowBtn>
                                </>
                              ) : channelFilter === 'rear' ? (
                                <RowBtn onClick={() => loadSingle(item.peer ?? item.primary)} loading={isRowLoading}>Load</RowBtn>
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
            )
          })}
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
                {channelFilter === 'front' ? (
                  <FooterBtn onClick={() => handleMultiLoad('front')}>Load Front</FooterBtn>
                ) : channelFilter === 'rear' ? (
                  <FooterBtn onClick={() => handleMultiLoad('rear')}>Load Rear</FooterBtn>
                ) : (
                  <>
                    <FooterBtn onClick={() => handleMultiLoad('front')}>Front</FooterBtn>
                    <FooterBtn onClick={() => handleMultiLoad('rear')} disabled={!checkedItems.some(i => !!i.peer)}>
                      Rear
                    </FooterBtn>
                    <FooterBtn onClick={() => handleMultiLoad('both')} green disabled={!allHavePeer}>
                      Both
                    </FooterBtn>
                  </>
                )}
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

function RowBtn({ children, onClick, loading, dim, green }: {
  children: React.ReactNode
  onClick: () => void
  loading?: boolean
  dim?: boolean
  green?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      style={{
        fontFamily: 'var(--mono)', fontSize: 10,
        padding: '3px 9px',
        background: green ? 'rgba(0,229,160,.1)' : dim ? 'transparent' : 'var(--s3)',
        border: `1px solid ${green ? 'rgba(0,229,160,.4)' : 'var(--b2)'}`,
        borderRadius: 5,
        color: green ? 'var(--grn)' : 'var(--txt2)',
        cursor: loading ? 'wait' : 'pointer',
        opacity: loading ? 0.5 : 1,
        transition: 'all .1s',
      }}
    >
      {children}
    </button>
  )
}

function FooterBtn({ children, onClick, green, disabled }: {
  children: React.ReactNode
  onClick: () => void
  green?: boolean
  disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        fontFamily: 'var(--mono)', fontSize: 11,
        padding: '5px 14px',
        background: green ? 'rgba(0,229,160,.1)' : 'var(--s3)',
        border: `1px solid ${green ? 'rgba(0,229,160,.4)' : 'var(--b2)'}`,
        borderRadius: 6,
        color: green ? 'var(--grn)' : disabled ? 'var(--txt3)' : 'var(--txt2)',
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

function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function formatDate(dateStr: string): string {
  if (dateStr === 'Unknown') return 'Unknown date'
  try {
    return new Date(dateStr + 'T00:00:00').toLocaleDateString(undefined, {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    })
  } catch { return dateStr }
}
