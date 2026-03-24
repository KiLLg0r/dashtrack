# DashTrack

A dashcam GPS visualization tool for **Viofo cameras**. Upload an MP4 directly from your SD card — or point it at a footage directory and let DashTrack auto-index everything. GPS data is extracted from the file's embedded binary blocks and displayed on a satellite map, synced frame-accurately to video playback. No external tools, no OCR, no GPS app required.

![Tech Stack](https://img.shields.io/badge/React-18-blue) ![FastAPI](https://img.shields.io/badge/FastAPI-Python_3.12-green) ![Mapbox](https://img.shields.io/badge/Map-Mapbox_GL_v3-blue) ![Docker](https://img.shields.io/badge/Docker-multi--stage-blue)

---

## How it works

Viofo dashcams (Novatek NT96660 chip) embed GPS as `freeGPS` binary blocks directly inside the MP4 file's `mdat` section — one block per second. These are invisible to standard tools like `ffprobe`, but DashTrack reads them natively.

Each block contains: GPS fix status, latitude, longitude, speed, bearing, and altitude — all encoded as raw binary floats in NMEA format.

```
Offset  Field
0       'GPS ' magic
32      Active flag ('A' = fix, 'V' = no fix)
36      Latitude  (float32 LE, NMEA DDMM.MMMM)
40      Longitude (float32 LE, NMEA DDDMM.MMMM)
44      Speed (knots)
48      Bearing (degrees)
52      Altitude (metres)
```

The extracted data is output as a GPX file with a custom `<video_sec>` extension tag per waypoint, which is what enables the frame-accurate map sync during playback.

---

## Features

- **Binary GPS extraction** — reads `freeGPS` blocks directly from Viofo MP4 files, no FFmpeg needed
- **Auto-indexing library** — mount a footage directory and DashTrack indexes all MP4s on startup, watching for new files in real time
- **Library browser** — calendar date picker, date presets, day grouping, channel filtering (front/rear/all)
- **Multi-channel video** — synchronized front + rear playback in side-by-side or picture-in-picture layout
- **Multi-segment route builder** — select clips from different days, trim start/end, reorder, and compose into a single continuous route
- **Frame-accurate map sync** — the car marker on the map moves in sync with video playback
- **Satellite map** — Mapbox GL JS v3, switchable between satellite+streets and dark vector
- **Follow car mode** — map viewport auto-pans to keep the car marker centered
- **Waypoint timeline** — scrollable list of GPS waypoints with timestamps, speed, and bearing; click to seek
- **Trip stats** — total distance, max speed, average speed, GPS fix rate
- **Swappable layout** — swap the map and video between the main panel and sidebar
- **Keyboard shortcuts** — Space (play/pause), ←/→ (±10s), Shift+←/→ (±30s), M (mute)
- **WebSocket progress** — real-time extraction progress streamed during upload
- **HTTP 206 range requests** — video files are streamed with range support for proper seeking

---

## Getting started

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) (for production)
- Node.js 18+ and Python 3.12+ (for development)
- A Mapbox access token (free at [account.mapbox.com](https://account.mapbox.com/access-tokens/))
- A Viofo dashcam MP4 file with GPS data

### Run with Docker (recommended)

```bash
docker build -t dashtrack .
docker run -p 8080:8000 -v /path/to/your/footage:/footage dashtrack
```

Open [http://localhost:8080](http://localhost:8080).

DashTrack will auto-index all MP4 files found in `/footage` on startup and watch for new ones. Use the library icon to browse indexed clips.

### Run in development mode

```bash
# Terminal 1 — backend (hot reload)
pip install -r requirements.txt
uvicorn main:app --reload --port 8080

# Terminal 2 — frontend (hot reload)
npm install
npm run dev
# → http://localhost:5173
```

---

## Usage

### Library mode (auto-indexed footage)

1. Mount your footage directory when running Docker (`-v /path/to/footage:/footage`)
2. Open the app — clips are indexed automatically in the background
3. Click the library icon to open the browser
4. Filter by date, channel, or use the calendar picker to find a recording
5. Load a single clip, a front+rear session pair, or select multiple clips to build a multi-segment route

### Upload mode (one-off files)

1. Switch to the Upload tab in the library panel
2. Drag and drop (or click to select) a Viofo `.MP4` file
3. DashTrack uploads the file, extracts GPS, and streams progress via WebSocket
4. Once done, load the same `.MP4` into the video player and press play

> **Note:** The video is played locally in your browser via `createObjectURL` — it is never stored server-side in upload mode.

---

## Merging clips with FFmpeg

Viofo saves footage in ~3-minute segments. To merge them while preserving the embedded GPS blocks:

```bash
ls -1v *.MP4 | sed "s/^/file '/" | sed "s/$/'/" > filelist.txt
ffmpeg -f concat -safe 0 -i filelist.txt -map 0 -c copy merged.MP4
```

> The `-map 0` flag is critical — without it FFmpeg drops the GPS data streams.

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + TypeScript |
| Build tool | Vite 5 |
| State management | Zustand 4 |
| Map | Mapbox GL JS v3 |
| Calendar | react-day-picker 9 |
| Backend | FastAPI (Python 3.12) |
| Database | SQLite via SQLModel |
| File watcher | watchfiles |
| Server | Uvicorn |
| Container | Docker (multi-stage build) |

---

## API

```
POST /api/extract/start              Upload MP4 → { job_id, file_size }
WS   /api/ws/extract/{job_id}        Progress stream:
                                       { type:'progress', points:N }
                                       { type:'done', gpx:'...', stats:{...} }
                                       { type:'error', message:'...' }

GET  /api/library                    List indexed clips (pagination + date filter)
GET  /api/library/days               Distinct recording days with clip counts
POST /api/library/batch              Batch fetch metadata + GPX for multiple clips
GET  /api/library/session/{id}       All clips in a session (front + rear) with GPX
GET  /api/library/{clip_id}          Single clip metadata + GPX
GET  /api/footage/{clip_id}          Stream MP4 with HTTP 206 range request support

GET  /api/health                     { status:'ok' }
GET  /api/docs                       Swagger UI
```

---

## Project structure

```
dashtrack-single/
├── Dockerfile              # Multi-stage: node build → python serve
├── requirements.txt
├── package.json
├── main.py                 # FastAPI app: SPA serving + API routes + lifespan
├── extractor.py            # Viofo freeGPS binary parser
├── db.py                   # SQLModel models + SQLite setup
├── scanner.py              # Footage directory watcher + auto-indexer
└── routers/
│   └── library.py          # Library + footage streaming API routes
└── src/
    ├── App.tsx             # Root layout, keyboard shortcuts, mode routing
    ├── store/index.ts      # Zustand global state
    ├── hooks/
    │   ├── useGPX.ts       # GPX parser, haversine distance, helpers
    │   └── useViewportWidth.ts
    ├── api/
    │   └── library.ts      # API client functions
    └── components/
        ├── LibraryModal.tsx    # Full library browser (calendar, filters, days)
        ├── SessionBuilder.tsx  # Multi-segment session composer
        ├── MultiVideoPlayer.tsx # Multi-channel video (side-by-side / PiP)
        ├── VideoChannel.tsx    # Single <video> element wrapper
        ├── VideoPlayer.tsx     # Legacy single-channel player
        ├── UploadZone.tsx      # Drag & drop upload + WS progress
        ├── MapView.tsx         # Mapbox GL map, route, car marker
        └── Timeline.tsx        # Waypoints list + trip stats
```

---

## Known limitations

> Built with AI assistance (Claude Code) — architecture, direction, and decisions by me.

- **Altitude is always 0.0** — the A229 Plus firmware doesn't write altitude data
- **No authentication** — designed for local use only
- **Viofo-specific** — only tested with Novatek NT96660-based cameras; other brands use different GPS block formats
- **No seamless clip transitions** — multi-segment playback swaps `video.src` at clip boundaries rather than using MSE
