export interface LibraryClip {
  id: string
  filename: string
  channel: 'front' | 'rear' | 'unknown'
  session_id: string | null
  recorded_at: string | null
  duration_sec: number | null
  size_bytes: number
  lat_min: number | null
  lat_max: number | null
  lon_min: number | null
  lon_max: number | null
  max_speed_kmh: number | null
  point_count: number | null
  status: string
  peer_clip_id: string | null
}

export interface LibraryClipDetail extends LibraryClip {
  gpx: string | null
}

export async function fetchLibrary(): Promise<LibraryClip[]> {
  const res = await fetch('/api/library')
  if (!res.ok) throw new Error(`Library fetch failed: ${res.status}`)
  return res.json()
}

export async function fetchClip(id: string): Promise<LibraryClipDetail> {
  const res = await fetch(`/api/library/${id}`)
  if (!res.ok) throw new Error(`Clip fetch failed: ${res.status}`)
  return res.json()
}

export async function fetchSession(sessionId: string): Promise<LibraryClipDetail[]> {
  const res = await fetch(`/api/library/session/${sessionId}`)
  if (!res.ok) throw new Error(`Session fetch failed: ${res.status}`)
  return res.json()
}
