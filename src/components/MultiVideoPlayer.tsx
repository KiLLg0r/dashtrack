import { useCallback, useEffect, useRef, useState } from 'react'
import {
  MdPlayArrow, MdPause, MdReplay10, MdForward10,
  MdVolumeUp, MdVolumeDown, MdVolumeOff,
  MdFullscreen, MdFullscreenExit, MdSwapHoriz,
  MdOutlinePictureInPictureAlt, MdOutlineViewStream,
} from 'react-icons/md'
import { useStore } from '../store'
import { fmtTime } from '../hooks/useGPX'
import VideoChannel from './VideoChannel'

export default function MultiVideoPlayer() {
  const {
    channels, primaryChannelId, setPrimaryChannelId, videoLayout, setVideoLayout,
    channelFilter, setChannelFilter,
    videoUrl, videoTime, playing, playbackRate, volume, muted, videoDuration, swapped,
    setActiveClipIndex,
    setVideoDuration, setVideoTime, setPlaying, setPlaybackRate,
    setVolume, setMuted, idxAtTime, setCurrentIdx,
  } = useStore()

  const playerRef    = useRef<HTMLDivElement>(null)
  const vidRefs      = useRef<Map<string, HTMLVideoElement>>(new Map())
  const refCallbacks = useRef(new Map<string, (el: HTMLVideoElement | null) => void>())
  const seekDrag     = useRef(false)
  const volDrag      = useRef(false)
  const isSeeking    = useRef(false)
  const intendedSrcs = useRef<Map<HTMLVideoElement, string>>(new Map())
  const [volInput, setVolInput] = useState(String(Math.round(volume * 100)))
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [videoAspectRatio, setVideoAspectRatio] = useState('16/9')

  // ── Channel/source helpers ─────────────────────────────────────────────────

  const allChannels = channels.length > 0
    ? channels
    : videoUrl
      ? [{ id: 'upload', clipId: null as null, videoUrl, videoDuration, label: '' }]
      : []

  const displayChannels = channelFilter === 'all'
    ? allChannels
    : allChannels.filter(ch => ch.id === channelFilter || ch.id === 'upload')
  const hasBothChannels = allChannels.length > 1
  const isSingleChannel = !hasBothChannels
  const isPip           = videoLayout === 'pip' && displayChannels.length > 1
  const isSideBySide    = videoLayout === 'side-by-side' && displayChannels.length > 1
  const fillHeight      = swapped || isFullscreen

  const switchSrc = (vid: HTMLVideoElement, url: string, seekTime?: number) => {
    if (intendedSrcs.current.get(vid) !== url) {
      intendedSrcs.current.set(vid, url)
      const t = seekTime ?? vid.currentTime
      const wasPlaying = !vid.paused
      vid.src = url
      vid.addEventListener('loadedmetadata', () => {
        if (intendedSrcs.current.get(vid) !== url) return // another switch happened
        vid.currentTime = t
        if (wasPlaying) vid.play().catch(() => {})
      }, { once: true })
    } else if (seekTime !== undefined) {
      programmaticSeek(vid, seekTime)
    }
  }

  const programmaticSeek = (vid: HTMLVideoElement, time: number) => {
    isSeeking.current = true
    vid.addEventListener('seeked', () => {
      isSeeking.current = false
      const t = vid.currentTime
      setVideoTime(t)
      const { multiSession: ms, activeClipIndex: aci } = useStore.getState()
      const globalT = ms && aci < ms.clips.length
        ? ms.clips[aci].videoOffset + (t - ms.clips[aci].trimStart)
        : t
      setCurrentIdx(idxAtTime(globalT))
      // Sync secondary channels (e.g. rear) that don't get timeupdate while paused
      vidRefs.current.forEach((sv) => {
        if (sv !== vid) sv.currentTime = t
      })
    }, { once: true })
    vid.currentTime = time
  }

  const getPrimaryVid = (): HTMLVideoElement | undefined =>
    vidRefs.current.get(primaryChannelId)
    ?? vidRefs.current.values().next().value as HTMLVideoElement | undefined

  // ── Effects ────────────────────────────────────────────────────────────────

  useEffect(() => {
    setVolInput(String(Math.round((muted ? 0 : volume) * 100)))
  }, [volume, muted])

  // Fullscreen listener
  useEffect(() => {
    const handler = () => setIsFullscreen(document.fullscreenElement === playerRef.current)
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [])

  // Sync play/pause to all channels
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

  // Audio: only the primary channel plays audio; all others are always muted
  useEffect(() => {
    vidRefs.current.forEach((v, id) => {
      const isPrimary = id === primaryChannelId || vidRefs.current.size === 1
      v.volume = isPrimary ? volume : 0
      v.muted  = isPrimary ? muted  : true
    })
  }, [volume, muted, primaryChannelId])

  // Seek event — handles single-clip and multi-segment
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
          switchSrc(vid, clip.videoUrl, localPoint.videoSec)
          if (useStore.getState().playing) vid.play().catch(() => {})
        }
        if (clip.peerVideoUrl) {
          const peerChannelId = clip.channel === 'front' ? 'rear' : 'front'
          const peerVid = vidRefs.current.get(peerChannelId)
          if (peerVid) switchSrc(peerVid, clip.peerVideoUrl, localPoint.videoSec)
        }
        return
      }

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

  // ── Playback handlers ──────────────────────────────────────────────────────

  const handleTimeUpdate = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const v = e.currentTarget
    if (v.dataset.channel !== 'primary') return
    if (isSeeking.current || v.seeking) return

    const t = v.currentTime
    setVideoTime(t)

    // Convert local clip time to global playback time for multi-segment sessions
    const { multiSession: ms, activeClipIndex: aci } = useStore.getState()
    const globalT = ms && aci < ms.clips.length
      ? ms.clips[aci].videoOffset + (t - ms.clips[aci].trimStart)
      : t
    setCurrentIdx(idxAtTime(globalT))

    const SYNC_THRESHOLD = 0.1
    vidRefs.current.forEach((sv, id) => {
      if (id === primaryChannelId) return
      if (Math.abs(sv.currentTime - t) > SYNC_THRESHOLD) sv.currentTime = t
    })

    if (ms) {
      const clip = ms.clips[aci]
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
      switchSrc(vid, nextClip.videoUrl, nextClip.trimStart)
      if (playing) vid.play().catch(() => {})
    }
    if (nextClip.peerVideoUrl) {
      const peerChannelId = nextClip.channel === 'front' ? 'rear' : 'front'
      const peerVid = vidRefs.current.get(peerChannelId)
      if (peerVid) {
        switchSrc(peerVid, nextClip.peerVideoUrl, nextClip.trimStart)
        if (playing) peerVid.play().catch(() => {})
      }
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

  const toggleFullscreen = () => {
    if (!playerRef.current) return
    if (!document.fullscreenElement) playerRef.current.requestFullscreen()
    else document.exitFullscreen()
  }

  const setRef = useCallback((id: string) => {
    if (!refCallbacks.current.has(id)) {
      refCallbacks.current.set(id, (el: HTMLVideoElement | null) => {
        if (el) {
          vidRefs.current.set(id, el)
          // Sync newly mounted secondary channel to primary's current time
          const { primaryChannelId: pid } = useStore.getState()
          if (id !== pid) {
            const primaryVid = vidRefs.current.get(pid) ?? [...vidRefs.current.values()][0]
            if (primaryVid && primaryVid !== el) el.currentTime = primaryVid.currentTime
          }
        } else {
          vidRefs.current.delete(id)
        }
      })
    }
    return refCallbacks.current.get(id)!
  }, [])

  if (!displayChannels.length && !allChannels.length) return null

  const pct     = videoDuration ? (videoTime / videoDuration) * 100 : 0
  const volPct  = (muted ? 0 : volume) * 100
  const speedBtns: [number, string][] = [[0.5, '0.5×'], [1, '1×'], [2, '2×'], [4, '4×']]
  const VolumeIcon = muted || volume === 0 ? MdVolumeOff : volume < 0.5 ? MdVolumeDown : MdVolumeUp

  // ── Video area ─────────────────────────────────────────────────────────────

  // channelProps uses allChannels index so isPrimary is stable regardless of filter
  const channelProps = (ch: typeof allChannels[0], i: number) => ({
    ref: setRef(ch.id),
    videoUrl: ch.videoUrl!,
    channelId: ch.id,
    isPrimary: ch.id === primaryChannelId || i === 0,
    label: hasBothChannels ? ch.label : undefined,
    aspectRatio: videoAspectRatio,
    onTimeUpdate: handleTimeUpdate,
    onLoadedMetadata: (e: React.SyntheticEvent<HTMLVideoElement>) => {
      if (ch.id === primaryChannelId || i === 0) {
        const vid = e.currentTarget as HTMLVideoElement
        setVideoDuration(vid.duration)
        if (vid.videoWidth && vid.videoHeight)
          setVideoAspectRatio(`${vid.videoWidth}/${vid.videoHeight}`)
      }
    },
    onPlay:  () => { if (ch.id === primaryChannelId || i === 0) setPlaying(true)  },
    onPause: () => { if (ch.id === primaryChannelId || i === 0) setPlaying(false) },
    onEnded: () => { if (ch.id === primaryChannelId || i === 0) setPlaying(false) },
  })

  // Compute per-channel containerStyle for any layout — keeps VideoChannels in a
  // stable DOM position so they never unmount when the layout or filter changes.
  const channelContainerStyle = (ch: typeof allChannels[0], i: number): React.CSSProperties => {
    const visible = channelFilter === 'all' || ch.id === channelFilter || ch.id === 'upload'
    if (!visible) return { display: 'none' }
    // isPip is only true with 2+ channels so primaryChannelId always matches one — no i===0 fallback needed
    const isPrimaryChannel = isPip ? ch.id === primaryChannelId : (ch.id === primaryChannelId || i === 0)
    if (isPip) {
      return isPrimaryChannel
        ? { position: 'absolute', inset: 0, flex: 'none' }
        : {
            position: 'absolute', bottom: 8, right: 8, width: '28%', zIndex: 10,
            border: '2px solid rgba(255,255,255,.25)', borderRadius: 5,
            overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,.7)', flex: 'none',
          }
    }
    return (fillHeight || isSideBySide) ? { flex: '1 1 0', minHeight: 0 } : {}
  }

  const videoArea = (
    <div style={{
      display: 'flex',
      flexDirection: isSideBySide ? 'row' : 'column',
      flex: fillHeight ? '1 1 0' : undefined,
      minHeight: fillHeight ? 0 : undefined,
      background: '#000',
      position: 'relative',
      ...(!fillHeight && isPip ? { aspectRatio: videoAspectRatio } : {}),
    }}>
      {allChannels.map((ch, i) => (
        <VideoChannel
          key={ch.id} {...channelProps(ch, i)}
          fillHeight={isPip ? (ch.id === primaryChannelId || i === 0) : fillHeight}
          containerStyle={channelContainerStyle(ch, i)}
        />
      ))}
      <TimeOverlay videoTime={videoTime} videoDuration={videoDuration} />
    </div>
  )

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

  function applyVolFrac(e: React.MouseEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect()
    const v = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))
    setVolume(v); setMuted(v === 0)
  }

  const volumeGroup = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: (swapped || isSingleChannel || isFullscreen) ? '1 1 0' : undefined, minWidth: 0 }}>
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

  // Channel filter — hidden in fullscreen
  const filterOptions: (typeof channelFilter)[] = ['all', 'front', 'rear']
  const channelFilterBtns = !isFullscreen && hasBothChannels && (
    <div style={{ display: 'flex', gap: 2, flex: 1 }}>
      {filterOptions.map(f => (
        <IconBtn
          key={f}
          onClick={() => setChannelFilter(f)}
          active={channelFilter === f || (f === 'front' && !filterOptions.includes('all') && channelFilter === 'all')}
          title={f === 'all' ? 'Both channels' : f === 'front' ? 'Front only' : 'Rear only'}
          fill
        >
          {f === 'all' ? 'F+R' : f === 'front' ? 'F' : 'R'}
        </IconBtn>
      ))}
    </div>
  )

  const layoutBtn = !isFullscreen && displayChannels.length > 1 && (
    <LayoutBtn layout={videoLayout} onChange={setVideoLayout} />
  )

  const pipSwapBtn = !isFullscreen && isPip && (
    <IconBtn
      onClick={() => {
        const other = allChannels.find(c => c.id !== primaryChannelId)
        if (other) setPrimaryChannelId(other.id)
      }}
      title="Swap PiP cameras"
    >
      <MdSwapHoriz size={18} />
    </IconBtn>
  )

  const fullscreenBtn = (
    <IconBtn onClick={toggleFullscreen} title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
      {isFullscreen ? <MdFullscreenExit size={20} /> : <MdFullscreen size={20} />}
    </IconBtn>
  )

  // Controls layout — unified in fullscreen; split by mode otherwise
  const controls = isFullscreen ? (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      {transportBtns}
      <Sep />
      {speedGroup}
      <Sep />
      {volumeGroup}
      <Sep />
      {fullscreenBtn}
    </div>
  ) : swapped ? (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      {transportBtns}
      <Sep />
      {speedGroup}
      <Sep />
      {volumeGroup}
      {channelFilterBtns && <><Sep />{channelFilterBtns}</>}
      {layoutBtn && <><Sep />{layoutBtn}</>}
      {pipSwapBtn && <><Sep />{pipSwapBtn}</>}
      <Sep />
      {fullscreenBtn}
    </div>
  ) : isSingleChannel ? (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-evenly' }}>
        {transportBtns}
        {speedGroup}
        {fullscreenBtn}
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
        {fullscreenBtn}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {volumeGroup}
        {channelFilterBtns && <><Sep />{channelFilterBtns}</>}
        {layoutBtn && <><Sep />{layoutBtn}</>}
        {pipSwapBtn && <><Sep />{pipSwapBtn}</>}
      </div>
    </>
  )

  return (
    <div
      ref={playerRef}
      style={{
        display: 'flex', flexDirection: 'column',
        ...(isFullscreen
          ? { height: '100%', background: '#000' }
          : { flexShrink: swapped ? 1 : 0, flex: swapped ? '1 1 0' : undefined, minHeight: 0 }
        ),
      }}
    >
      {videoArea}

      <div style={{
        flexShrink: 0,
        background: isFullscreen ? 'rgba(0,0,0,.85)' : 'var(--s2)',
        borderBottom: isFullscreen ? 'none' : '1px solid var(--b2)',
        padding: swapped || isFullscreen ? '8px 14px' : '10px 12px',
        display: 'flex', flexDirection: 'column', gap: 8,
      }}>
        {seekBar}
        {controls}
      </div>
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────────

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
  const next:   Record<string, string>          = { 'single': 'side-by-side', 'side-by-side': 'pip', 'pip': 'single' }
  const titles: Record<string, string>          = { 'single': 'Switch to side-by-side', 'side-by-side': 'Switch to PiP', 'pip': 'Switch to single' }
  const icons:  Record<string, React.ReactNode> = {
    'single':       <MdOutlineViewStream size={18} />,
    'side-by-side': <MdOutlineViewStream size={18} style={{ transform: 'rotate(90deg)' }} />,
    'pip':          <MdOutlinePictureInPictureAlt size={18} />,
  }
  return (
    <IconBtn onClick={() => onChange(next[layout])} title={titles[layout]}>
      {icons[layout]}
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
