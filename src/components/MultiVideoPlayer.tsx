import { useCallback, useEffect, useRef, useState } from 'react'
import {
  MdPlayArrow, MdPause, MdReplay10, MdForward10,
  MdVolumeUp, MdVolumeDown, MdVolumeOff,
} from 'react-icons/md'
import { useStore } from '../store'
import { fmtTime } from '../hooks/useGPX'
import VideoChannel from './VideoChannel'

export default function MultiVideoPlayer() {
  const {
    channels, primaryChannelId, videoLayout, setVideoLayout,
    channelFilter, setChannelFilter,
    videoUrl, videoTime, playing, playbackRate, volume, muted, videoDuration, swapped,
    multiSession, activeClipIndex, setActiveClipIndex,
    setVideoDuration, setVideoTime, setPlaying, setPlaybackRate,
    setVolume, setMuted, idxAtTime, setCurrentIdx,
  } = useStore()

  const vidRefs      = useRef<Map<string, HTMLVideoElement>>(new Map())
  const refCallbacks = useRef(new Map<string, (el: HTMLVideoElement | null) => void>())
  const seekDrag     = useRef(false)
  const volDrag      = useRef(false)
  const isSeeking    = useRef(false)
  const [volInput, setVolInput] = useState(String(Math.round(volume * 100)))

  // All channels available from store (or single upload fallback)
  const allChannels = channels.length > 0
    ? channels
    : videoUrl
      ? [{ id: 'upload', clipId: null as null, videoUrl, videoDuration, label: '' }]
      : []

  // Apply channel filter
  const displayChannels = channelFilter === 'all'
    ? allChannels
    : allChannels.filter(ch => ch.id === channelFilter || ch.id === 'upload')

  const hasBothChannels = allChannels.length > 1
  const isSingleChannel = !hasBothChannels
  const isPip = videoLayout === 'pip' && displayChannels.length > 1
  const isSideBySide = videoLayout === 'side-by-side' && displayChannels.length > 1
  const fillHeight = swapped

  // Seek helper — suppresses timeupdate index updates until seek completes.
  // Listener is added BEFORE setting currentTime to avoid a race where seeked
  // fires synchronously (buffered seeks in some browsers) before the listener
  // is registered, which would leave isSeeking.current stuck at true forever.
  // State is also updated in the seeked callback so the seek bar and map marker
  // reflect the new position even when the video is paused (timeupdate is
  // unreliable after a paused seek).
  const programmaticSeek = (vid: HTMLVideoElement, time: number) => {
    isSeeking.current = true
    vid.addEventListener('seeked', () => {
      isSeeking.current = false
      setVideoTime(vid.currentTime)
      setCurrentIdx(idxAtTime(vid.currentTime))
    }, { once: true })
    vid.currentTime = time
  }

  const getPrimaryVid = (): HTMLVideoElement | undefined =>
    vidRefs.current.get(primaryChannelId)
    ?? vidRefs.current.values().next().value as HTMLVideoElement | undefined

  useEffect(() => {
    setVolInput(String(Math.round((muted ? 0 : volume) * 100)))
  }, [volume, muted])

  // Sync play/pause
  useEffect(() => {
    vidRefs.current.forEach(v => {
      if (playing) v.play().catch(() => {})
      else v.pause()
    })
  }, [playing])

  // Sync playback rate
  useEffect(() => {
    vidRefs.current.forEach(v => { v.playbackRate = playbackRate })
  }, [playbackRate])

  // Sync volume/mute
  useEffect(() => {
    vidRefs.current.forEach(v => { v.volume = volume; v.muted = muted })
  }, [volume, muted])

  // Single seek event handler — handles both single-clip and multi-segment
  useEffect(() => {
    const handler = (e: Event) => {
      const { idx } = (e as CustomEvent).detail
      const { points, multiSession } = useStore.getState()
      if (!points.length) return

      if (multiSession) {
        const { clips, clipPointOffsets } = multiSession
        let clipIdx = clips.length - 1
        for (let i = 0; i < clips.length; i++) {
          if (idx < (clipPointOffsets[i + 1] ?? Infinity)) { clipIdx = i; break }
        }
        const clip = clips[clipIdx]
        const localPoint = clip.gpxPoints[idx - clipPointOffsets[clipIdx]]
        if (!localPoint) return

        setActiveClipIndex(clipIdx)
        const vid = getPrimaryVid()
        if (vid) {
          if (!vid.src.endsWith(clip.videoUrl)) vid.src = clip.videoUrl
          programmaticSeek(vid, localPoint.videoSec)
          if (useStore.getState().playing) vid.play().catch(() => {})
        }
        return
      }

      // Single clip
      const p = points[idx]
      if (!p) return
      const vid = getPrimaryVid()
      if (!vid) return
      const preciseSync = points.some(pt => pt.videoSec > 0)
      const seekTime = preciseSync ? p.videoSec : (idx / (points.length - 1)) * (vid.duration || 0)
      programmaticSeek(vid, seekTime)
    }

    window.addEventListener('dashtrack:seek', handler)
    return () => window.removeEventListener('dashtrack:seek', handler)
  }, [primaryChannelId, setActiveClipIndex])

  const handleTimeUpdate = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const v = e.currentTarget
    if (v.dataset.channel !== 'primary') return
    if (isSeeking.current || v.seeking) return

    const t = v.currentTime
    setVideoTime(t)
    setCurrentIdx(idxAtTime(t))

    // Sync secondary channels
    const SYNC_THRESHOLD = 0.1
    vidRefs.current.forEach((sv, id) => {
      if (id === primaryChannelId) return
      if (Math.abs(sv.currentTime - t) > SYNC_THRESHOLD) sv.currentTime = t
    })

    // Multi-segment: clip boundary detection
    if (multiSession) {
      const clip = multiSession.clips[activeClipIndex]
      if (clip && t >= clip.trimEnd - 0.15) advanceClip()
    }
  }

  const advanceClip = () => {
    const { multiSession, activeClipIndex, playing } = useStore.getState()
    if (!multiSession) return
    const nextIdx = activeClipIndex + 1
    if (nextIdx >= multiSession.clips.length) { setPlaying(false); return }
    const nextClip = multiSession.clips[nextIdx]
    setActiveClipIndex(nextIdx)
    const vid = getPrimaryVid()
    if (vid) {
      vid.src = nextClip.videoUrl
      programmaticSeek(vid, nextClip.trimStart)
      if (playing) vid.play().catch(() => {})
    }
  }

  const seek = (sec: number) => {
    const vid = getPrimaryVid()
    if (!vid) return
    programmaticSeek(vid, Math.max(0, Math.min(vid.duration || 0, vid.currentTime + sec)))
  }

  const seekTo = (frac: number) => {
    const vid = getPrimaryVid()
    if (!vid || !vid.duration) return
    programmaticSeek(vid, frac * vid.duration)
  }

  const applyVolInput = (raw: string) => {
    const n = Math.max(0, Math.min(100, parseInt(raw, 10) || 0))
    setVolInput(String(n))
    setVolume(n / 100)
    setMuted(n === 0)
  }

  const setRef = useCallback((id: string) => {
    if (!refCallbacks.current.has(id)) {
      refCallbacks.current.set(id, (el: HTMLVideoElement | null) => {
        if (el) vidRefs.current.set(id, el)
        else vidRefs.current.delete(id)
      })
    }
    return refCallbacks.current.get(id)!
  }, [])

  if (!displayChannels.length && !allChannels.length) return null

  const pct    = videoDuration ? (videoTime / videoDuration) * 100 : 0
  const volPct = (muted ? 0 : volume) * 100
  const speedBtns: [number, string][] = [[0.5, '0.5×'], [1, '1×'], [2, '2×'], [4, '4×']]
  const VolumeIcon = muted || volume === 0 ? MdVolumeOff : volume < 0.5 ? MdVolumeDown : MdVolumeUp

  // ── Video area rendering ───────────────────────────────────────────────────

  const channelProps = (ch: typeof displayChannels[0], i: number) => ({
    ref: setRef(ch.id),
    videoUrl: ch.videoUrl!,
    channelId: ch.id,
    isPrimary: ch.id === primaryChannelId || i === 0,
    label: hasBothChannels ? ch.label : undefined,
    containerStyle: (fillHeight || isSideBySide) ? { flex: '1 1 0', minHeight: 0 } as React.CSSProperties : undefined,
    onTimeUpdate: handleTimeUpdate,
    onLoadedMetadata: (e: React.SyntheticEvent<HTMLVideoElement>) => {
      if (ch.id === primaryChannelId || i === 0)
        setVideoDuration((e.currentTarget as HTMLVideoElement).duration)
    },
    onPlay:  () => { if (ch.id === primaryChannelId || i === 0) setPlaying(true)  },
    onPause: () => { if (ch.id === primaryChannelId || i === 0) setPlaying(false) },
    onEnded: () => { if (ch.id === primaryChannelId || i === 0) setPlaying(false) },
  })

  let videoArea: React.ReactNode

  if (isPip) {
    // PiP: primary full-size, secondary absolute overlay bottom-right
    const primary   = displayChannels.find(c => c.id === primaryChannelId) ?? displayChannels[0]
    const secondary = displayChannels.find(c => c.id !== primary.id)!
    videoArea = (
      <div style={{
        position: 'relative', background: '#000',
        flex: fillHeight ? '1 1 0' : undefined, minHeight: 0,
        ...(fillHeight ? {} : { aspectRatio: '16/9' }),
      }}>
        <VideoChannel
          key={primary.id}
          {...channelProps(primary, 0)}
          fillHeight
          containerStyle={{ position: 'absolute', inset: 0, flex: 'none' }}
        />
        <div style={{
          position: 'absolute', bottom: 8, right: 8, width: '28%', zIndex: 10,
          border: '2px solid rgba(255,255,255,.25)', borderRadius: 5,
          overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,.7)',
        }}>
          <VideoChannel
            key={secondary.id}
            {...channelProps(secondary, 1)}
            fillHeight={false}
            containerStyle={{ flex: 'none', width: '100%' }}
          />
        </div>
        <TimeOverlay videoTime={videoTime} videoDuration={videoDuration} />
      </div>
    )
  } else {
    // Single or side-by-side
    videoArea = (
      <div style={{
        display: 'flex',
        flexDirection: isSideBySide ? 'row' : 'column',
        flex: fillHeight ? '1 1 0' : undefined,
        minHeight: 0,
        background: '#000',
        position: 'relative',
      }}>
        {displayChannels.map((ch, i) => (
          <VideoChannel
            key={ch.id}
            {...channelProps(ch, i)}
            fillHeight={fillHeight}
          />
        ))}
        <TimeOverlay videoTime={videoTime} videoDuration={videoDuration} />
      </div>
    )
  }

  // ── Controls ───────────────────────────────────────────────────────────────

  const transportBtns = (
    <>
      <IconBtn onClick={() => seek(-10)} title="Back 10s"><MdReplay10 size={22} /></IconBtn>
      <IconBtn onClick={() => setPlaying(!playing)} accent title={playing ? 'Pause' : 'Play'}>
        {playing ? <MdPause size={26} /> : <MdPlayArrow size={26} />}
      </IconBtn>
      <IconBtn onClick={() => seek(10)} title="Forward 10s"><MdForward10 size={22} /></IconBtn>
    </>
  )

  const speedGroup = speedBtns.map(([rate, label]) => (
    <IconBtn key={rate} onClick={() => setPlaybackRate(rate)} active={playbackRate === rate}>{label}</IconBtn>
  ))

  const volumeGroup = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: (swapped || isSingleChannel) ? '1 1 0' : undefined, minWidth: 0 }}>
      <input
        type="number" min={0} max={100} value={volInput}
        onChange={e => setVolInput(e.target.value)}
        onBlur={e => applyVolInput(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') applyVolInput((e.target as HTMLInputElement).value) }}
        style={{
          width: 46, background: 'var(--s3)', border: '1px solid var(--b2)', borderRadius: 'var(--r)',
          color: 'var(--txt2)', fontFamily: 'var(--mono)', fontSize: 11, padding: '4px 6px',
          textAlign: 'center', appearance: 'textfield', MozAppearance: 'textfield',
        } as React.CSSProperties}
      />
      <style>{`input[type=number]::-webkit-inner-spin-button,input[type=number]::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}`}</style>
      <div
        style={{ flex: 1, height: 4, background: 'var(--s3)', borderRadius: 2, cursor: 'pointer', border: '1px solid var(--b2)', position: 'relative', minWidth: swapped ? 60 : 40 }}
        onMouseDown={e => { volDrag.current = true; applyVolFrac(e) }}
        onMouseMove={e => { if (volDrag.current) applyVolFrac(e) }}
        onMouseUp={() => volDrag.current = false}
        onMouseLeave={() => volDrag.current = false}
      >
        <div style={{ height: '100%', background: 'var(--txt2)', borderRadius: 2, width: `${volPct}%`, pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', top: '50%', transform: 'translate(-50%,-50%)', width: 12, height: 12, background: 'var(--txt)', borderRadius: '50%', border: '2px solid var(--bg)', left: `${volPct}%`, pointerEvents: 'none' }} />
      </div>
      <IconBtn onClick={() => setMuted(!muted)} title="Mute (M)">
        <VolumeIcon size={20} />
      </IconBtn>
    </div>
  )

  function applyVolFrac(e: React.MouseEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect()
    const v = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))
    setVolume(v); setMuted(v === 0)
  }

  const seekBar = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div
        style={{ position: 'relative', height: 4, background: 'var(--s3)', borderRadius: 2, cursor: 'pointer', border: '1px solid var(--b2)' }}
        onMouseDown={e => { seekDrag.current = true; const r = e.currentTarget.getBoundingClientRect(); seekTo((e.clientX - r.left) / r.width) }}
        onMouseMove={e => { if (!seekDrag.current) return; const r = e.currentTarget.getBoundingClientRect(); seekTo((e.clientX - r.left) / r.width) }}
        onMouseUp={() => seekDrag.current = false}
        onMouseLeave={() => seekDrag.current = false}
      >
        <div style={{ height: '100%', background: 'linear-gradient(90deg,var(--acc2),var(--acc))', borderRadius: 2, width: `${pct}%`, pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', top: '50%', transform: 'translate(-50%,-50%)', width: 12, height: 12, background: 'var(--acc)', borderRadius: '50%', border: '2px solid var(--bg)', left: `${pct}%`, pointerEvents: 'none' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--txt3)' }}>
        <span style={{ color: 'var(--acc)' }}>{fmtTime(videoTime)}</span>
        <span>{fmtTime(videoDuration)}</span>
      </div>
    </div>
  )

  // Channel filter buttons — only shown when both F and R are available
  const channelFilterBtns = hasBothChannels && (
    <div style={{ display: 'flex', gap: 2, flex: 1 }}>
      {(['all', 'front', 'rear'] as const).map(f => (
        <IconBtn
          key={f}
          onClick={() => setChannelFilter(f)}
          active={channelFilter === f}
          title={f === 'all' ? 'Both channels' : f === 'front' ? 'Front only' : 'Rear only'}
          fill
        >
          {f === 'all' ? 'F+R' : f === 'front' ? 'F' : 'R'}
        </IconBtn>
      ))}
    </div>
  )

  // Layout toggle — only when showing multiple channels
  const layoutBtn = displayChannels.length > 1 && (
    <LayoutBtn layout={videoLayout} onChange={setVideoLayout} />
  )

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      flexShrink: swapped ? 1 : 0,
      flex: swapped ? '1 1 0' : undefined,
      minHeight: 0,
    }}>
      {videoArea}

      <div style={{ flexShrink: 0, background: 'var(--s2)', borderBottom: '1px solid var(--b2)', padding: swapped ? '8px 14px' : '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {seekBar}

        {swapped ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {transportBtns}
            <Sep />
            {speedGroup}
            <Sep />
            {volumeGroup}
            {channelFilterBtns && <><Sep />{channelFilterBtns}</>}
            {layoutBtn && <><Sep />{layoutBtn}</>}
          </div>
        ) : isSingleChannel ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-evenly' }}>
              {transportBtns}
              {speedGroup}
            </div>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              {volumeGroup}
            </div>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {transportBtns}
              <Sep />
              {speedGroup}
              <div style={{ flex: 1 }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {volumeGroup}
              {channelFilterBtns && <><Sep />{channelFilterBtns}</>}
              {layoutBtn && <><Sep />{layoutBtn}</>}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function TimeOverlay({ videoTime, videoDuration }: { videoTime: number; videoDuration: number }) {
  return (
    <div style={{
      position: 'absolute', top: 7, right: 8, pointerEvents: 'none',
      fontFamily: 'var(--mono)', fontSize: 10,
      color: 'rgba(255,255,255,.55)', background: 'rgba(0,0,0,.5)',
      padding: '2px 7px', borderRadius: 4,
    }}>
      {fmtTime(videoTime)} / {fmtTime(videoDuration)}
    </div>
  )
}

function Sep() {
  return <div style={{ width: 1, height: 20, background: 'var(--b3)', flexShrink: 0, margin: '0 2px' }} />
}

function LayoutBtn({ layout, onChange }: { layout: string; onChange: (l: any) => void }) {
  const next:   Record<string, string> = { 'single': 'side-by-side', 'side-by-side': 'pip', 'pip': 'single' }
  const labels: Record<string, string> = { 'single': '▣', 'side-by-side': '⬛⬛', 'pip': '⬛◻' }
  const titles: Record<string, string> = { 'single': 'Switch to side-by-side', 'side-by-side': 'Switch to PiP', 'pip': 'Switch to single' }
  return (
    <IconBtn onClick={() => onChange(next[layout])} title={titles[layout]}>
      {labels[layout]}
    </IconBtn>
  )
}

function IconBtn({ children, onClick, accent, active, title, fill }: {
  children: React.ReactNode
  onClick?: () => void
  accent?: boolean
  active?: boolean
  title?: string
  fill?: boolean
}) {
  const highlighted = accent || active
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        background: highlighted ? 'var(--acc-dim)' : 'transparent',
        border: `1px solid ${highlighted ? 'rgba(245,197,66,.4)' : 'transparent'}`,
        borderRadius: 'var(--r)',
        color: highlighted ? 'var(--acc)' : 'var(--txt2)',
        cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '5px 8px',
        fontFamily: 'var(--mono)', fontSize: 12,
        transition: 'all .15s', flexShrink: 0,
        ...(fill ? { flex: '1 1 0' } : {}),
      }}
    >
      {children}
    </button>
  )
}
