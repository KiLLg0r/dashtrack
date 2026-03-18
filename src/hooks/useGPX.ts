import { GPSPoint } from '../store'

export function parseGPX(xml: string): GPSPoint[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const trkpts = [...doc.querySelectorAll('trkpt')]

  return trkpts.map(tp => {
    const lat = parseFloat(tp.getAttribute('lat') ?? '0')
    const lon = parseFloat(tp.getAttribute('lon') ?? '0')
    const ele = tp.querySelector('ele')?.textContent
    const se  = tp.querySelector('speed')
    const ve  = tp.querySelector('video_sec')
    const be  = tp.querySelector('bearing')
    const te  = tp.querySelector('time')

    return {
      lat,
      lon,
      alt:      ele  ? parseFloat(ele)  : null,
      speed:    se   ? parseFloat(se.textContent ?? '0') * 3.6 : 0,
      videoSec: ve   ? parseFloat(ve.textContent ?? '0') : 0,
      bearing:  be   ? parseFloat(be.textContent ?? '0') : 0,
      time:     te   ? new Date(te.textContent ?? '') : null,
    }
  }).filter(p => !isNaN(p.lat) && !isNaN(p.lon))
}

export function haversine(a: GPSPoint, b: GPSPoint): number {
  const R = 6371000
  const dLat = (b.lat - a.lat) * Math.PI / 180
  const dLon = (b.lon - a.lon) * Math.PI / 180
  const x = Math.sin(dLat / 2) ** 2
    + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x))
}

export function totalDistance(pts: GPSPoint[]): number {
  let d = 0
  for (let i = 1; i < pts.length; i++) d += haversine(pts[i - 1], pts[i])
  return d
}

export function fmtTime(sec: number): string {
  const m = Math.floor(Math.abs(sec) / 60)
  const s = Math.floor(Math.abs(sec) % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h ? `${h}h ${m}m` : `${m}m ${s % 60}s`
}

export function bearingLabel(b: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  return dirs[Math.round(b / 45) % 8]
}
