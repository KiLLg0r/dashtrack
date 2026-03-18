import { forwardRef } from 'react'

interface Props {
  videoUrl: string
  channelId: string
  isPrimary: boolean
  label?: string
  fillHeight?: boolean
  onTimeUpdate?: React.ReactEventHandler<HTMLVideoElement>
  onLoadedMetadata?: React.ReactEventHandler<HTMLVideoElement>
  onPlay?: React.ReactEventHandler<HTMLVideoElement>
  onPause?: React.ReactEventHandler<HTMLVideoElement>
  onEnded?: React.ReactEventHandler<HTMLVideoElement>
}

const VideoChannel = forwardRef<HTMLVideoElement, Props>(({
  videoUrl, channelId, isPrimary, label,
  fillHeight = false,
  onTimeUpdate, onLoadedMetadata, onPlay, onPause, onEnded,
}, ref) => {
  return (
    <div style={{ position: 'relative', flex: '1 1 0', minWidth: 0, background: '#000' }}>
      <video
        ref={ref}
        src={videoUrl}
        data-channel={isPrimary ? 'primary' : channelId}
        style={fillHeight
          ? { width: '100%', height: '100%', objectFit: 'contain', display: 'block' }
          : { width: '100%', display: 'block', aspectRatio: '16/9' }
        }
        onTimeUpdate={onTimeUpdate}
        onLoadedMetadata={onLoadedMetadata}
        onPlay={onPlay}
        onPause={onPause}
        onEnded={onEnded}
      />
      {label && (
        <div style={{
          position: 'absolute', top: 6, left: 8,
          fontFamily: 'var(--mono)', fontSize: 9, fontWeight: 700,
          color: isPrimary ? 'var(--acc)' : '#4da6ff',
          background: 'rgba(0,0,0,.7)', padding: '2px 6px', borderRadius: 3,
          letterSpacing: '.08em', pointerEvents: 'none',
        }}>
          {label}
        </div>
      )}
    </div>
  )
})

VideoChannel.displayName = 'VideoChannel'

export default VideoChannel
