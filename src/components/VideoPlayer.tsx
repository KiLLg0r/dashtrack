import { useEffect, useRef, useState } from 'react'
import {
  MdPlayArrow, MdPause, MdReplay10, MdForward10,
  MdVolumeUp, MdVolumeDown, MdVolumeMute,
  MdFullscreen, MdFullscreenExit,
} from 'react-icons/md'
import { useStore } from '../store'
import { fmtTime } from '../hooks/useGPX'

export default function VideoPlayer() {
  const {
    videoUrl, videoTime, playing, playbackRate, volume, muted,
    videoDuration, swapped,
    setVideoDuration, setVideoTime, setPlaying, setPlaybackRate,
    setVolume, setMuted, idxAtTime, setCurrentIdx,
  } = useStore()

  const vidRef       = useRef<HTMLVideoElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const seekDrag     = useRef(false)
  const volDrag      = useRef(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [volInput, setVolInput]         = useState(String(Math.round(volume * 100)))

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [])

  // Keep volInput in sync when volume changes externally (e.g. mute/unmute)
  useEffect(() => {
    setVolInput(String(Math.round((muted ? 0 : volume) * 100)))
  }, [volume, muted])

  const toggleFullscreen = () => {
    if (!containerRef.current) return
    if (!document.fullscreenElement) containerRef.current.requestFullscreen()
    else document.exitFullscreen()
  }

  useEffect(() => {
    const v = vidRef.current
    if (!v) return
    if (playing) v.play().catch(() => {})
    else v.pause()
  }, [playing])

  useEffect(() => {
    if (vidRef.current) vidRef.current.playbackRate = playbackRate
  }, [playbackRate])

  useEffect(() => {
    if (vidRef.current) { vidRef.current.volume = volume; vidRef.current.muted = muted }
  }, [volume, muted])

  const handleTimeUpdate = () => {
    const v = vidRef.current
    if (!v) return
    const t = v.currentTime
    setVideoTime(t)
    setCurrentIdx(idxAtTime(t))
  }

  const seek = (sec: number) => {
    const v = vidRef.current
    if (!v) return
    v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + sec))
  }

  const seekTo = (frac: number) => {
    const v = vidRef.current
    if (!v || !v.duration) return
    v.currentTime = frac * v.duration
  }

  const applyVolInput = (raw: string) => {
    const n = Math.max(0, Math.min(100, parseInt(raw, 10) || 0))
    setVolInput(String(n))
    setVolume(n / 100)
    setMuted(n === 0)
  }

  const pct    = videoDuration ? (videoTime / videoDuration) * 100 : 0
  const volPct = (muted ? 0 : volume) * 100
  const speedBtns: [number, string][] = [[0.5, '0.5×'], [1, '1×'], [2, '2×'], [4, '4×']]

  if (!videoUrl) return null

  const videoStyle: React.CSSProperties = (swapped || isFullscreen)
    ? { width: '100%', height: '100%', objectFit: 'contain', display: 'block', background: '#000' }
    : { width: '100%', display: 'block', aspectRatio: '16/9', background: '#000' }

  const VolumeIcon = muted || volume === 0 ? MdVolumeMute : volume < 0.5 ? MdVolumeDown : MdVolumeUp

  // ── Shared sub-elements ──────────────────────────────────────────────────

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
        type="number"
        min={0}
        max={100}
        value={volInput}
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

  const fullscreenBtn = (
    <IconBtn onClick={toggleFullscreen} title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
      {isFullscreen ? <MdFullscreenExit size={22} /> : <MdFullscreen size={22} />}
    </IconBtn>
  )

  // ── Seek bar (shared) ─────────────────────────────────────────────────────

  const seekBar = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div
        style={{ position: 'relative', height: 4, background: 'var(--s3)', borderRadius: 2, cursor: 'pointer', border: '1px solid var(--b2)' }}
        onMouseDown={e => {
          seekDrag.current = true
          const r = e.currentTarget.getBoundingClientRect()
          seekTo((e.clientX - r.left) / r.width)
        }}
        onMouseMove={e => {
          if (!seekDrag.current) return
          const r = e.currentTarget.getBoundingClientRect()
          seekTo((e.clientX - r.left) / r.width)
        }}
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
    <div ref={containerRef} style={{ display: 'flex', flexDirection: 'column', flexShrink: swapped ? 1 : 0, flex: swapped ? '1 1 0' : undefined, minHeight: 0, ...(isFullscreen ? { width: '100vw', height: '100vh', background: '#000' } : {}) }}>

      {/* Video */}
      <div style={{ position: 'relative', background: '#000', flex: (swapped || isFullscreen) ? '1 1 0' : undefined, minHeight: 0 }}>
        <video
          ref={vidRef}
          src={videoUrl}
          style={videoStyle}
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={() => { if (vidRef.current) setVideoDuration(vidRef.current.duration) }}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
        />
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
          /* ── Single row when video is in the main (left) slot ── */
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {transportBtns}
            <div style={{ width: 1, height: 20, background: 'var(--b3)', flexShrink: 0, margin: '0 2px' }} />
            {speedGroup}
            <div style={{ width: 1, height: 20, background: 'var(--b3)', flexShrink: 0, margin: '0 2px' }} />
            {volumeGroup}
            {fullscreenBtn}
          </div>
        ) : (
          /* ── Multi-row when video is in the sidebar ── */
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {transportBtns}
              <div style={{ width: 1, height: 20, background: 'var(--b3)', flexShrink: 0, margin: '0 2px' }} />
              {speedGroup}
              <div style={{ flex: 1 }} />
              {fullscreenBtn}
            </div>
            {volumeGroup}
          </>
        )}

      </div>
    </div>
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
