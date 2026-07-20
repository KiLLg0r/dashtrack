import { create } from 'zustand'
import type { LibraryClip, LibraryClipDetail } from '../api/library'
import { FOOTAGE_BASE } from '../api/library'
import { byChannel, channelLabel } from '../channels'
import type { ChannelId } from '../channels'
import { parseGPX } from '../hooks/useGPX'
import type { Units } from '../units'

export interface GPSPoint {
  lat: number
  lon: number
  speed: number      // m/s (canonical — converted to km/h or mph at render)
  bearing: number    // degrees
  alt: number | null
  videoSec: number
  time: Date | null
}

export type ExtractionStatus = 'idle' | 'uploading' | 'extracting' | 'done' | 'error'
export type MapStyle = 'standard-satellite' | 'dark-v11' | 'light-v11'
export type AppMode = 'upload' | 'library'
export type VideoLayout = 'single' | 'side-by-side' | 'pip'
export type ChannelFilter = 'all' | 'front' | 'interior' | 'rear'

// ── Multi-channel ──────────────────────────────────────────────
export interface Channel {
  id: string           // channel id: 'front' | 'interior' | 'rear' | 'upload'
  clipId: string | null
  videoUrl: string | null
  videoDuration: number
  label: string
}

// One synchronized peer channel of a segment (interior/rear alongside front).
export interface PeerVideo {
  channel: string       // channel id the URL belongs to
  videoUrl: string      // /api/footage/{clipId}
}

// ── Multi-segment session ──────────────────────────────────────
export interface SessionClip {
  clipId: string
  channel: ChannelId      // the segment's primary channel (usually 'front')
  trimStart: number       // seconds into original clip
  trimEnd: number         // seconds into original clip
  videoUrl: string        // /api/footage/{clipId}
  peerVideoUrls?: PeerVideo[]  // the other channels recorded with this clip
  gpxPoints: GPSPoint[]   // trimmed GPS points
  videoOffset: number     // cumulative playback seconds before this clip
  color: string           // segment color on map
  filename: string
  recordedAt: string | null
}

export interface MultiSegmentSession {
  clips: SessionClip[]
  clipPointOffsets: number[]  // index in flat points[] where each clip starts
  totalDuration: number       // sum of (trimEnd - trimStart)
}

const SEGMENT_COLORS = ['#f5c542', '#00e5a0', '#4da6ff', '#ff6b6b', '#c084fc', '#fb923c']

interface DashState {
  // GPS data (flat array — single clip or all segments concatenated)
  points: GPSPoint[]
  setPoints: (pts: GPSPoint[]) => void

  // Video — single channel (legacy upload path)
  videoFile: File | null
  videoUrl: string | null
  videoDuration: number
  videoTime: number
  playing: boolean
  playbackRate: number
  volume: number
  muted: boolean
  setVideoFile: (f: File) => void
  setVideoDuration: (d: number) => void
  setVideoTime: (t: number) => void
  setPlaying: (p: boolean) => void
  setPlaybackRate: (r: number) => void
  setVolume: (v: number) => void
  setMuted: (m: boolean) => void

  // Extraction (upload flow)
  extractionStatus: ExtractionStatus
  extractionProgress: number
  extractionError: string | null
  setExtractionStatus: (s: ExtractionStatus) => void
  setExtractionProgress: (n: number) => void
  setExtractionError: (e: string | null) => void

  // Map
  mapStyle: MapStyle
  followCar: boolean
  swapped: boolean
  currentIdx: number
  setMapStyle: (s: MapStyle) => void
  setFollowCar: (f: boolean) => void
  setSwapped: (s: boolean) => void
  setCurrentIdx: (i: number) => void

  // App mode
  appMode: AppMode
  setAppMode: (m: AppMode) => void

  // Display units
  units: Units
  setUnits: (u: Units) => void

  // Library
  libraryClips: LibraryClip[]
  libraryLoading: boolean
  activeClipId: string | null
  setLibraryClips: (clips: LibraryClip[]) => void
  setLibraryLoading: (b: boolean) => void
  loadLibraryClip: (clip: LibraryClipDetail) => void

  // Multi-channel
  channels: Channel[]
  primaryChannelId: string
  videoLayout: VideoLayout
  channelFilter: ChannelFilter
  setChannels: (ch: Channel[]) => void
  setPrimaryChannelId: (id: string) => void
  setVideoLayout: (l: VideoLayout) => void
  setChannelFilter: (f: ChannelFilter) => void
  loadSession: (clips: LibraryClipDetail[]) => void

  // Multi-segment
  multiSession: MultiSegmentSession | null
  activeClipIndex: number
  setMultiSession: (s: MultiSegmentSession | null) => void
  setActiveClipIndex: (i: number) => void
  buildMultiSession: (clips: SessionClip[]) => void

  // Derived
  currentPoint: () => GPSPoint | null
  idxAtTime: (t: number) => number

  // Reset
  reset: () => void
}

export type { LibraryClip, LibraryClipDetail }

export const useStore = create<DashState>((set, get) => ({
  points: [],
  setPoints: (points) => set({ points }),

  videoFile: null,
  videoUrl: null,
  videoDuration: 0,
  videoTime: 0,
  playing: false,
  playbackRate: 1,
  volume: 1,
  muted: false,

  setVideoFile: (f) => {
    const prev = get().videoUrl
    // Only revoke blob: URLs, not /api/footage/ URLs
    if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev)
    set({
      videoFile: f,
      videoUrl: URL.createObjectURL(f),
      videoTime: 0,
      playing: false,
      channels: [],
      multiSession: null,
      activeClipIndex: 0,
    })
  },
  setVideoDuration: (d) => set({ videoDuration: d }),
  setVideoTime:     (t) => set({ videoTime: t }),
  setPlaying:       (p) => set({ playing: p }),
  setPlaybackRate:  (r) => set({ playbackRate: r }),
  setVolume:        (v) => set({ volume: v }),
  setMuted:         (m) => set({ muted: m }),

  extractionStatus:   'idle',
  extractionProgress: 0,
  extractionError:    null,
  setExtractionStatus:   (s) => set({ extractionStatus: s }),
  setExtractionProgress: (n) => set({ extractionProgress: n }),
  setExtractionError:    (e) => set({ extractionError: e }),

  mapStyle:   'standard-satellite',
  followCar:  true,
  swapped:    false,
  currentIdx: 0,
  setMapStyle:   (s) => set({ mapStyle: s }),
  setFollowCar:  (f) => set({ followCar: f }),
  setSwapped:    (s) => set({ swapped: s }),
  setCurrentIdx: (i) => set({ currentIdx: i }),

  appMode: 'upload',
  setAppMode: (m) => set({ appMode: m }),

  // Saved choice wins; otherwise the server default (UNITS env) is
  // applied at startup in App.tsx without persisting it.
  units: localStorage.getItem('dashtrack:units') === 'imperial' ? 'imperial' : 'metric',
  setUnits: (u) => { localStorage.setItem('dashtrack:units', u); set({ units: u }) },

  libraryClips: [],
  libraryLoading: false,
  activeClipId: null,
  setLibraryClips: (clips) => set({ libraryClips: clips }),
  setLibraryLoading: (b) => set({ libraryLoading: b }),

  loadLibraryClip: (clip) => {
    const pts = clip.gpx ? parseGPX(clip.gpx) : []
    set({
      points: pts,
      videoUrl: `${FOOTAGE_BASE}/api/footage/${clip.id}`,
      videoFile: null,
      videoTime: 0,
      videoDuration: clip.duration_sec ?? 0,
      playing: false,
      activeClipId: clip.id,
      extractionStatus: pts.length ? 'done' : 'error',
      extractionError: pts.length ? null : 'No GPS data in this clip',
      currentIdx: 0,
      channels: [{
        id: clip.channel,
        clipId: clip.id,
        videoUrl: `${FOOTAGE_BASE}/api/footage/${clip.id}`,
        videoDuration: clip.duration_sec ?? 0,
        label: channelLabel(clip.channel),
      }],
      primaryChannelId: clip.channel,
      multiSession: null,
      activeClipIndex: 0,
      channelFilter: 'all',
    })
  },

  channels: [],
  primaryChannelId: 'front',
  videoLayout: 'single',
  channelFilter: 'all',
  setChannels: (channels) => set({ channels }),
  setPrimaryChannelId: (id) => set({ primaryChannelId: id }),
  setVideoLayout: (l) => set({ videoLayout: l }),
  setChannelFilter: (f) => set({ channelFilter: f }),

  loadSession: (rawClips) => {
    // Canonical channel order so the player renders front, interior, rear.
    const clips = [...rawClips].sort(byChannel(c => c.channel))
    // GPS always from the front channel; fall back to the first clip.
    const gpsClip = clips.find(c => c.channel === 'front') ?? clips[0]
    const pts = gpsClip?.gpx ? parseGPX(gpsClip.gpx) : []
    const channels: Channel[] = clips.map(c => ({
      id: c.channel,
      clipId: c.id,
      videoUrl: `${FOOTAGE_BASE}/api/footage/${c.id}`,
      videoDuration: c.duration_sec ?? 0,
      label: channelLabel(c.channel),
    }))
    const primaryId = clips.find(c => c.channel === 'front')?.channel ?? clips[0]?.channel ?? 'front'
    set({
      points: pts,
      channels,
      primaryChannelId: primaryId,
      videoUrl: `${FOOTAGE_BASE}/api/footage/${clips.find(c => c.channel === primaryId)?.id ?? clips[0]?.id}`,
      videoFile: null,
      videoTime: 0,
      videoDuration: (clips.find(c => c.channel === primaryId) ?? clips[0])?.duration_sec ?? 0,
      playing: false,
      activeClipId: clips[0]?.id ?? null,
      extractionStatus: pts.length ? 'done' : 'error',
      extractionError: pts.length ? null : 'No GPS data in this session',
      currentIdx: 0,
      multiSession: null,
      activeClipIndex: 0,
      channelFilter: 'all',
    })
  },

  multiSession: null,
  activeClipIndex: 0,
  setMultiSession: (s) => set({ multiSession: s }),
  setActiveClipIndex: (i) => set({ activeClipIndex: i }),

  buildMultiSession: (clips) => {
    if (!clips.length) return
    // Assign colors, compute offsets
    let videoOffset = 0
    const clipPointOffsets: number[] = []
    let totalPoints = 0
    const coloredClips: SessionClip[] = clips.map((c, i) => {
      clipPointOffsets.push(totalPoints)
      totalPoints += c.gpxPoints.length
      const duration = c.trimEnd - c.trimStart
      const result = { ...c, videoOffset, color: SEGMENT_COLORS[i % SEGMENT_COLORS.length] }
      videoOffset += duration
      return result
    })

    // Flat points array: all segments concatenated
    const allPoints = coloredClips.flatMap(c => c.gpxPoints)

    const session: MultiSegmentSession = {
      clips: coloredClips,
      clipPointOffsets,
      totalDuration: videoOffset,
    }

    // Set up channels from the first clip: its own channel plus any peers,
    // ordered canonically (front, interior, rear).
    const firstClip = coloredClips[0]
    const dur = firstClip.trimEnd - firstClip.trimStart
    const channels: Channel[] = [
      {
        id: firstClip.channel,
        clipId: firstClip.clipId,
        videoUrl: firstClip.videoUrl,
        videoDuration: dur,
        label: channelLabel(firstClip.channel),
      },
      ...(firstClip.peerVideoUrls ?? []).map(pv => ({
        id: pv.channel,
        clipId: null as null,
        videoUrl: pv.videoUrl,
        videoDuration: dur,
        label: channelLabel(pv.channel),
      })),
    ].sort(byChannel(c => c.id))

    set({
      points: allPoints,
      multiSession: session,
      activeClipIndex: 0,
      channels,
      primaryChannelId: firstClip.channel,
      videoUrl: firstClip.videoUrl,
      videoFile: null,
      videoTime: 0,
      videoDuration: firstClip.trimEnd - firstClip.trimStart,
      playing: false,
      extractionStatus: 'done',
      extractionError: null,
      currentIdx: 0,
      channelFilter: 'all',
    })
  },

  reset: () => {
    const { videoUrl } = get()
    if (videoUrl && videoUrl.startsWith('blob:')) URL.revokeObjectURL(videoUrl)
    set({
      points: [],
      videoFile: null,
      videoUrl: null,
      videoDuration: 0,
      videoTime: 0,
      playing: false,
      extractionStatus: 'idle',
      extractionProgress: 0,
      extractionError: null,
      currentIdx: 0,
      activeClipId: null,
      channels: [],
      multiSession: null,
      activeClipIndex: 0,
      channelFilter: 'all',
    })
  },

  currentPoint: () => {
    const { points, currentIdx } = get()
    return points[currentIdx] ?? null
  },

  idxAtTime: (t: number) => {
    const { points, videoDuration, multiSession } = get()
    if (!points.length) return 0

    if (multiSession) {
      const { clips, clipPointOffsets } = multiSession
      // Find which clip owns time t
      let clipIdx = 0
      for (let i = clips.length - 1; i >= 0; i--) {
        if (t >= clips[i].videoOffset) { clipIdx = i; break }
      }
      const clip = clips[clipIdx]
      const offset = clipPointOffsets[clipIdx]
      const clipPts = clip.gpxPoints

      // Map playback time to local time within clip
      const localT = (t - clip.videoOffset) + clip.trimStart

      // Binary search within clip's GPS points
      let lo = 0, hi = clipPts.length - 1
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (clipPts[mid].videoSec <= localT) lo = mid + 1
        else hi = mid
      }
      return offset + Math.max(0, lo - 1)
    }

    const preciseSync = points.some(p => p.videoSec > 0)
    if (preciseSync) {
      let lo = 0, hi = points.length - 1
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (points[mid].videoSec <= t) lo = mid + 1
        else hi = mid
      }
      return Math.max(0, lo - 1)
    }
    return Math.min(Math.floor((t / (videoDuration || 1)) * (points.length - 1)), points.length - 1)
  },
}))
