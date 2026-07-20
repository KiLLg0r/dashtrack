# DashTrack — Claude Code Context

## Project overview
A dashcam GPS tracker web app. Reads GPS data directly from the binary
`freeGPS` blocks embedded in Viofo MP4 files (no OCR, no external tools),
displays the route on a Mapbox satellite map synced frame-accurately to
video playback.

**Current state:** working single-container app (FastAPI + React) with a
full library system, multi-channel video (front / interior / rear),
multi-segment route composition, and a pluggable camera-**provider**
architecture. Viofo (Novatek `freeGPS`) is the only provider implemented;
the seam exists so other brands can be added without touching the DB, API
or UI.

---

## Running the project

```bash
# Dev mode (hot reload)
uvicorn main:app --reload --port 8080          # terminal 1
npm run dev                                     # terminal 2 → http://localhost:5173

# Production (single container)
docker build -t dashtrack .
docker run -p 8080:8000 -v /your/footage:/footage dashtrack
# → http://localhost:8080

# Or docker-compose (mounts footage / data / gpx volumes)
docker compose up -d
```

`npm run build` = `tsc && vite build`. Lint/format: `ruff check .`,
`ruff format .`, `eslint src`. A `.pre-commit-config.yaml` runs ruff + tsc +
eslint.

---

## Current file structure

```
dashtrack-single/
├── Dockerfile / docker-compose.yml
├── requirements.txt        # fastapi, uvicorn, python-multipart, aiofiles, sqlmodel, watchfiles
├── package.json            # react, mapbox-gl, zustand, react-icons, react-day-picker, vite, ts
├── vite.config.ts          # dev proxy /api → :8080, no rewrite, timeout:0
├── ruff.toml / eslint.config.js / .pre-commit-config.yaml
├── index.html / tsconfig.json
│
├── main.py                 # FastAPI: SPA + /api/health, /api/config, /api/extract/*
├── extractor.py            # Viofo/Novatek freeGPS binary decoder → GPSPoint[] + GPX writer
├── db.py                   # SQLModel Clip table + SQLite engine + in-place migrations
├── scanner.py              # footage dir scan / watch / index (provider-driven)
│
├── providers/              # ── camera provider abstraction ──
│   ├── __init__.py         # registry: PROVIDERS, detect_provider(), provider_for()
│   ├── base.py             # Provider ABC + ClipMeta dataclass
│   └── viofo.py            # Viofo provider: freeGPS filename convention + extraction
│
├── routers/
│   ├── __init__.py
│   └── library.py          # /api/library/*, /api/footage/{id}, reindex
│
└── src/
    ├── main.tsx            # entry; imports styles.css, injects Google Fonts
    ├── App.tsx             # stage/dock/focus layout, keyboard shortcuts, event wiring
    ├── styles.css          # all CSS + design tokens (:root variables)
    ├── channels.ts         # channel model: label / short / color / rank helpers
    ├── units.ts            # metric ⇄ imperial speed + distance conversion
    │
    ├── store/index.ts      # Zustand global state (all app state lives here)
    ├── api/library.ts      # library REST client + LibraryClip/Detail types
    │
    ├── hooks/
    │   ├── useGPX.ts       # GPX XML parser, haversine, fmtTime, bearingLabel
    │   └── useViewportWidth.ts
    │
    └── components/
        ├── FirstScreen.tsx      # welcome / empty state
        ├── MultiVideoPlayer.tsx # N-channel synced player (single / split / PiP)
        ├── VideoChannel.tsx     # one <video> element + channel label
        ├── VideoPlayer.tsx      # legacy single-file upload player
        ├── MapView.tsx          # Mapbox route layers, car marker, HUDs
        ├── PlayerBar.tsx        # transport controls (play/seek/volume/rate)
        ├── Hud.tsx              # speed + compass overlay
        ├── SpeedGraph.tsx       # speed-vs-time graph (click to seek)
        ├── StatsTile.tsx        # duration / max speed / point count
        ├── WaypointList.tsx     # downsampled waypoints (click to seek)
        ├── Timeline.tsx         # waypoint list + stats (legacy panel)
        ├── LibraryModal.tsx     # calendar/day browser + upload tab + build route
        ├── LibraryView.tsx      # clip list grouped by session
        ├── SessionBuilder.tsx   # compose multi-segment route from selected clips
        ├── UploadZone.tsx       # drag & drop upload
        └── Icon.tsx             # inline SVG icon set
```

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend framework | React 18 + TypeScript 5 |
| Build tool | Vite 5 |
| State management | Zustand 4 |
| Map | Mapbox GL JS v3 |
| Icons / calendar | react-icons, react-day-picker |
| Backend | FastAPI (Python 3.12) + Uvicorn |
| Database | SQLite via SQLModel |
| File watching | watchfiles |
| Container | Docker (multi-stage) + docker-compose |

**Mapbox token:** `VITE_MAPBOX_TOKEN` at build time, or served at runtime via
`GET /api/config` (`main.py`) so the container can be configured without a
rebuild. See `.env.example`.

---

## Camera provider architecture

DashTrack is **Viofo-specific in only two places** — the `freeGPS` GPS
decoder and the filename convention — and both live behind a provider seam.
Everything downstream (SQLite index, library API, entire frontend) is
provider-agnostic.

```
providers/base.py     Provider (ABC) + ClipMeta
providers/viofo.py    ViofoProvider  — the only concrete provider
providers/__init__.py PROVIDERS registry + detection
```

A `Provider` implements three methods:

```python
class Provider(ABC):
    id: str    # stored on each clip, e.g. 'viofo'
    name: str
    def matches(self, path: Path) -> bool: ...        # recognize own files
    def parse_meta(self, filename: str) -> ClipMeta:  # session_id, recorded_at, channel
    def extract_points(self, path: Path) -> Iterator[GPSPoint]: ...
```

`scanner.py` calls `provider_for(path)` (first match, else `DEFAULT_PROVIDER`
= Viofo, so any MP4 is still probed for GPS) and stores `provider.id` on the
`Clip` row.

**To add a new dashcam brand:** implement a `Provider` subclass (its filename
parser + GPS decoder), append an instance to `PROVIDERS` in
`providers/__init__.py`. No DB / API / frontend changes required. *Do not*
speculatively add brand parsers — only Viofo is supported today.

---

## Camera channels (front / interior / rear)

A Viofo unit records 1–3 channels. 3-channel models (e.g. A229 Plus) add an
interior/cabin camera. All channels of one recording share a 15-char session
prefix and are grouped by `session_id`.

**Viofo filename → channel** (`providers/viofo.py`):
```
2026_0628_133951_104433F.MP4   F = front     (usually the GPS source)
2026_0628_133951_104433I.MP4   I = interior
2026_0628_133951_104433R.MP4   R = rear
└── session prefix ──┘└seq┘└ch  regex: (\d{4}_\d{4}_\d{6})_\d+([FRI])\.MP4
```
The per-channel sequence numbers differ (lifetime SD counter), so the
**timestamp prefix** — not the sequence — ties channels together.

**Frontend channel model** (`src/channels.ts`) is the single source of truth
for channel presentation, replacing scattered `front ? … : rear` ternaries:
```ts
type ChannelId = 'front' | 'interior' | 'rear' | 'unknown'
channelRank(ch)   // canonical order: front(0) interior(1) rear(2) unknown(3)
channelLabel(ch)  // 'FRONT' | 'INTERIOR' | 'REAR' | 'VIDEO'
channelShort(ch)  // 'F' | 'I' | 'R' | '?'
channelColor(ch)  // front=var(--accent) interior=#c084fc rear=#4da6ff
channelBadgeClass(ch)   // 'badge--f' | 'badge--i' | 'badge--r'
byChannel(get)    // sort comparator in canonical order
```
Canonical order (front, interior, rear) drives channel array order, PiP
thumbnail order and library badges. **GPS always comes from the front
channel** (interior/rear rarely carry it), falling back to the first clip.

---

## GPS extraction — how it works

Viofo (Novatek NT96660 chip) embeds GPS as `freeGPS ` binary blocks directly
in the MP4 `mdat`, one block per second. Not a standard MP4 stream, so
`ffprobe` only shows video + audio. Implemented in `extractor.py` and wrapped
by `ViofoProvider.extract_points`.

### Binary block layout (confirmed via hex inspection of real file)
```
Offset  Size  Field
0       4     'GPS ' magic (block starts with b"freeGPS ")
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
52      4     altitude float32 LE — metres (often 0.0)
```

NMEA → decimal: `deg = int(val/100); decimal = deg + (val - deg*100) / 60`.
`extractor.py` tries offsets 32, 28, 30, 34, 36 as fallback for firmware
variants, gates teleport jumps via haversine, and rejects bad fixes.

### GPX output format (`points_to_gpx`)
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

## Library system

Auto-indexes MP4 files from a mounted directory into SQLite; no manual upload
required. GPX is extracted on ingest and cached to disk.

- **`scanner.py`** — startup scan + `watchfiles` live watcher + periodic
  re-scan fallback (NFS/SMB where inotify is silent). Env: `FOOTAGE_DIR`,
  `GPX_DIR`, `DATA_DIR`, `RESCAN_INTERVAL_SEC` (default 300), `WATCH_FORCE_POLLING`.
- **`db.py`** — `Clip` SQLModel table + engine + `_migrate()` (in-place
  `ALTER TABLE` for DBs from older versions).

### `Clip` table (db.py)
```
id (sha256(path)[:16]) · path · filename · channel · provider · session_id
recorded_at · duration_sec · size_bytes · lat/lon min/max · max_speed_mps
point_count · gpx_path · indexed_at · status ('pending'|'indexed'|'error') · error_msg
```
`channel` ∈ front|rear|interior|unknown. `provider` = indexing provider id
(e.g. 'viofo'). Speeds canonical in **m/s** (see [[units_design]]).

---

## API

```
GET  /api/health                     { status:'ok' }
GET  /api/config                     { mapboxToken, units }  ← runtime config
POST /api/extract/start              multipart MP4 upload → { job_id, file_size }
WS   /api/ws/extract/{job_id}        progress stream: {progress|done|error}

GET  /api/library                    list indexed clips (date_from/to, status, limit, offset)
GET  /api/library/days               distinct recording days + counts
POST /api/library/batch              { ids:[] } → metadata + GPX for many clips
GET  /api/library/session/{sid}      all clips in a session (front/interior/rear), canonical order
GET  /api/library/{id}               single clip metadata + GPX
GET  /api/library/{id}/minitrack     decimated lat/lon track for thumbnails
POST /api/library/reindex            re-extract GPS for all clips (background)
GET  /api/library/reindex            re-index progress (curl-friendly ANSI)
GET  /api/footage/{id}               stream MP4 with HTTP 206 Range (seeking)

GET  /api/docs                       Swagger UI
GET  /*                              React SPA (index.html fallback)
```

Clip responses still carry a `peer_clip_id` (first session sibling), but the
frontend now groups a session's channels client-side by `session_id`, so 3
channels collapse into one card/session correctly.

---

## Zustand store shape (`src/store/index.ts`)

```typescript
interface DashState {
  // GPS (flat array — single clip OR all segments concatenated)
  points: GPSPoint[]; currentIdx: number

  // Video (single-channel legacy upload path)
  videoFile; videoUrl; videoDuration; videoTime
  playing; playbackRate; volume; muted

  // Extraction (upload flow)
  extractionStatus: 'idle'|'uploading'|'extracting'|'done'|'error'
  extractionProgress; extractionError

  // Map
  mapStyle: 'standard-satellite'|'dark-v11'|'light-v11'
  followCar; swapped

  // App + display
  appMode: 'upload'|'library'
  units: 'metric'|'imperial'          // localStorage + /api/config default

  // Library
  libraryClips; libraryLoading; activeClipId
  loadLibraryClip(detail)             // single clip → 1 channel

  // Multi-channel
  channels: Channel[]                 // array keyed by channel id — N-generic
  primaryChannelId: string            // which channel is focused / has audio
  videoLayout: 'single'|'side-by-side'|'pip'
  channelFilter: 'all'|'front'|'interior'|'rear'
  loadSession(clips)                  // session (front/interior/rear) → channels[]

  // Multi-segment
  multiSession: MultiSegmentSession | null
  activeClipIndex: number
  buildMultiSession(clips)

  // Derived
  currentPoint(): GPSPoint|null
  idxAtTime(t): number                // binary search; multi-segment aware
}

interface Channel { id; clipId; videoUrl; videoDuration; label }
interface SessionClip {
  clipId; channel: ChannelId; trimStart; trimEnd; videoUrl
  peerVideoUrls?: { channel: string; videoUrl: string }[]  // interior/rear alongside front
  gpxPoints; videoOffset; color; filename; recordedAt
}
```

> Note: `SessionClip.peerVideoUrls` is an **array** (was a single
> `peerVideoUrl`). Each segment's front clip carries the URLs of its peer
> channels; the player syncs all of them.

---

## Multi-channel video (`MultiVideoPlayer.tsx`)

Renders one `<VideoChannel>` (`<video>`) per channel from `channels[]`.
Layouts:
- **single** — one channel fills the stage.
- **side-by-side** — channels in a flex row, equal size.
- **pip** — `primaryChannelId` fills the stage; the other channels are small
  thumbnails stacked along the bottom-right. **Click a thumbnail to promote
  it** to the main slot (or the swap button cycles focus).

A single master clock drives sync: the primary's `timeupdate` sets store time
and nudges every non-primary `<video>` to the same `currentTime` (loops over
all channels — works for 1, 2 or 3). Only the primary channel plays audio.
`resolvedPrimaryId` maps `primaryChannelId` to an actual channel (the upload
path keeps `primaryChannelId='front'` while its only channel is `'upload'`).

---

## Multi-segment route selector

Compose arbitrary clips (different days/locations) into one continuous route +
playlist (`SessionBuilder.tsx`, `buildMultiSession`). Each segment is a
`SessionClip` with its own trim, GPS subset, segment color and cumulative
`videoOffset`. `idxAtTime` finds which clip owns the current playback time,
then binary-searches within that clip's points. The player swaps `video.src`
(primary + all peers) at clip boundaries. Selected clips are grouped into
segments **by `session_id`**, so a segment automatically includes its
interior/rear peers.

---

## Layout behavior (`App.tsx`)

Not a simple 2-pane swap anymore. A positional system over stable container
refs:
- **stage**: `'map'` or `'video'` — which fills the main area (swap button).
- **dock**: `dockOpen` true → bento-grid dashboard tiles (stats, speed graph,
  waypoints); false → cinema mode with a small PiP overlay.
- **focus overlays**: `focusVid` / `focusMap` — full-screen one element.
- responsive: `isMobile = vw < 760` (`useViewportWidth`).

**Keyboard shortcuts:** Space = play/pause · ←/→ = ±10s · Shift+←/→ = ±30s ·
M = mute · C = toggle dashboard/cinema.

**Inter-component communication:** components dispatch
`window.dispatchEvent(new CustomEvent('dashtrack:seek', { detail: { idx } }))`
and the player listens and seeks the primary `<video>`.

---

## CSS design system (`src/styles.css`)

All tokens are in `:root` in `src/styles.css` (imported by `main.tsx`; no
longer injected inline). Key tokens:
```css
--accent:#f5c542  --accent-rgb:245,197,66   /* yellow accent */
--bg:#070809  --bg2:#0c0e12
--glass / --glass2                          /* glass-morphism panels */
--tile:#14171f  --tile-brd  --hair
--txt:#eef1f6  --txt2:#aab2c0  --txt3:#7a8494
--grn:#2ee6a6  --red:#ff5d73
--font-display:'Sora'  --font-mono:'IBM Plex Mono'
--pad --gap --tile-w --radius --shadow
```
Channel badge classes: `.badge--f` (accent), `.badge--i` (#c084fc purple),
`.badge--r` (green).

---

## Known issues

- **Legacy CSS-var names:** several inline-styled components still use the
  project's earlier token names (`var(--acc)`, `var(--mono)`, `var(--s3)`,
  `var(--b2)`, `var(--acc-dim)`, `var(--acc2)`, `var(--r)`). These are now
  defined as **compatibility aliases** in `styles.css :root` (mapped onto the
  current palette) so they render as intended. New code should still prefer the
  canonical tokens (`--accent`, `--font-mono`, `--tile`, `--radius`, …);
  migrating the inline styles off the aliases and dropping them is optional
  cleanup.
- Altitude is often `0.0` (A229 Plus firmware doesn't write it).
- Bundle is ~1.9 MB (mapbox-gl dominates) — consider `manualChunks`.
- No auth — local-only by design.
- Large merged files (8h) have no GPS if merged without `-map 0`.

## Correct ffmpeg merge (preserves GPS blocks)
```bash
ls -1v *.MP4 | sed "s/^/file '/" | sed "s/$/'/" > filelist.txt
ffmpeg -f concat -safe 0 -i filelist.txt -map 0 -c copy merged.MP4
```
