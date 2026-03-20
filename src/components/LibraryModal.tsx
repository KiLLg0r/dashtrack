import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DayPicker } from 'react-day-picker'
import type { DateRange } from 'react-day-picker'
import 'react-day-picker/style.css'
import { MdClose, MdExpandMore, MdCalendarMonth, MdUpload } from 'react-icons/md'
import { useStore } from '../store'
import type { SessionClip } from '../store'
import { fetchLibrary, fetchClip, fetchClipBatch, fetchSession, LibraryClip, FOOTAGE_BASE } from '../api/library'
import { parseGPX } from '../hooks/useGPX'
import UploadZone from './UploadZone'

type LoadChannel = 'front' | 'rear' | 'both'
type ChannelFilter = 'all' | 'front' | 'rear'
type DisplayItem = { primary: LibraryClip; peer?: LibraryClip }

/** Returns 0=Sun, 1=Mon, … 6=Sat from the browser locale (Intl.Locale weekInfo). Falls back to 1. */
function localeWeekStartsOn(): 0 | 1 | 2 | 3 | 4 | 5 | 6 {
  try {
    const loc = new Intl.Locale(navigator.language)
    // weekInfo.firstDay: 1=Mon … 7=Sun (ISO); convert to JS 0=Sun … 6=Sat
    const firstDay: number =
      (loc as any).weekInfo?.firstDay ?? (loc as any).getWeekInfo?.()?.firstDay ?? 1
    return (firstDay % 7) as 0 | 1 | 2 | 3 | 4 | 5 | 6
  } catch {
    return 1
  }
}

function buildPresets(weekStart0: 0 | 1 | 2 | 3 | 4 | 5 | 6): { label: string; range: DateRange }[] {
  const d = (y: number, m: number, day: number) => new Date(y, m, day)
  const now = new Date()
  const y   = now.getFullYear()
  const mo  = now.getMonth()
  const day = now.getDate()
  const dow = now.getDay() // 0=Sun
  // Days since the locale's week start
  const weekStart = day - ((dow - weekStart0 + 7) % 7)

  return [
    { label: 'Today',      range: { from: d(y, mo, day),          to: d(y, mo, day) } },
    { label: 'Yesterday',  range: { from: d(y, mo, day - 1),      to: d(y, mo, day - 1) } },
    { label: 'This week',  range: { from: d(y, mo, weekStart),     to: d(y, mo, weekStart + 6) } },
    { label: 'Last week',  range: { from: d(y, mo, weekStart - 7), to: d(y, mo, weekStart - 1) } },
    { label: 'This month', range: { from: d(y, mo, 1),             to: d(y, mo + 1, 0) } },
    { label: 'Last month', range: { from: d(y, mo - 1, 1),         to: d(y, mo, 0) } },
    { label: 'This year',  range: { from: d(y, 0, 1),              to: d(y, 11, 31) } },
  ]
}

const WEEK_STARTS_ON = localeWeekStartsOn()
const DATE_PRESETS   = buildPresets(WEEK_STARTS_ON)

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
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>('all')
  const [dateRange, setDateRange] = useState<DateRange | undefined>()
  const [showDatePicker, setShowDatePicker] = useState(false)
  const datePickerRef = useRef<HTMLDivElement>(null)
  const [collapsedDates, setCollapsedDates] = useState<Set<string>>(new Set())
  const [fullyLoadedDates, setFullyLoadedDates] = useState<Set<string>>(new Set())
  const [pendingLoad, setPendingLoad] = useState<{ loadingKey: string; df?: string; dt?: string } | null>(null)
  const offsetRef = useRef(0)
  const listRef = useRef<HTMLDivElement>(null)

  const PAGE_SIZE = 100

  // Re-fetch from scratch whenever date range changes (server-side filtering)
  useEffect(() => {
    const df = dateRange?.from ? fmtParam(dateRange.from) : undefined
    const dt = dateRange?.to   ? fmtParam(dateRange.to)   : df
    setLoading(true)
    setError(null)
    setClips([])
    setFullyLoadedDates(new Set())
    offsetRef.current = 0
    fetchLibrary(0, PAGE_SIZE, df, dt)
      .then(data => {
        setClips(data)
        setHasMore(data.length === PAGE_SIZE)
        offsetRef.current = PAGE_SIZE
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [dateRange])

  const loadMore = useCallback(() => {
    if (loadingMore || !hasMore) return
    const df = dateRange?.from ? fmtParam(dateRange.from) : undefined
    const dt = dateRange?.to   ? fmtParam(dateRange.to)   : df
    setLoadingMore(true)
    fetchLibrary(offsetRef.current, PAGE_SIZE, df, dt)
      .then(data => {
        setClips(prev => [...prev, ...data])
        setHasMore(data.length === PAGE_SIZE)
        offsetRef.current += PAGE_SIZE
      })
      .catch(e => setError(e.message))
      .finally(() => setLoadingMore(false))
  }, [loadingMore, hasMore, dateRange])

  // Infinite scroll — triggered only by user scrolling, not by content collapsing
  const handleListScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 300) loadMore()
  }, [loadMore])

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

  // Group by date, newest first — date filtering is done server-side
  const grouped = useMemo(() => {
    const groups: Record<string, DisplayItem[]> = {}
    for (const item of filteredItems) {
      const date = item.primary.recorded_at?.slice(0, 10) ?? 'Unknown'
      if (!groups[date]) groups[date] = []
      groups[date].push(item)
    }
    return Object.entries(groups).sort(([a], [b]) => b.localeCompare(a))
  }, [filteredItems])

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

  const toggleDateGroup = (date: string, items: DisplayItem[]) => {
    const groupKeys = items.map(itemKey)
    const allChecked = groupKeys.every(k => checked.has(k))
    setChecked(prev => {
      const next = new Set(prev)
      if (allChecked) groupKeys.forEach(k => next.delete(k))
      else groupKeys.forEach(k => next.add(k))
      return next
    })
  }

  // ── Load-as-session helper (shared by Load All and Load Day) ─────────────

  const loadAsSession = useCallback(async (loadingKey: string, channel: ChannelFilter, df?: string, dt?: string) => {
    setLoadingId(loadingKey)
    setError(null)
    try {
      const allClips: LibraryClip[] = []
      let off = 0
      while (true) {
        const page = await fetchLibrary(off, PAGE_SIZE, df, dt)
        allClips.push(...page)
        if (page.length < PAGE_SIZE) break
        off += PAGE_SIZE
      }

      const seen = new Set<string>()
      const clipMap = new Map(allClips.map(c => [c.id, c]))
      const items: DisplayItem[] = []
      for (const clip of allClips) {
        if (seen.has(clip.id)) continue
        seen.add(clip.id)
        if (clip.peer_clip_id && !seen.has(clip.peer_clip_id)) {
          const peer = clipMap.get(clip.peer_clip_id)
          if (peer) {
            seen.add(peer.id)
            items.push(clip.channel === 'front' ? { primary: clip, peer } : { primary: peer, peer: clip })
            continue
          }
        }
        items.push({ primary: clip })
      }

      let filtered = items
      if (channel === 'front') filtered = items.filter(i => i.primary.channel === 'front')
      else if (channel === 'rear') filtered = items.filter(i => i.primary.channel === 'rear' || !!i.peer)

      filtered.sort((a, b) => (a.primary.recorded_at ?? '').localeCompare(b.primary.recorded_at ?? ''))

      const useRear = channel === 'rear'
      const primaryIds = filtered.map(item => (useRear && item.peer) ? item.peer.id : item.primary.id)

      const details = await fetchClipBatch(primaryIds)
      const detailMap = new Map(details.map(d => [d.id, d]))

      const sessionClips: SessionClip[] = []
      for (const item of filtered) {
        const primary = (useRear && item.peer) ? item.peer : item.primary
        const peer = (channel === 'all' && item.peer) ? item.peer : undefined
        const detail = detailMap.get(primary.id)
        if (!detail) continue
        const dur = detail.duration_sec ?? 0
        sessionClips.push({
          clipId: primary.id,
          channel: primary.channel,
          trimStart: 0,
          trimEnd: dur,
          videoUrl: `${FOOTAGE_BASE}/api/footage/${primary.id}`,
          peerVideoUrl: peer ? `${FOOTAGE_BASE}/api/footage/${peer.id}` : undefined,
          gpxPoints: detail.gpx ? parseGPX(detail.gpx) : [],
          videoOffset: 0,
          color: '',
          filename: primary.filename,
          recordedAt: primary.recorded_at,
        })
      }

      buildMultiSession(sessionClips)
      onClose()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoadingId(null)
    }
  }, [buildMultiSession, onClose])

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

  // ── Fetch remaining pages into list ─────────────────────────────────────

  const handleFetchAll = async () => {
    setLoadingId('fetch-all')
    setError(null)
    try {
      const df = dateRange?.from ? fmtParam(dateRange.from) : undefined
      const dt = dateRange?.to   ? fmtParam(dateRange.to)   : df
      const fetched: LibraryClip[] = []
      let off = offsetRef.current
      while (true) {
        const page = await fetchLibrary(off, PAGE_SIZE, df, dt)
        fetched.push(...page)
        if (page.length < PAGE_SIZE) break
        off += PAGE_SIZE
      }
      setClips(prev => {
        const existingIds = new Set(prev.map(c => c.id))
        const newClips = fetched.filter(c => !existingIds.has(c.id))
        if (!newClips.length) return prev
        return [...prev, ...newClips].sort((a, b) =>
          (b.recorded_at ?? '').localeCompare(a.recorded_at ?? '')
        )
      })
      setHasMore(false)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoadingId(null)
    }
  }

  const handleFetchDay = async (date: string) => {
    setLoadingId(`fetch-${date}`)
    setError(null)
    try {
      const dayClips: LibraryClip[] = []
      let off = 0
      while (true) {
        const page = await fetchLibrary(off, PAGE_SIZE, date, date)
        dayClips.push(...page)
        if (page.length < PAGE_SIZE) break
        off += PAGE_SIZE
      }
      setClips(prev => {
        const existingIds = new Set(prev.map(c => c.id))
        const newClips = dayClips.filter(c => !existingIds.has(c.id))
        if (!newClips.length) return prev
        return [...prev, ...newClips].sort((a, b) =>
          (b.recorded_at ?? '').localeCompare(a.recorded_at ?? '')
        )
      })
      setFullyLoadedDates(prev => new Set(prev).add(date))
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoadingId(null)
    }
  }

  // ── Load as session ───────────────────────────────────────────────────────

  const hasPairedClips = displayItems.some(item => !!item.peer)

  const handleLoadAll = () => {
    const df = dateRange?.from ? fmtParam(dateRange.from) : undefined
    const dt = dateRange?.to   ? fmtParam(dateRange.to)   : df
    if (hasPairedClips) {
      setPendingLoad({ loadingKey: 'load-all', df, dt })
    } else {
      loadAsSession('load-all', channelFilter, df, dt)
    }
  }

  const handleLoadDay = (date: string, items: DisplayItem[]) => {
    if (items.some(item => !!item.peer)) {
      setPendingLoad({ loadingKey: `load-day-${date}`, df: date, dt: date })
    } else {
      loadAsSession(`load-day-${date}`, channelFilter, date, date)
    }
  }

  const confirmLoad = (channel: ChannelFilter) => {
    if (!pendingLoad) return
    const { loadingKey, df, dt } = pendingLoad
    setPendingLoad(null)
    loadAsSession(loadingKey, channel, df, dt)
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
      // Collect the primary clip ID for each item (respects channel filter)
      const primaryIds = sorted.map(item =>
        (channel === 'rear' && item.peer) ? item.peer.id : item.primary.id
      )

      // Single batch request instead of N individual requests
      const details = await fetchClipBatch(primaryIds)
      const detailMap = new Map(details.map(d => [d.id, d]))

      const sessionClips: SessionClip[] = []
      for (const item of sorted) {
        const primary = (channel === 'rear' && item.peer) ? item.peer : item.primary
        const peerClip = (channel === 'both' && item.peer) ? item.peer : undefined
        const detail = detailMap.get(primary.id)
        if (!detail) continue
        const dur = detail.duration_sec ?? 0
        sessionClips.push({
          clipId: primary.id,
          channel: primary.channel,
          trimStart: 0,
          trimEnd: dur,
          videoUrl: `${FOOTAGE_BASE}/api/footage/${primary.id}`,
          peerVideoUrl: peerClip ? `${FOOTAGE_BASE}/api/footage/${peerClip.id}` : undefined,
          gpxPoints: detail.gpx ? parseGPX(detail.gpx) : [],
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
  // Only the date at the pagination boundary (oldest date in the loaded list) can have incomplete data
  const boundaryDate = clips.length > 0 ? clips[clips.length - 1].recorded_at?.slice(0, 10) : undefined

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
        {tab === 'library' && !loading && !error && clips.length > 0 && (
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
                      weekStartsOn={WEEK_STARTS_ON}
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

            {/* Fetch all — only shown when more pages exist */}
            {hasMore && (
              <button
                onClick={handleFetchAll}
                disabled={loadingId === 'fetch-all'}
                title="Fetch all remaining clips into the list"
                style={{
                  fontFamily: 'var(--mono)', fontSize: 10,
                  padding: '3px 9px',
                  background: 'transparent',
                  border: '1px solid var(--b2)',
                  borderRadius: 5, color: 'var(--txt2)',
                  cursor: loadingId === 'fetch-all' ? 'wait' : 'pointer',
                  opacity: loadingId === 'fetch-all' ? 0.5 : 1,
                  transition: 'all .1s', whiteSpace: 'nowrap',
                }}
              >
                {loadingId === 'fetch-all' ? 'Fetching…' : 'Fetch all'}
              </button>
            )}

            {/* Load all — loads everything as a session */}
            <button
              onClick={handleLoadAll}
              disabled={loadingId === 'load-all'}
              title={`Load all ${channelFilter !== 'all' ? channelFilter + ' ' : ''}clips${dateRange?.from ? ' in selected period' : ''} as a session`}
              style={{
                fontFamily: 'var(--mono)', fontSize: 10,
                padding: '3px 9px',
                background: 'rgba(0,229,160,.08)',
                border: '1px solid rgba(0,229,160,.3)',
                borderRadius: 5, color: 'var(--grn)',
                cursor: loadingId === 'load-all' ? 'wait' : 'pointer',
                opacity: loadingId === 'load-all' ? 0.5 : 1,
                transition: 'all .1s', whiteSpace: 'nowrap',
              }}
            >
              {loadingId === 'load-all' ? 'Loading…' : 'Load all'}
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
        {tab === 'library' && <div ref={listRef} onScroll={handleListScroll} style={{ flex: 1, overflowY: 'auto' }}>
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

          {!loading && !error && clips.length === 0 && (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--txt3)', fontFamily: 'var(--mono)', fontSize: 11, lineHeight: 2.2 }}>
              {dateRange?.from ? 'No recordings match the selected date range.' : <>No clips indexed yet.<br /><code style={{ color: 'var(--txt2)' }}>-v /footage:/footage</code></>}
            </div>
          )}

          {!loading && !error && clips.length > 0 && totalVisible === 0 && (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--txt3)', fontFamily: 'var(--mono)', fontSize: 11 }}>
              No recordings match the current filter.
            </div>
          )}

          {grouped.map(([date, items]) => {
            const isCollapsed = collapsedDates.has(date)
            const groupKeys = items.map(itemKey)
            const checkedCount = groupKeys.filter(k => checked.has(k)).length
            const allGroupChecked = checkedCount === groupKeys.length
            const someGroupChecked = checkedCount > 0 && !allGroupChecked
            const dayFetching = loadingId === `fetch-${date}`
            const dayLoadingSession = loadingId === `load-day-${date}`
            const dayFullyLoaded = !hasMore || fullyLoadedDates.has(date) || date !== boundaryDate
            return (
              <div key={date}>
                {/* Date header */}
                <div
                  style={{
                    width: '100%',
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '9px 16px 7px',
                    position: 'sticky', top: 0, zIndex: 1,
                    background: 'var(--s1)',
                    borderBottom: '1px solid var(--b1)',
                    transition: 'background .1s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--s2)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'var(--s1)')}
                >
                  {/* Group checkbox */}
                  <GroupCheckbox
                    checked={allGroupChecked}
                    indeterminate={someGroupChecked}
                    onChange={() => toggleDateGroup(date, items)}
                  />

                  {/* Collapse toggle area */}
                  <div
                    onClick={() => toggleDateCollapse(date)}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, cursor: 'pointer', minWidth: 0 }}
                  >
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--txt2)', fontFamily: 'var(--mono)', letterSpacing: '.04em', whiteSpace: 'nowrap' }}>
                      {formatDate(date)}
                    </span>
                    <span style={{ fontSize: 10, color: 'var(--txt3)', fontFamily: 'var(--mono)', whiteSpace: 'nowrap' }}>
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
                  </div>

                  {/* Fetch day — hidden once all clips for that day are in the list */}
                  {!dayFullyLoaded && (
                    <button
                      onClick={e => { e.stopPropagation(); handleFetchDay(date) }}
                      disabled={dayFetching}
                      title={`Fetch all clips from ${formatDate(date)} into the list`}
                      style={{
                        fontFamily: 'var(--mono)', fontSize: 9,
                        padding: '2px 7px',
                        background: 'transparent',
                        border: '1px solid var(--b2)',
                        borderRadius: 4, color: 'var(--txt2)',
                        cursor: dayFetching ? 'wait' : 'pointer',
                        opacity: dayFetching ? 0.5 : 1,
                        whiteSpace: 'nowrap', flexShrink: 0,
                        transition: 'all .1s',
                      }}
                    >
                      {dayFetching ? '…' : 'Fetch day'}
                    </button>
                  )}

                  {/* Load day — always visible, loads that day as a session */}
                  <button
                    onClick={e => { e.stopPropagation(); handleLoadDay(date, items) }}
                    disabled={dayLoadingSession}
                    title={`Load all clips from ${formatDate(date)} as a session`}
                    style={{
                      fontFamily: 'var(--mono)', fontSize: 9,
                      padding: '2px 7px',
                      background: 'rgba(0,229,160,.08)',
                      border: '1px solid rgba(0,229,160,.3)',
                      borderRadius: 4, color: 'var(--grn)',
                      cursor: dayLoadingSession ? 'wait' : 'pointer',
                      opacity: dayLoadingSession ? 0.5 : 1,
                      whiteSpace: 'nowrap', flexShrink: 0,
                      transition: 'all .1s',
                    }}
                  >
                    {dayLoadingSession ? '…' : 'Load day'}
                  </button>
                </div>

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
                                  <RowBtn onClick={() => loadBoth(item)} loading={isRowLoading}>Load Both</RowBtn>
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
          {loadingMore && (
            <div style={{ padding: '10px 16px', textAlign: 'center', color: 'var(--txt3)', fontFamily: 'var(--mono)', fontSize: 10 }}>
              Loading more…
            </div>
          )}
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

      {/* ── Channel picker popup ── */}
      {pendingLoad && (
        <div
          style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 10,
          }}
          onClick={() => setPendingLoad(null)}
        >
          <div
            style={{
              background: 'var(--s2)',
              border: '1px solid var(--b3)',
              borderRadius: 10,
              padding: '20px 24px',
              display: 'flex', flexDirection: 'column', gap: 14,
              boxShadow: '0 8px 40px rgba(0,0,0,.7)',
              minWidth: 240,
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* Title row with X */}
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--txt2)', fontWeight: 700, flex: 1 }}>
                Select channel
              </span>
              <button
                onClick={() => setPendingLoad(null)}
                style={{
                  background: 'transparent', border: '1px solid var(--b2)',
                  borderRadius: 5, color: 'var(--txt3)', cursor: 'pointer',
                  padding: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <MdClose size={14} />
              </button>
            </div>

            {/* Channel buttons */}
            <div style={{ display: 'flex', gap: 8 }}>
              <FooterBtn onClick={() => confirmLoad('front')}>Front</FooterBtn>
              <FooterBtn onClick={() => confirmLoad('rear')}>Rear</FooterBtn>
              <FooterBtn onClick={() => confirmLoad('all')}>Both</FooterBtn>
            </div>

            {/* Cancel */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
              <button
                onClick={() => setPendingLoad(null)}
                style={{
                  fontFamily: 'var(--mono)', fontSize: 10,
                  background: 'transparent', border: 'none',
                  color: 'var(--txt3)', cursor: 'pointer',
                  padding: 0,
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────

function GroupCheckbox({ checked, indeterminate, onChange }: {
  checked: boolean
  indeterminate: boolean
  onChange: () => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate
  }, [indeterminate])
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={onChange}
      onClick={e => e.stopPropagation()}
      style={{ cursor: 'pointer', accentColor: 'var(--acc)', width: 14, height: 14, flexShrink: 0 }}
    />
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

function fmtParam(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function fmtDur(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  return h ? `${h}h ${m}m` : m ? `${m}m ${s}s` : `${s}s`
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString(navigator.language, { day: 'numeric', month: 'short', year: 'numeric' })
}

function formatDate(dateStr: string): string {
  if (dateStr === 'Unknown') return 'Unknown date'
  try {
    return new Date(dateStr + 'T00:00:00').toLocaleDateString(undefined, {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    })
  } catch { return dateStr }
}
