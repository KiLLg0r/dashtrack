import { useEffect, useRef, useState } from 'react'
import {
  MdPlayArrow, MdPause, MdReplay10, MdForward10,
  MdVolumeUp, MdVolumeDown, MdVolumeMute,
  MdFullscreen, MdFullscreenExit,
} from 'react-icons/md'
import { useStore } from '../store'
import { fmtTime } from '../hooks/useGPX'
import VideoChannel from './VideoChannel'

export default function MultiVideoPlayer() {
  const {
    channels, primaryChannelId, videoLayout, setVideoLayout,
    videoUrl, videoTime, playing, playbackRate, volume, muted, videoDuration, swapped,
    multiSession, activeClipIndex, setActiveClipIndex,
    setVideoDuration, setVideoTime, setPlaying, setPlaybackRate,
    setVolume, setMuted, idxAtTime, setCurrentIdx,
  } = useStore()

  // Refs: one per channel, keyed by channel id
  const vidRefs = useRef<Map<string, HTMLVideoElement>>(new Map())
  const containerRef = useRef<HTMLDivElement>(null)
  const seekDrag = useRef(false)
  const volDrag = useRef(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [volInput, setVolInput] = useState(String(Math.round(volume * 100)))
  const preloadRef = useRef<HTMLVideoElement | null>(null)

  // Determine what to render — channels[] when library loaded, fallback to videoUrl for upload
  const displayChannels = channels.length > 0
    ? channels
    : videoUrl
      ? [{ id: 'upload', clipId: null, videoUrl, videoDuration, label: '' }]
      : []

  const primaryChannel = displayChannels.find(c => c.id === primaryChannelId) ?? displayChannels[0]
  const hasMultiChannel = displayChannels.length > 1

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [])

  useEffect(() => {
    setVolInput(String(Math.round((muted ? 0 : volume) * 100)))
  }, [volume, muted])

  // Sync play/pause to all video elements
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

  // Listen for seek events (from map/timeline clicks)
  useEffect(() => {
    const handler = (e: Event) => {
      const { idx } = (e as CustomEvent).detail
      const { points, multiSession } = useStore.getState()
      if (!points.length) return

      if (multiSession) {
        // Multi-segment: find which clip owns this idx and seek into it
        const { clips, clipPointOffsets } = multiSession
        let clipIdx = clips.length - 1
        for (let i = 0; i < clips.length; i++) {
          const nextOffset = clipPointOffsets[i + 1] ?? Infinity
          if (idx < nextOffset) { clipIdx = i; break }
        }
        const clip = clips[clipIdx]
        const localIdx = idx - clipPointOffsets[clipIdx]
        const localPoint = clip.gpxPoints[localIdx]
        if (!localPoint) return

        setActiveClipIndex(clipIdx)
        // Switch video src if needed
        const vid = vidRefs.current.get(primaryChannelId) ?? vidRefs.current.values().next().value as HTMLVideoElement | undefined
        if (vid) {
          if (vid.src !== clip.videoUrl && !vid.src.endsWith(clip.videoUrl)) {
            vid.src = clip.videoUrl
          }
          vid.currentTime = localPoint.videoSec
          if (playing) vid.play().catch(() => {})
        }
        return
      }

      // Single clip
      const p = points[idx]
      if (!p) return
      const vid = vidRefs.current.get(primaryChannelId) ?? vidRefs.current.values().next().value as HTMLVideoElement | undefined
      if (!vid) return
      const preciseSync = points.some(pt => pt.videoSec > 0)
      if (preciseSync) vid.currentTime = p.videoSec
      else vid.currentTime = (idx / (points.length - 1)) * (vid.duration || 0)
    }

    window.addEventListener('dashtrack:seek', handler)
    return () => window.removeEventListener('dashtrack:seek', handler)
  }, [primaryChannelId, playing, setActiveClipIndex])

  const handleTimeUpdate = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const v = e.currentTarget
    if (!v.dataset.channel || v.dataset.channel !== 'primary') return

    const t = v.currentTime
    setVideoTime(t)
    setCurrentIdx(idxAtTime(t))

    // Sync secondary channels to primary (correct if drift > 0.1s)
    const SYNC_THRESHOLD = 0.1
    vidRefs.current.forEach((sv, id) => {
      if (id === primaryChannelId) return
      if (Math.abs(sv.currentTime - t) > SYNC_THRESHOLD) {
        sv.currentTime = t
      }
    })

    // Multi-segment: detect clip boundary
    if (multiSession) {
      const clip = multiSession.clips[activeClipIndex]
      if (clip && t >= clip.trimEnd - 0.15) {
        advanceClip()
      }
    }
  }

  const advanceClip = () => {
    const { multiSession, activeClipIndex, playing } = useStore.getState()
    if (!multiSession) return
    const nextIdx = activeClipIndex + 1
    if (nextIdx >= multiSession.clips.length) {
      setPlaying(false)
      return
    }
    const nextClip = multiSession.clips[nextIdx]
    setActiveClipIndex(nextIdx)
    const vid = vidRefs.current.get(primaryChannelId) ?? vidRefs.current.values().next().value as HTMLVideoElement | undefined
    if (vid) {
      vid.src = nextClip.videoUrl
      vid.currentTime = nextClip.trimStart
      if (playing) vid.play().catch(() => {})
    }
  }

  const seek = (sec: number) => {
    const vid = vidRefs.current.get(primaryChannelId) ?? vidRefs.current.values().next().value as HTMLVideoElement | undefined
    if (!vid) return
    vid.currentTime = Math.max(0, Math.min(vid.duration || 0, vid.currentTime + sec))
  }

  const seekTo = (frac: number) => {
    const vid = vidRefs.current.get(primaryChannelId) ?? vidRefs.current.values().next().value as HTMLVideoElement | undefined
    if (!vid || !vid.duration) return
    vid.currentTime = frac * vid.duration
  }

  const applyVolInput = (raw: string) => {
    const n = Math.max(0, Math.min(100, parseInt(raw, 10) || 0))
    setVolInput(String(n))
    setVolume(n / 100)
    setMuted(n === 0)
  }

  const toggleFullscreen = () => {
    if (!containerRef.current) return
    if (!document.fullscreenElement) containerRef.current.requestFullscreen()
    else document.exitFullscreen()
  }

  const setRef = (id: string) => (el: HTMLVideoElement | null) => {
    if (el) vidRefs.current.set(id, el)
    else vidRefs.current.delete(id)
  }

  if (!displayChannels.length) return null

  const pct = videoDuration ? (videoTime / videoDuration) * 100 : 0
  const volPct = (muted ? 0 : volume) * 100
  const speedBtns: [number, string][] = [[0.5, '0.5×'], [1, '1×'], [2, '2×'], [4, '4×']]
  const VolumeIcon = muted || volume === 0 ? MdVolumeMute : volume < 0.5 ? MdVolumeDown : MdVolumeUp

  // Layout for video area
  const videoAreaStyle: React.CSSProperties = (swapped || isFullscreen)
    ? { display: 'flex', flexDirection: videoLayout === 'side-by-side' ? 'row' : 'column', flex: '1 1 0', minHeight: 0, background: '#000' }
    : { display: 'flex', flexDirection: videoLayout === 'side-by-side' ? 'row' : 'column', background: '#000' }

  const fillHeight = swapped || isFullscreen

  // ── Transport controls ─────────────────────────────────────
  const transportBtns = (
    <>
      <IconBtn onClick={() => seek(-10)} title="Back 10s"><MdReplay10 size={22} /></IconBtn>
      <IconBtn onClick={() => setPlaying(!playing)} accent title={playing ? 'Pause' : 'Play'}>
        {playing ? <MdPause size={26} /> : <MdPlayArrow size={26} />}
      </IconBtn>
      <IconBtn onClick={() => seek(10)} title="Forward 10s"><MdForward10 size={22} /></IconBtn>
    </>
  )

  const speedGroup = (
    <>
      {speedBtns.map(([rate, label]) => (
        <IconBtn key={rate} onClick={() => setPlaybackRate(rate)} active={playbackRate === rate}>{label}</IconBtn>
      ))}
    </>
  )

  const volumeGroup = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: swapped ? '1 1 0' : undefined, minWidth: 0 }}>
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
        onMouseDown={e => {
          volDrag.current = true
          const r = e.currentTarget.getBoundingClientRect()
          const v = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))
          setVolume(v); setMuted(v === 0)
        }}
        onMouseMove={e => {
          if (!volDrag.current) return
          const r = e.currentTarget.getBoundingClientRect()
          const v = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))
          setVolume(v); setMuted(v === 0)
        }}
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

  return (
    <div
      ref={containerRef}
      style={{
        display: 'flex', flexDirection: 'column',
        flexShrink: swapped ? 1 : 0,
        flex: swapped ? '1 1 0' : undefined,
        minHeight: 0,
        ...(isFullscreen ? { width: '100vw', height: '100vh', background: '#000' } : {}),
      }}
    >
      {/* Video area */}
      <div style={{ ...videoAreaStyle, position: 'relative', flex: (swapped || isFullscreen) ? '1 1 0' : undefined, minHeight: 0 }}>
        {displayChannels.map((ch, i) => (
          <VideoChannel
            key={ch.id}
            ref={setRef(ch.id)}
            videoUrl={ch.videoUrl!}
            channelId={ch.id}
            isPrimary={ch.id === primaryChannelId || i === 0}
            label={hasMultiChannel ? ch.label : undefined}
            fillHeight={fillHeight}
            onTimeUpdate={handleTimeUpdate}
            onLoadedMetadata={e => {
              if (ch.id === primaryChannelId || i === 0) {
                setVideoDuration((e.currentTarget as HTMLVideoElement).duration)
              }
            }}
            onPlay={() => { if (ch.id === primaryChannelId || i === 0) setPlaying(true) }}
            onPause={() => { if (ch.id === primaryChannelId || i === 0) setPlaying(false) }}
            onEnded={() => { if (ch.id === primaryChannelId || i === 0) setPlaying(false) }}
          />
        ))}

        {/* Timestamp overlay */}
        <div style={{
          position: 'absolute', top: 7, right: 8,
          fontFamily: 'var(--mono)', fontSize: 10,
          color: 'rgba(255,255,255,.55)', background: 'rgba(0,0,0,.5)',
          padding: '2px 7px', borderRadius: 4, pointerEvents: 'none',
        }}>
          {fmtTime(videoTime)} / {fmtTime(videoDuration)}
        </div>
      </div>

      {/* Controls */}
      <div style={{ flexShrink: 0, background: 'var(--s2)', borderBottom: '1px solid var(--b2)', padding: swapped ? '8px 14px' : '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {seekBar}

        {swapped ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {transportBtns}
            <div style={{ width: 1, height: 20, background: 'var(--b3)', flexShrink: 0, margin: '0 2px' }} />
            {speedGroup}
            <div style={{ width: 1, height: 20, background: 'var(--b3)', flexShrink: 0, margin: '0 2px' }} />
            {volumeGroup}
            {hasMultiChannel && (
              <>
                <div style={{ width: 1, height: 20, background: 'var(--b3)', flexShrink: 0, margin: '0 2px' }} />
                <LayoutBtn layout={videoLayout} onChange={setVideoLayout} />
              </>
            )}
            <IconBtn onClick={toggleFullscreen} title="Fullscreen">
              {isFullscreen ? <MdFullscreenExit size={22} /> : <MdFullscreen size={22} />}
            </IconBtn>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {transportBtns}
              <div style={{ width: 1, height: 20, background: 'var(--b3)', flexShrink: 0, margin: '0 2px' }} />
              {speedGroup}
              {hasMultiChannel && (
                <>
                  <div style={{ width: 1, height: 20, background: 'var(--b3)', flexShrink: 0, margin: '0 2px' }} />
                  <LayoutBtn layout={videoLayout} onChange={setVideoLayout} />
                </>
              )}
              <div style={{ flex: 1 }} />
              <IconBtn onClick={toggleFullscreen} title="Fullscreen">
                {isFullscreen ? <MdFullscreenExit size={22} /> : <MdFullscreen size={22} />}
              </IconBtn>
            </div>
            {volumeGroup}
          </>
        )}
      </div>
    </div>
  )
}

function LayoutBtn({ layout, onChange }: { layout: string, onChange: (l: any) => void }) {
  const next: Record<string, string> = { 'single': 'side-by-side', 'side-by-side': 'pip', 'pip': 'single' }
  const labels: Record<string, string> = { 'single': '▣', 'side-by-side': '⬛⬛', 'pip': '⬛◻' }
  return (
    <IconBtn onClick={() => onChange(next[layout])} title={`Layout: ${layout}`}>
      {labels[layout]}
    </IconBtn>
  )
}

function IconBtn({ children, onClick, accent, active, title }: {
  children: React.ReactNode
  onClick?: () => void
  accent?: boolean
  active?: boolean
  title?: string
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
        fontFamily: 'var(--mono)',
        fontSize: 12,
        transition: 'all .15s',
        flexShrink: 0,
      }}
    >
      {children}
    </button>
  )
}
