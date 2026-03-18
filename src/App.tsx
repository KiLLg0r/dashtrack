import { useLayoutEffect, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import MapView from './components/MapView'
import MultiVideoPlayer from './components/MultiVideoPlayer'
import Timeline from './components/Timeline'
import UploadZone from './components/UploadZone'
import LibraryView from './components/LibraryView'
import SessionBuilder from './components/SessionBuilder'
import { useStore } from './store'

export default function App() {
  const { swapped, setSwapped, points, appMode, setAppMode, multiSession } = useStore()

  // Stable imperative containers — created once, never destroyed.
  // React portals render MapView/MultiVideoPlayer into these divs permanently.
  // We physically move the divs between slots so neither component ever unmounts.
  const mapBox   = useRef<HTMLDivElement | null>(null)
  const videoBox = useRef<HTMLDivElement | null>(null)
  if (!mapBox.current) {
    mapBox.current = document.createElement('div')
    mapBox.current.style.cssText = 'width:100%;height:100%;position:relative;overflow:hidden'
  }
  if (!videoBox.current) {
    videoBox.current = document.createElement('div')
    videoBox.current.style.cssText = 'width:100%;display:flex;flex-direction:column'
  }

  const leftSlotRef  = useRef<HTMLDivElement>(null)
  const smallSlotRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const mapEl   = mapBox.current!
    const videoEl = videoBox.current!
    const left    = leftSlotRef.current!
    const small   = smallSlotRef.current!

    if (swapped) {
      videoEl.style.cssText = 'flex:1 1 0;min-height:0;width:100%;display:flex;flex-direction:column'
      left.appendChild(videoEl)
      mapEl.style.cssText = 'width:100%;height:225px;position:relative;overflow:hidden'
      small.appendChild(mapEl)
    } else {
      mapEl.style.cssText = 'width:100%;height:100%;position:relative;overflow:hidden'
      left.appendChild(mapEl)
      videoEl.style.cssText = 'width:100%;display:flex;flex-direction:column'
      small.appendChild(videoEl)
    }

    return () => {
      mapEl.parentElement?.removeChild(mapEl)
      videoEl.parentElement?.removeChild(videoEl)
    }
  }, [swapped])

  // Seek handler — delegates to MultiVideoPlayer via custom event for multi-segment
  useEffect(() => {
    const handler = (e: Event) => {
      const { idx } = (e as CustomEvent).detail
      const { points, multiSession } = useStore.getState()
      if (!points.length) return

      if (multiSession) {
        // MultiVideoPlayer handles multi-segment seeks internally via dashtrack:seek listener
        // (it reads multiSession state directly)
        return
      }

      // Single clip — seek primary video element
      const vid = document.querySelector('video[data-channel="primary"]') as HTMLVideoElement | null
        ?? document.querySelector('video') as HTMLVideoElement | null
      if (!vid) return
      const p = points[idx]
      if (!p) return
      const preciseSync = points.some(pt => pt.videoSec > 0)
      if (preciseSync) vid.currentTime = p.videoSec
      else vid.currentTime = (idx / (points.length - 1)) * (vid.duration || 0)
    }
    window.addEventListener('dashtrack:seek', handler)
    return () => window.removeEventListener('dashtrack:seek', handler)
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) return
      const vid = document.querySelector('video[data-channel="primary"]') as HTMLVideoElement | null
        ?? document.querySelector('video') as HTMLVideoElement | null
      if (e.code === 'Space') { e.preventDefault(); vid && (vid.paused ? vid.play() : vid.pause()) }
      if (e.code === 'ArrowRight') { e.preventDefault(); if (vid) vid.currentTime += e.shiftKey ? 30 : 10 }
      if (e.code === 'ArrowLeft')  { e.preventDefault(); if (vid) vid.currentTime -= e.shiftKey ? 30 : 10 }
      if (e.code === 'KeyM') { if (vid) vid.muted = !vid.muted }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const showSessionBuilder = appMode === 'session-builder'

  return (
    <>
      <div style={{ display: 'grid', gridTemplateRows: '48px 1fr', gridTemplateColumns: '1fr 400px', height: '100vh', background: 'var(--bg)' }}>

        {/* HEADER */}
        <div style={{ gridColumn: '1/-1', display: 'flex', alignItems: 'center', gap: 12, padding: '0 16px', background: 'var(--s1)', borderBottom: '1px solid var(--b2)', zIndex: 100 }}>
          <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.1em', color: 'var(--acc)', textTransform: 'uppercase' }}>DashTrack</span>
          <div style={{ width: 1, height: 18, background: 'var(--b3)' }} />
          <HeaderMeta />
          <div style={{ flex: 1 }} />
          {multiSession && (
            <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--grn)', background: 'rgba(0,229,160,.08)', border: '1px solid rgba(0,229,160,.2)', borderRadius: 5, padding: '3px 8px' }}>
              {multiSession.clips.length} segments
            </div>
          )}
          <HeaderBtn onClick={() => setAppMode(appMode === 'library' ? 'upload' : 'library')} active={appMode === 'library'}>
            Library
          </HeaderBtn>
          <HeaderBtn
            onClick={() => setAppMode(appMode === 'session-builder' ? 'library' : 'session-builder')}
            active={appMode === 'session-builder'}
          >
            + Session
          </HeaderBtn>
          <HeaderBtn onClick={() => setSwapped(!swapped)} active={swapped}>⇄ {swapped ? 'Unswap' : 'Swap'}</HeaderBtn>
        </div>

        {/* LEFT: big slot */}
        <div ref={leftSlotRef} style={{ gridColumn: 1, gridRow: 2, overflow: 'hidden', position: 'relative', display: 'flex', flexDirection: 'column' }} />

        {/* RIGHT SIDEBAR */}
        <div style={{ gridColumn: 2, gridRow: 2, background: 'var(--s1)', borderLeft: '1px solid var(--b2)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Small slot — Video/Map */}
          <div ref={smallSlotRef} style={{ flexShrink: 0, overflow: 'hidden', position: 'relative' }} />

          {/* Panel content — switches between Upload, Library, Session Builder */}
          {showSessionBuilder ? (
            <SessionBuilder />
          ) : appMode === 'library' ? (
            <LibraryView />
          ) : (
            <UploadZone />
          )}

          <Timeline />
        </div>

      </div>

      {/* Portals: always live in their stable containers, never remount */}
      {createPortal(<MapView />,            mapBox.current!)}
      {createPortal(<MultiVideoPlayer />,   videoBox.current!)}
    </>
  )
}

function HeaderMeta() {
  const { points, currentIdx, extractionStatus } = useStore()
  const p = points[currentIdx]
  if (extractionStatus === 'uploading') return <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--txt2)' }}>uploading…</span>
  if (extractionStatus === 'extracting') return <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--acc)' }}>extracting GPS…</span>
  if (!p) return <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--txt3)' }}>drop a video or open library</span>
  return (
    <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--txt2)' }}>
      {p.time ? <b style={{ color: 'var(--txt)' }}>{p.time.toLocaleTimeString()}&nbsp;</b> : null}
      {p.lat.toFixed(4)}, {p.lon.toFixed(4)}
    </span>
  )
}

function HeaderBtn({ children, onClick, active }: { children: React.ReactNode; onClick: () => void; active?: boolean }) {
  return (
    <div onClick={onClick} style={{
      background: active ? 'var(--acc-dim)' : 'var(--s2)',
      border: `1px solid ${active ? 'rgba(245,197,66,.4)' : 'var(--b2)'}`,
      borderRadius: 6, padding: '5px 10px', cursor: 'pointer',
      fontFamily: 'var(--mono)', fontSize: 11,
      color: active ? 'var(--acc)' : 'var(--txt2)',
      transition: 'all .15s', userSelect: 'none',
    }}>
      {children}
    </div>
  )
}
