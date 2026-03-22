import { useLayoutEffect, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MdAdd, MdSwapHoriz, MdRefresh, MdMap, MdOndemandVideo, MdFormatListBulleted } from 'react-icons/md'
import MapView from './components/MapView'
import MultiVideoPlayer from './components/MultiVideoPlayer'
import Timeline from './components/Timeline'
import UploadZone from './components/UploadZone'
import LibraryModal from './components/LibraryModal'
import { useStore } from './store'
import { useViewportWidth } from './hooks/useViewportWidth'

type MobileTab = 'map' | 'video' | 'timeline'

export default function App() {
  const { swapped, setSwapped, multiSession, points, reset } = useStore()
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [libraryInitialTab, setLibraryInitialTab] = useState<'library' | 'upload'>('library')
  const [libraryChecked, setLibraryChecked] = useState<Set<string>>(new Set())
  const [mobileTab, setMobileTab] = useState<MobileTab>('map')

  const vw       = useViewportWidth()
  const isMobile = vw < 640
  const isTablet = vw < 900

  const openModal = (tab: 'library' | 'upload') => {
    setLibraryInitialTab(tab)
    setLibraryOpen(true)
  }

  const welcomeMode = points.length === 0

  // Stable imperative containers — created once, never destroyed.
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
    const small   = smallSlotRef.current   // null on mobile (sidebar not rendered)

    if (isMobile) {
      const showVideo = mobileTab === 'video'
      // Keep both in the left slot, toggle visibility
      mapEl.style.cssText   = `flex:1 1 0;min-height:0;position:relative;overflow:hidden;${showVideo ? 'display:none' : ''}`
      videoEl.style.cssText = `flex:1 1 0;min-height:0;display:${showVideo ? 'flex' : 'none'};flex-direction:column`
      if (mapEl.parentElement   !== left) left.appendChild(mapEl)
      if (videoEl.parentElement !== left) left.appendChild(videoEl)
    } else if (swapped) {
      videoEl.style.cssText = 'flex:1 1 0;min-height:0;width:100%;display:flex;flex-direction:column'
      left.appendChild(videoEl)
      mapEl.style.cssText = 'width:100%;height:225px;position:relative;overflow:hidden'
      small?.appendChild(mapEl)
    } else {
      mapEl.style.cssText = 'width:100%;height:100%;position:relative;overflow:hidden'
      left.appendChild(mapEl)
      videoEl.style.cssText = 'width:100%;display:flex;flex-direction:column'
      small?.appendChild(videoEl)
    }

    return () => {
      mapEl.parentElement?.removeChild(mapEl)
      videoEl.parentElement?.removeChild(videoEl)
    }
  }, [swapped, isMobile, mobileTab])

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

  const sidebarWidth = isTablet ? 320 : 400

  return (
    <>
      <div style={{
        display: 'grid',
        gridTemplateRows: isMobile && !welcomeMode ? '48px 1fr 56px' : '48px 1fr',
        gridTemplateColumns: isMobile ? '1fr' : `1fr ${sidebarWidth}px`,
        height: '100dvh',
        background: 'var(--bg)',
      }}>

        {/* HEADER */}
        <div style={{
          gridColumn: '1/-1',
          display: 'flex', alignItems: 'center', gap: isMobile ? 6 : 12,
          padding: `0 ${isMobile ? 10 : 16}px`,
          background: 'var(--s1)', borderBottom: '1px solid var(--b2)', zIndex: 100,
          overflow: 'hidden',
        }}>
          <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.1em', color: 'var(--acc)', textTransform: 'uppercase', flexShrink: 0 }}>
            DashTrack
          </span>
          {!isMobile && <div style={{ width: 1, height: 18, background: 'var(--b3)', flexShrink: 0 }} />}
          {!isMobile && <HeaderMeta />}
          <div style={{ flex: 1 }} />
          {multiSession && (
            <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--grn)', background: 'rgba(0,229,160,.08)', border: '1px solid rgba(0,229,160,.2)', borderRadius: 5, padding: '3px 8px', whiteSpace: 'nowrap', flexShrink: 0 }}>
              {multiSession.clips.length}{isMobile ? '' : ' segments'}
            </div>
          )}
          {!welcomeMode && (
            <>
              <HeaderBtn onClick={() => openModal('library')} active={libraryOpen && libraryInitialTab === 'library'}>
                {isMobile ? '☰' : 'Library'}
              </HeaderBtn>
              <HeaderBtn onClick={() => openModal('upload')} active={libraryOpen && libraryInitialTab === 'upload'}>
                <MdAdd size={15} />{!isMobile && 'Add video'}
              </HeaderBtn>
              {!isMobile && (
                <HeaderBtn onClick={() => setSwapped(!swapped)} active={swapped}>
                  <MdSwapHoriz size={16} />{swapped ? 'Unswap' : 'Swap'}
                </HeaderBtn>
              )}
              <HeaderBtn onClick={() => { reset(); setLibraryChecked(new Set()) }}>
                <MdRefresh size={15} />{!isMobile && 'Reset'}
              </HeaderBtn>
            </>
          )}
        </div>

        {/* LEFT: big slot (map + video, one visible at a time on mobile) */}
        <div
          ref={leftSlotRef}
          style={{ gridColumn: 1, gridRow: 2, overflow: 'hidden', position: 'relative', display: 'flex', flexDirection: 'column' }}
        />

        {/* RIGHT SIDEBAR — tablet/desktop only */}
        {!isMobile && (
          <div style={{ gridColumn: 2, gridRow: 2, background: 'var(--s1)', borderLeft: '1px solid var(--b2)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div ref={smallSlotRef} style={{ flexShrink: 0, overflow: 'hidden', position: 'relative' }} />
            <Timeline />
          </div>
        )}

        {/* BOTTOM TAB BAR — mobile only, not in welcome mode */}
        {isMobile && !welcomeMode && (
          <div style={{
            gridColumn: '1/-1', gridRow: 3,
            display: 'flex', background: 'var(--s1)', borderTop: '1px solid var(--b2)',
            paddingBottom: 'env(safe-area-inset-bottom, 0px)',
          }}>
            {([
              { tab: 'map'      as MobileTab, icon: <MdMap size={22} />,              label: 'Map'   },
              { tab: 'video'    as MobileTab, icon: <MdOndemandVideo size={22} />,     label: 'Video' },
              { tab: 'timeline' as MobileTab, icon: <MdFormatListBulleted size={22} />, label: 'Stats' },
            ]).map(({ tab, icon, label }) => (
              <button
                key={tab}
                onClick={() => setMobileTab(tab)}
                style={{
                  flex: 1,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  gap: 2,
                  background: 'transparent', border: 'none',
                  borderTop: `2px solid ${mobileTab === tab ? 'var(--acc)' : 'transparent'}`,
                  color: mobileTab === tab ? 'var(--acc)' : 'var(--txt3)',
                  cursor: 'pointer', transition: 'color .15s, border-color .15s',
                  fontFamily: 'var(--mono)', fontSize: 10,
                  paddingTop: 6,
                }}
              >
                {icon}
                {label}
              </button>
            ))}
          </div>
        )}

      </div>

      {/* MOBILE: Timeline overlay when Stats tab is active */}
      {isMobile && !welcomeMode && mobileTab === 'timeline' && (
        <div style={{
          position: 'fixed', top: 48, bottom: 56, left: 0, right: 0,
          zIndex: 20, background: 'var(--s1)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}>
          <Timeline />
        </div>
      )}

      {/* Welcome overlay — shown until GPS data is loaded */}
      {welcomeMode && (
        <div style={{
          position: 'fixed', inset: 0, top: 48,
          zIndex: 50,
          background: 'var(--bg)',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          gap: 28,
          padding: '0 16px',
        }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: isMobile ? 22 : 28, fontWeight: 700, letterSpacing: '.12em', color: 'var(--acc)', fontFamily: 'var(--ui)', textTransform: 'uppercase', marginBottom: 8 }}>
              DashTrack
            </div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--txt3)', letterSpacing: '.04em' }}>
              GPS route visualization for Viofo dashcams
            </div>
          </div>

          <div style={{ width: 'min(480px, 100%)' }}>
            <UploadZone />
          </div>

          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--txt3)', textAlign: 'center', lineHeight: 1.8 }}>
            or open{' '}
            <span
              onClick={() => openModal('library')}
              style={{ color: 'var(--acc)', cursor: 'pointer', textDecoration: 'underline', textDecorationColor: 'rgba(245,197,66,.4)' }}
            >
              Library
            </span>
            {' '}to browse indexed footage
          </div>
        </div>
      )}

      {/* Portals: always live in their stable containers, never remount */}
      {createPortal(<MapView />,          mapBox.current!)}
      {createPortal(<MultiVideoPlayer />, videoBox.current!)}

      {/* Library / Add video modal */}
      {libraryOpen && (
        <LibraryModal
          onClose={() => setLibraryOpen(false)}
          initialTab={libraryInitialTab}
          checked={libraryChecked}
          setChecked={setLibraryChecked}
        />
      )}
    </>
  )
}

function HeaderMeta() {
  const { points, currentIdx, extractionStatus } = useStore()
  const p = points[currentIdx]
  if (extractionStatus === 'uploading')  return <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--txt2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>uploading…</span>
  if (extractionStatus === 'extracting') return <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--acc)', whiteSpace: 'nowrap' }}>extracting GPS…</span>
  if (!p) return <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--txt3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>drop a video or open library</span>
  return (
    <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--txt2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
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
      display: 'flex', alignItems: 'center', gap: 5,
      flexShrink: 0,
    }}>
      {children}
    </div>
  )
}
