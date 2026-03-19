import { forwardRef } from 'react'

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
  const videoStyle: React.CSSProperties = fillHeight
    ? { width: '100%', height: '100%', objectFit: 'contain', display: 'block', background: '#000' }
    : { width: '100%', display: 'block', aspectRatio: '16/9', background: '#000' }

  return (
    <div style={{
      position: 'relative',
      flex: '0 0 auto',
      minWidth: 0,
      background: '#000',
      ...containerStyle,
    }}>
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

      {label && (
        <div style={{
          position: 'absolute', top: 6, left: 8, pointerEvents: 'none',
          fontFamily: 'var(--mono)', fontSize: 9, fontWeight: 700,
          color: channelId === 'front' ? 'var(--acc)' : channelId === 'rear' ? '#4da6ff' : 'var(--txt3)',
          background: 'rgba(0,0,0,.7)', padding: '2px 6px', borderRadius: 3,
          letterSpacing: '.08em',
        }}>
          {label}
        </div>
      )}
    </div>
  )
})

VideoChannel.displayName = 'VideoChannel'

export default VideoChannel
