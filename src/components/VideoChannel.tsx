import { forwardRef, useEffect, useRef, useState } from 'react'
import { MdFullscreen, MdFullscreenExit } from 'react-icons/md'

interface Props {
  videoUrl: string
  channelId: string
  isPrimary: boolean
  label?: string
  fillHeight?: boolean
  containerStyle?: React.CSSProperties
  onTimeUpdate?: React.ReactEventHandler<HTMLVideoElement>
  onLoadedMetadata?: React.ReactEventHandler<HTMLVideoElement>
  onPlay?: React.ReactEventHandler<HTMLVideoElement>
  onPause?: React.ReactEventHandler<HTMLVideoElement>
  onEnded?: React.ReactEventHandler<HTMLVideoElement>
}

const VideoChannel = forwardRef<HTMLVideoElement, Props>(({
  videoUrl, channelId, isPrimary, label,
  fillHeight = false,
  containerStyle,
  onTimeUpdate, onLoadedMetadata, onPlay, onPause, onEnded,
}, ref) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [showBtn, setShowBtn] = useState(false)

  useEffect(() => {
    const handler = () => setIsFullscreen(document.fullscreenElement === containerRef.current)
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [])

  const toggleFullscreen = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!containerRef.current) return
    if (!document.fullscreenElement) containerRef.current.requestFullscreen()
    else document.exitFullscreen()
  }

  const videoStyle: React.CSSProperties = (fillHeight || isFullscreen)
    ? { width: '100%', height: '100%', objectFit: 'contain', display: 'block', background: '#000' }
    : { width: '100%', display: 'block', aspectRatio: '16/9', background: '#000' }

  return (
    <div
      ref={containerRef}
      onMouseEnter={() => setShowBtn(true)}
      onMouseLeave={() => setShowBtn(false)}
      style={{
        position: 'relative',
        flex: '0 0 auto',
        minWidth: 0,
        background: '#000',
        ...(isFullscreen ? { width: '100vw', height: '100vh' } : {}),
        ...containerStyle,
      }}
    >
      <video
        ref={ref}
        src={videoUrl}
        data-channel={isPrimary ? 'primary' : channelId}
        style={videoStyle}
        onTimeUpdate={onTimeUpdate}
        onLoadedMetadata={onLoadedMetadata}
        onPlay={onPlay}
        onPause={onPause}
        onEnded={onEnded}
      />

      {/* Channel label badge */}
      {label && (
        <div style={{
          position: 'absolute', top: 6, left: 8, pointerEvents: 'none',
          fontFamily: 'var(--mono)', fontSize: 9, fontWeight: 700,
          color: isPrimary ? 'var(--acc)' : '#4da6ff',
          background: 'rgba(0,0,0,.7)', padding: '2px 6px', borderRadius: 3,
          letterSpacing: '.08em',
        }}>
          {label}
        </div>
      )}

      {/* Per-channel fullscreen button */}
      <div
        onClick={toggleFullscreen}
        title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        style={{
          position: 'absolute', bottom: 6, right: 6,
          width: 26, height: 26,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,.6)', borderRadius: 4,
          color: 'rgba(255,255,255,.8)', cursor: 'pointer',
          opacity: showBtn || isFullscreen ? 1 : 0,
          transition: 'opacity .15s',
          zIndex: 20,
        }}
      >
        {isFullscreen ? <MdFullscreenExit size={16} /> : <MdFullscreen size={16} />}
      </div>
    </div>
  )
})

VideoChannel.displayName = 'VideoChannel'

export default VideoChannel
