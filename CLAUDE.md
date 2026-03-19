# DashTrack — Claude Code Context

## Project overview
A dashcam GPS tracker web app. Reads GPS data directly from the binary
`freeGPS` blocks embedded in Viofo MP4 files (no OCR, no external tools),
displays the route on a Mapbox satellite map synced frame-accurately to
video playback.

**Current state:** working single-container app (FastAPI + React).
**Planned:** full library system with multi-channel video, indexing, and
multi-segment route selection (see Architecture Roadmap below).

---

## Running the project

```bash
# Dev mode (hot reload)
uvicorn main:app --reload --port 8080          # terminal 1
npm run dev                                     # terminal 2 → http://localhost:5173

# Production
docker build -t dashtrack .
docker run -p 8080:8000 -v /your/footage:/footage dashtrack
# → http://localhost:8080
```

---

## Current file structure

```
dashtrack-single/
├── Dockerfile              # multi-stage: node build → python serve
├── requirements.txt        # fastapi, uvicorn, python-multipart, aiofiles
├── package.json            # react, mapbox-gl, zustand, vite, typescript
├── vite.config.ts          # dev proxy /api → :8080, no rewrite, timeout:0
├── tsconfig.json
├── index.html
│
├── main.py                 # FastAPI: serves SPA + /api/* routes
├── extractor.py            # Viofo freeGPS binary parser → GPSPoint[]
│
└── src/
    ├── main.tsx            # entry point, injects CSS variables + Google Fonts
    ├── App.tsx             # root layout grid, swap logic, keyboard shortcuts
    │
    ├── store/
    │   └── index.ts        # Zustand global state (all app state lives here)
    │
    ├── hooks/
    │   └── useGPX.ts       # GPX XML parser, haversine, fmtTime, bearingLabel
    │
    └── components/
        ├── UploadZone.tsx  # drag & drop file → POST /api/extract/start → WS progress
        ├── VideoPlayer.tsx # <video> element + seek bar + controls + volume
        ├── MapView.tsx     # Mapbox GL init, route layers, car marker, HUDs
        └── Timeline.tsx    # waypoints list (downsampled to ~120 items) + stats
```

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend framework | React 18 + TypeScript |
| Build tool | Vite 5 |
| State management | Zustand 4 |
| Map | Mapbox GL JS v3 |
| Backend | FastAPI (Python 3.12) |
| Server | Uvicorn |
| Container | Docker (multi-stage) |
| Database (planned) | SQLite via SQLModel |

**Mapbox token:**
Set via `VITE_MAPBOX_TOKEN` environment variable (see `.env.example`).
Get a free token at https://account.mapbox.com/access-tokens/

---

## CSS design system

All variables injected globally in `src/main.tsx`:

```css
--bg:#09090c       /* page background */
--s1:#0f1116       /* panel surface */
--s2:#141820       /* input / card surface */
--s3:#1c2232       /* elevated surface */
--b1/b2/b3         /* borders: 5%/10%/18% white alpha */
--acc:#f5c542      /* yellow accent (active states, seek bar) */
--acc2:#c99b10     /* darker yellow */
--acc-dim:rgba(245,197,66,0.1)
--grn:#00e5a0      /* green (GPS fix, follow car active) */
--red:#ff4d6d      /* error / end marker */
--txt/#dde2ec      /* primary text */
--txt2:#6e7a8a     /* secondary text */
--txt3:#343b48     /* muted / labels */
--mono:'JetBrains Mono', monospace
--ui:'Syne', sans-serif
--r:8px            /* border radius */
```

All inline styles in components use these variables. Never hardcode colors.

---

## GPS extraction — how it works

Viofo (Novatek NT96660 chip) embeds GPS as `freeGPS ` binary blocks
directly in the MP4 `mdat`, one block per second. Not a standard MP4 stream
so `ffprobe` only shows video + audio. The Viofo desktop app reads these natively.

### Binary block layout (confirmed via hex inspection of real file)
```
Offset  Size  Field
0       4     'GPS ' magic
4       4     record size (uint32 LE, typically 0x38 = 56 bytes)
8       4     counter (uint32 LE)
12      20    padding
32      1     active: 'A' = fix, 'V' = void/no fix
33      1     N/S hemisphere
34      1     E/W hemisphere
35      1     pad
36      4     latitude  float32 LE — NMEA DDMM.MMMM
40      4     longitude float32 LE — NMEA DDDMM.MMMM
44      4     speed float32 LE — knots
48      4     bearing float32 LE — degrees
52      4     altitude float32 LE — metres (always 0.0 on A229 Plus firmware)
```

NMEA → decimal: `deg = int(val/100); decimal = deg + (val - deg*100) / 60`

`extractor.py` tries offsets 32, 28, 30, 34, 36 as fallback for firmware variants.
`extract_points(path)` is a generator yielding `GPSPoint` dataclasses.

### GPX output format
```xml
<trkpt lat="45.6668945" lon="25.5718628">
  <ele>0.0</ele>
  <speed>1.615</speed>              <!-- m/s (GPX standard) -->
  <extensions>
    <video_sec>0.0</video_sec>      <!-- precise video timestamp for seek sync -->
    <bearing>58.8</bearing>
  </extensions>
</trkpt>
```

---

## Current API

```
POST /api/extract/start        multipart MP4 upload → { job_id, file_size }
WS   /api/ws/extract/{job_id}  progress stream:
                                 { type:'progress', points:N }
                                 { type:'done', gpx:'...', stats:{...} }
                                 { type:'error', message:'...' }
GET  /api/health               { status:'ok' }
GET  /api/docs                 Swagger UI
GET  /*                        React SPA (index.html fallback)
```

---

## Current Zustand store shape

```typescript
interface DashState {
  // GPS
  points: GPSPoint[]           // full track
  currentIdx: number           // index into points[], driven by video time

  // Video
  videoFile: File | null
  videoUrl: string | null      // URL.createObjectURL(videoFile)
  videoDuration: number
  videoTime: number
  playing: boolean
  playbackRate: number
  volume: number
  muted: boolean

  // Extraction
  extractionStatus: 'idle'|'uploading'|'extracting'|'done'|'error'
  extractionProgress: number   // GPS points extracted so far
  extractionError: string|null

  // Map
  mapStyle: 'standard-satellite'|'dark-v11'
  followCar: boolean
  swapped: boolean             // swap map↔video positions in layout

  // Derived
  idxAtTime(t): number         // binary search on video_sec, fallback proportional
  currentPoint(): GPSPoint|null
}
```

---

## Layout behavior

```
Normal:   [ MAP (left, flex:1) ] [ PANEL (right, 400px) ]
                                   ├─ VideoPlayer
                                   ├─ UploadZone
                                   └─ Timeline + stats

Swapped:  [ VIDEO (left, flex:1) ] [ PANEL (right, 400px) ]
                                     ├─ MapView
                                     ├─ UploadZone
                                     └─ Timeline + stats
```

Swap renders `<MapView>` or `<VideoPlayer>` in the left cell based on
`swapped` store state. All controls always stay in the right panel.

**Keyboard shortcuts:** Space=play/pause, ←/→=±10s, Shift+←/→=±30s, M=mute

**Inter-component communication:** components dispatch
`window.dispatchEvent(new CustomEvent('dashtrack:seek', { detail: { idx } }))`
— `App.tsx` listens and seeks the video element directly.

---

## Architecture roadmap

The following features are planned. Do not implement yet — use this section
to make architectural decisions consistent with the target state.

### 1. Multi-channel video

Support 1-channel (front only OR rear only) and 2-channel (front + rear
synchronized side-by-side or stacked).

**Viofo filename format — confirmed:**
```
2026_0314_114143_025729F.MP4
│    │    │      │     └─ channel: F=front, R=rear
│    │    │      └─────── sequence number (lifetime SD card counter, R is always F+1)
│    │    └────────────── time: HHMMSS
│    └─────────────────── date: MMDD
└──────────────────────── year: YYYY
```

**Parsing:**
```python
from datetime import datetime

# Session ID = timestamp prefix (groups F+R pairs)
session_id = filename[:15]          # "2026_0314_114143"
recorded_at = datetime.strptime(filename[:15], '%Y_%m%d_%H%M%S')
channel = 'front' if 'F.MP4' in filename else 'rear'
```

Front and rear files with the same `session_id` are synchronized pairs
recorded simultaneously. The sequence number is a lifetime SD card counter —
rear is always front+1, which is why they differ by 1 despite being the same session.

**Frontend changes needed:**
- `VideoPlayer` becomes `VideoChannel` — renders a single `<video>` element
- New `MultiVideoPlayer` wraps 1 or 2 `VideoChannel` instances
- Store gains `channels: Channel[]` where each channel has its own
  `videoFile`, `videoUrl`, `videoTime`
- A single master clock drives all channels — one `timeupdate` handler
  syncs all `<video>` elements to the same `currentTime`
- Layout option: side-by-side (both 16:9 at 50% width) or PiP (small
  rear overlay on front)

**Backend changes needed:**
- `/api/extract/start` accepts multiple files or a session ID
- Library scanner groups `_F` and `_R` files by timestamp prefix

### 2. Library system

Auto-index all MP4 files from a mounted directory. Extract GPS metadata
on ingest, store in SQLite. No manual upload — files are read directly
from disk.

**Docker volume:**
```bash
docker run -p 8080:8000 -v /path/to/footage:/footage dashtrack
```

**Planned directory structure (backend):**
```
dashtrack/
├── main.py
├── extractor.py
├── db.py            # SQLModel models + SQLite connection
├── scanner.py       # watchfiles-based directory watcher + indexer
└── routers/
    ├── library.py   # GET /api/library, GET /api/library/{id}
    ├── extract.py   # current extraction logic, refactored
    └── sessions.py  # multi-clip session assembly
```

**SQLite schema (planned):**
```sql
clips (
  id          TEXT PRIMARY KEY,   -- sha256 of file path
  path        TEXT UNIQUE,        -- absolute path on server
  filename    TEXT,
  channel     TEXT,               -- 'front' | 'rear' | 'unknown'
  session_id  TEXT,               -- groups _F and _R pairs
  recorded_at DATETIME,           -- from GPS timestamp or filename
  duration_sec REAL,
  size_bytes  INTEGER,
  lat_min     REAL,
  lat_max     REAL,
  lon_min     REAL,
  lon_max     REAL,
  max_speed   REAL,
  gpx_path    TEXT,               -- path to cached .gpx file
  indexed_at  DATETIME,
  status      TEXT                -- 'pending'|'indexed'|'error'
)
```

**Frontend changes needed:**
- New `LibraryView` component — file browser / calendar view
- New route or panel mode: `library` vs `player`
- No more `UploadZone` — replaced by library selector
- API calls: `GET /api/library` (list), `GET /api/library/{id}/gpx` (get GPX)

**File watcher (scanner.py):**
- Uses `watchfiles` (already a uvicorn dependency) to watch `/footage`
- On new `.MP4` detected → extract GPS → write `.gpx` to cache dir →
  insert/update `clips` row
- On startup → scan for any unindexed files

### 3. Multi-segment route selector

Select arbitrary clips (different days, locations, start/end points)
and compose them into a single continuous route + playlist.

**Session concept:**
```typescript
interface Session {
  id: string
  clips: SessionClip[]          // ordered list
}

interface SessionClip {
  clipId: string                // references library clip
  channel: 'front' | 'rear'
  trimStart: number             // seconds into clip
  trimEnd: number               // seconds into clip
  videoPath: string             // served from /api/footage/{id}
  gpxPoints: GPSPoint[]         // trimmed subset
  videoOffset: number           // cumulative seconds before this clip
}
```

**Route rendering with multiple segments:**
- Each segment gets its own color on the map
- Gap markers shown between non-contiguous segments (different location
  or time gap > threshold)
- Clicking a gap marker jumps to the start of the next clip
- Timeline shows clip boundaries as visual dividers

**`idxAtTime` in multi-segment mode:**
- Finds which `SessionClip` owns the current `videoOffset + currentTime`
- Then binary searches within that clip's `gpxPoints`

**Video playback in multi-segment mode:**
- MSE (Media Source Extensions) for seamless clip-to-clip transitions, OR
- Simple approach: swap `video.src` at clip boundary with a small crossfade

**New API endpoints (planned):**
```
GET  /api/library                    list all indexed clips with metadata
GET  /api/library/{id}               single clip metadata + GPX
GET  /api/footage/{id}               stream video file (Range request support)
POST /api/sessions                   create session from clip selection
GET  /api/sessions/{id}              get assembled session GPX + playlist
```

**Range request support is critical** — the `<video>` element requires
HTTP 206 Partial Content for seeking. FastAPI's `FileResponse` handles
this automatically for static files. For the library, use:
```python
from fastapi.responses import FileResponse
return FileResponse(clip.path, media_type='video/mp4')
```

---

## Known issues

- Altitude is always `0.0` — A229 Plus firmware doesn't write it
- Bundle is ~1.9MB (mapbox-gl dominates) — use `build.rollupOptions.manualChunks` to split
- No auth — local-only by design
- Large merged files (8h) have no GPS because user merged without `-map 0`

## Correct ffmpeg merge (preserves GPS blocks)
```bash
ls -1v *.MP4 | sed "s/^/file '/" | sed "s/$/'/" > filelist.txt
ffmpeg -f concat -safe 0 -i filelist.txt -map 0 -c copy merged.MP4
```
