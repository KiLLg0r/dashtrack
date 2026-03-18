import { useEffect, useRef, useCallback } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { useStore, GPSPoint } from '../store'
import { haversine } from '../hooks/useGPX'

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN ?? ''

const GAP_THRESHOLD_M = 500
const GAP_THRESHOLD_S = 120

export default function MapView() {
  const {
    points, currentIdx, followCar, mapStyle, multiSession,
    setFollowCar, setMapStyle, setCurrentIdx,
  } = useStore()

  const containerRef      = useRef<HTMLDivElement>(null)
  const mapRef            = useRef<mapboxgl.Map | null>(null)
  const carMarkerRef      = useRef<mapboxgl.Marker | null>(null)
  const staticMarkersRef  = useRef<mapboxgl.Marker[]>([])
  const gapMarkersRef     = useRef<mapboxgl.Marker[]>([])
  const prevIdx           = useRef(-1)
  const routeAdded        = useRef(false)
  const styleFirstRun     = useRef(true)

  // Init map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const m = new mapboxgl.Map({
      container: containerRef.current,
      style: `mapbox://styles/mapbox/${mapStyle}`,
      center: [25.6, 45.65],
      zoom: 13,
      attributionControl: false,
    })
    m.addControl(new mapboxgl.NavigationControl(), 'bottom-right')
    mapRef.current = m
    const ro = new ResizeObserver(() => m.resize())
    ro.observe(containerRef.current)
    return () => { ro.disconnect(); m.remove(); mapRef.current = null }
  }, [])

  // Helper: clear all route layers/sources and markers
  const clearRoute = useCallback((m: mapboxgl.Map) => {
    // Remove static markers
    staticMarkersRef.current.forEach(mk => mk.remove())
    staticMarkersRef.current = []
    gapMarkersRef.current.forEach(mk => mk.remove())
    gapMarkersRef.current = []
    if (carMarkerRef.current) { carMarkerRef.current.remove(); carMarkerRef.current = null }

    // Remove single-route layers/sources
    ;['route-click', 'route-passed', 'route-full'].forEach(id => {
      try { if (m.getLayer(id)) m.removeLayer(id) } catch { /* */ }
    })
    ;['route', 'route-passed'].forEach(id => {
      try { if (m.getSource(id)) m.removeSource(id) } catch { /* */ }
    })

    // Remove segment layers/sources (up to 50)
    for (let i = 0; i < 50; i++) {
      ;[`seg-full-${i}`, `seg-passed-${i}`, `seg-click-${i}`].forEach(id => {
        try { if (m.getLayer(id)) m.removeLayer(id) } catch { /* */ }
      })
      ;[`seg-${i}`, `seg-passed-${i}`].forEach(id => {
        try { if (m.getSource(id)) m.removeSource(id) } catch { /* */ }
      })
    }
    routeAdded.current = false
  }, [])

  const mkMarker = useCallback((color: string, pos: [number, number], m: mapboxgl.Map): mapboxgl.Marker => {
    const mk = new mapboxgl.Marker({ color }).setLngLat(pos).addTo(m)
    staticMarkersRef.current.push(mk)
    return mk
  }, [])

  const mkCarMarker = useCallback((pos: [number, number], m: mapboxgl.Map) => {
    const el = document.createElement('div')
    el.innerHTML = `<svg width="22" height="22" viewBox="0 0 22 22"><circle cx="11" cy="11" r="9" fill="#f5c542" fill-opacity=".25"/><circle cx="11" cy="11" r="5" fill="#f5c542"/><circle cx="11" cy="11" r="2" fill="#fff"/></svg>`
    carMarkerRef.current = new mapboxgl.Marker({ element: el, anchor: 'center' }).setLngLat(pos).addTo(m)
  }, [])

  const seekToIdx = useCallback((idx: number) => {
    const { videoUrl, channels } = useStore.getState()
    if (!videoUrl && !channels.length) return
    setCurrentIdx(idx)
    window.dispatchEvent(new CustomEvent('dashtrack:seek', { detail: { idx } }))
  }, [setCurrentIdx])

  // Add route when points change
  useEffect(() => {
    const m = mapRef.current
    if (!m || !points.length) return

    const buildRoute = () => {
      clearRoute(m)
      const { multiSession: ms, points: pts } = useStore.getState()

      if (ms) {
        // ── Multi-segment ─────────────────────────────────────
        ms.clips.forEach((clip, i) => {
          const coords = clip.gpxPoints.map(p => [p.lon, p.lat])
          if (!coords.length) return

          m.addSource(`seg-${i}`,        { type: 'geojson', data: mkLine(coords) })
          m.addSource(`seg-passed-${i}`, { type: 'geojson', data: mkLine([coords[0], coords[0]]) })

          m.addLayer({ id: `seg-full-${i}`,   type: 'line', source: `seg-${i}`,        paint: { 'line-color': clip.color, 'line-width': 2.5, 'line-opacity': 0.3 } })
          m.addLayer({ id: `seg-passed-${i}`, type: 'line', source: `seg-passed-${i}`, paint: { 'line-color': clip.color, 'line-width': 3,   'line-opacity': 1   } })
          m.addLayer({ id: `seg-click-${i}`,  type: 'line', source: `seg-${i}`,        paint: { 'line-color': 'transparent', 'line-width': 20, 'line-opacity': 0 } })

          const si = i  // closure capture
          m.on('click', `seg-click-${si}`, (e: mapboxgl.MapMouseEvent) => {
            const ll = e.lngLat
            const offset = ms.clipPointOffsets[si]
            let best = offset, bestD = Infinity
            clip.gpxPoints.forEach((p, j) => {
              const d = Math.hypot(p.lat - ll.lat, p.lon - ll.lng)
              if (d < bestD) { bestD = d; best = offset + j }
            })
            seekToIdx(best)
          })
          m.on('mouseenter', `seg-click-${i}`, () => m.getCanvas().style.cursor = 'pointer')
          m.on('mouseleave', `seg-click-${i}`, () => m.getCanvas().style.cursor = '')

          // Segment start marker
          mkMarker(clip.color, coords[0] as [number, number], m)
        })

        // End marker on last segment
        const lastClip = ms.clips[ms.clips.length - 1]
        if (lastClip?.gpxPoints.length) {
          const lp = lastClip.gpxPoints[lastClip.gpxPoints.length - 1]
          mkMarker('#ff4d6d', [lp.lon, lp.lat], m)
        }

        // Gap markers
        for (let i = 0; i < ms.clips.length - 1; i++) {
          const a = ms.clips[i]
          const b = ms.clips[i + 1]
          const lastA = a.gpxPoints[a.gpxPoints.length - 1]
          const firstB = b.gpxPoints[0]
          if (!lastA || !firstB) continue
          const dist = haversine(lastA, firstB)
          const timeDiff = Math.abs(a.videoOffset + (a.trimEnd - a.trimStart) - b.videoOffset)
          if (dist > GAP_THRESHOLD_M || timeDiff > GAP_THRESHOLD_S) {
            const el = document.createElement('div')
            el.title = 'Gap — click to jump to next segment'
            el.innerHTML = `<div style="width:20px;height:20px;border-radius:50%;background:#09090c;border:2px solid ${b.color};display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:11px;font-weight:700;color:${b.color}">▶</div>`
            const gapIdx = ms.clipPointOffsets[i + 1]
            el.addEventListener('click', () => seekToIdx(gapIdx))
            const mk = new mapboxgl.Marker({ element: el, anchor: 'center' })
              .setLngLat([(lastA.lon + firstB.lon) / 2, (lastA.lat + firstB.lat) / 2])
              .addTo(m)
            gapMarkersRef.current.push(mk)
          }
        }

        // Car marker at first point
        if (pts[0]) mkCarMarker([pts[0].lon, pts[0].lat], m)
        fitBounds(m, pts)

      } else {
        // ── Single route ──────────────────────────────────────
        const coords = pts.map((p: GPSPoint) => [p.lon, p.lat])
        const { currentIdx: idx } = useStore.getState()
        const passed = coords.slice(0, idx + 1)

        m.addSource('route',        { type: 'geojson', data: mkLine(coords) })
        m.addSource('route-passed', { type: 'geojson', data: mkLine(passed.length >= 2 ? passed : [coords[0], coords[0]]) })

        m.addLayer({ id: 'route-full',   type: 'line', source: 'route',        paint: { 'line-color': '#ffffff', 'line-width': 2.5, 'line-opacity': 0.2 } })
        m.addLayer({ id: 'route-passed', type: 'line', source: 'route-passed', paint: { 'line-color': '#f5c542', 'line-width': 3,   'line-opacity': 1   } })
        m.addLayer({ id: 'route-click',  type: 'line', source: 'route',        paint: { 'line-color': 'transparent', 'line-width': 20, 'line-opacity': 0 } })

        m.on('click', 'route-click', (e: mapboxgl.MapMouseEvent) => {
          const ll = e.lngLat
          let best = 0, bestD = Infinity
          pts.forEach((p: GPSPoint, i: number) => {
            const d = Math.hypot(p.lat - ll.lat, p.lon - ll.lng)
            if (d < bestD) { bestD = d; best = i }
          })
          seekToIdx(best)
        })
        m.on('mouseenter', 'route-click', () => m.getCanvas().style.cursor = 'pointer')
        m.on('mouseleave', 'route-click', () => m.getCanvas().style.cursor = '')

        mkMarker('#00e5a0', coords[0] as [number, number], m)
        mkMarker('#ff4d6d', coords[coords.length - 1] as [number, number], m)
        mkCarMarker(coords[Math.min(idx, coords.length - 1)] as [number, number], m)
        fitBounds(m, pts)
      }

      routeAdded.current = true
    }

    if (m.isStyleLoaded()) buildRoute()
    else m.once('style.load', buildRoute)
  }, [points, multiSession, clearRoute, mkMarker, mkCarMarker, seekToIdx])

  // Update car marker + passed path on index change
  useEffect(() => {
    const m = mapRef.current
    if (!m || !points.length || currentIdx === prevIdx.current) return
    prevIdx.current = currentIdx
    const p = points[currentIdx]
    if (!p) return

    carMarkerRef.current?.setLngLat([p.lon, p.lat])
    if (followCar) m.easeTo({ center: [p.lon, p.lat], duration: 200 })

    if (multiSession) {
      multiSession.clips.forEach((clip, i) => {
        const offset = multiSession.clipPointOffsets[i]
        const endOffset = multiSession.clipPointOffsets[i + 1] ?? points.length
        const src = m.getSource(`seg-passed-${i}`) as mapboxgl.GeoJSONSource | undefined
        if (!src) return
        if (currentIdx < offset) {
          const fp = clip.gpxPoints[0]
          src.setData(mkLine(fp ? [[fp.lon, fp.lat], [fp.lon, fp.lat]] : [[0, 0], [0, 0]]))
        } else if (currentIdx >= endOffset) {
          src.setData(mkLine(clip.gpxPoints.map(q => [q.lon, q.lat])))
        } else {
          const passed = clip.gpxPoints.slice(0, currentIdx - offset + 1).map(q => [q.lon, q.lat])
          src.setData(mkLine(passed.length >= 2 ? passed : [passed[0] ?? [0, 0], passed[0] ?? [0, 0]]))
        }
      })
    } else {
      const src = m.getSource('route-passed') as mapboxgl.GeoJSONSource | undefined
      src?.setData(mkLine(points.slice(0, currentIdx + 1).map((q: GPSPoint) => [q.lon, q.lat])))
    }
  }, [currentIdx, points, followCar, multiSession])

  // Style change — rebuild route after style loads
  useEffect(() => {
    if (styleFirstRun.current) { styleFirstRun.current = false; return }
    const m = mapRef.current
    if (!m) return
    m.setStyle(`mapbox://styles/mapbox/${mapStyle}`)
    m.once('style.load', () => {
      const { points: pts, multiSession: ms } = useStore.getState()
      if (!pts.length) return
      clearRoute(m)
      if (ms) {
        // Trigger rebuild via setting routeAdded — the points useEffect won't re-fire
        // so we rebuild inline (style load clears all layers)
        ms.clips.forEach((clip, i) => {
          const coords = clip.gpxPoints.map(p => [p.lon, p.lat])
          if (!coords.length) return
          m.addSource(`seg-${i}`,        { type: 'geojson', data: mkLine(coords) })
          m.addSource(`seg-passed-${i}`, { type: 'geojson', data: mkLine([coords[0], coords[0]]) })
          m.addLayer({ id: `seg-full-${i}`,   type: 'line', source: `seg-${i}`,        paint: { 'line-color': clip.color, 'line-width': 2.5, 'line-opacity': 0.3 } })
          m.addLayer({ id: `seg-passed-${i}`, type: 'line', source: `seg-passed-${i}`, paint: { 'line-color': clip.color, 'line-width': 3,   'line-opacity': 1   } })
        })
      } else {
        const coords = pts.map((p: GPSPoint) => [p.lon, p.lat])
        const { currentIdx: idx } = useStore.getState()
        const passed = coords.slice(0, idx + 1)
        m.addSource('route',        { type: 'geojson', data: mkLine(coords) })
        m.addSource('route-passed', { type: 'geojson', data: mkLine(passed.length >= 2 ? passed : [coords[0], coords[0]]) })
        m.addLayer({ id: 'route-full',   type: 'line', source: 'route',        paint: { 'line-color': '#ffffff', 'line-width': 2.5, 'line-opacity': 0.2 } })
        m.addLayer({ id: 'route-passed', type: 'line', source: 'route-passed', paint: { 'line-color': '#f5c542', 'line-width': 3,   'line-opacity': 1   } })
      }
    })
  }, [mapStyle, clearRoute])

  // Determine current segment color
  const segmentColor = multiSession
    ? (() => {
        const { clips, clipPointOffsets } = multiSession
        let si = clips.length - 1
        for (let i = 0; i < clips.length; i++) {
          if (currentIdx < (clipPointOffsets[i + 1] ?? Infinity)) { si = i; break }
        }
        return clips[si]?.color ?? 'var(--acc)'
      })()
    : 'var(--acc)'

  const p = points[currentIdx]

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      {/* Coords HUD */}
      {p && (
        <div style={{ position: 'absolute', top: 10, left: 10, display: 'flex', flexDirection: 'column', gap: 6, pointerEvents: 'none', zIndex: 10 }}>
          <HudPill>
            <b style={{ color: 'var(--grn)' }}>{p.lat.toFixed(6)}</b>
            &nbsp;&nbsp;
            <b style={{ color: 'var(--grn)' }}>{p.lon.toFixed(6)}</b>
          </HudPill>
          {p.alt !== null && p.alt !== 0 && (
            <HudPill>alt <b style={{ color: 'var(--grn)' }}>{Math.round(p.alt)}</b> m</HudPill>
          )}
        </div>
      )}

      {/* Map controls */}
      <div style={{ position: 'absolute', top: 10, right: 10, display: 'flex', flexDirection: 'column', gap: 6, zIndex: 10 }}>
        <MapBtn active={followCar} onClick={() => setFollowCar(!followCar)}>
          <Dot active={followCar} /> Follow car
        </MapBtn>
        <MapBtn onClick={() => setMapStyle(mapStyle === 'satellite-streets-v12' ? 'dark-v11' : 'satellite-streets-v12')}>
          <Dot color="var(--acc2)" /> {mapStyle === 'satellite-streets-v12' ? 'Satellite' : 'Dark'}
        </MapBtn>
      </div>

      {/* Speed HUD */}
      {p && p.speed > 0 && (
        <div style={{ position: 'absolute', bottom: 12, left: 12, background: 'rgba(9,9,12,0.9)', border: `1px solid ${segmentColor}55`, borderRadius: 10, padding: '8px 16px', zIndex: 10, pointerEvents: 'none' }}>
          <div>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 26, fontWeight: 500, color: segmentColor, lineHeight: 1 }}>{Math.round(p.speed)}</span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--txt2)', marginLeft: 3 }}>km/h</span>
          </div>
          {p.bearing !== 0 && (
            <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--txt3)', marginTop: 2 }}>
              {bearingLabel(p.bearing)} · {Math.round(p.bearing)}°
            </div>
          )}
        </div>
      )}

      <style>{`.mapboxgl-ctrl-logo,.mapboxgl-ctrl-attrib{display:none!important}`}</style>
    </div>
  )
}

// ── Utilities ──────────────────────────────────────────────────────────────

function mkLine(coords: number[][]): GeoJSON.Feature {
  return { type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} }
}

function fitBounds(m: mapboxgl.Map, pts: GPSPoint[]) {
  if (pts.length < 2) return
  m.fitBounds([
    [Math.min(...pts.map(p => p.lon)), Math.min(...pts.map(p => p.lat))],
    [Math.max(...pts.map(p => p.lon)), Math.max(...pts.map(p => p.lat))],
  ], { padding: 50 })
}

function bearingLabel(b: number) {
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(b / 45) % 8]
}

function HudPill({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: 'rgba(9,9,12,0.85)', border: '1px solid var(--b2)', borderRadius: 20, padding: '4px 12px', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--txt2)', backdropFilter: 'blur(6px)' }}>
      {children}
    </div>
  )
}

function MapBtn({ children, onClick, active }: { children: React.ReactNode; onClick: () => void; active?: boolean }) {
  return (
    <div onClick={onClick} style={{
      background: 'rgba(9,9,12,0.88)', border: '1px solid var(--b2)',
      borderRadius: 8, padding: '7px 12px', fontFamily: 'var(--mono)', fontSize: 11,
      color: active ? 'var(--grn)' : 'var(--acc)', cursor: 'pointer',
      display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
    }}>
      {children}
    </div>
  )
}

function Dot({ active, color }: { active?: boolean; color?: string }) {
  return <div style={{ width: 7, height: 7, borderRadius: '50%', background: color ?? (active ? 'var(--grn)' : 'var(--acc)'), flexShrink: 0 }} />
}
