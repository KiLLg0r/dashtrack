# DashTrack

> **Disclaimer:** This entire project was built using [Claude Code](https://claude.com/claude-code) (Anthropic's AI coding assistant). The idea, overall architecture design, and bug-fixing direction came from me — Claude wrote the implementation. If you're curious what AI-assisted development looks like end-to-end, this is it.

---

A dashcam GPS visualization tool for **Viofo cameras**. Upload an MP4 directly from your SD card — DashTrack extracts the embedded GPS data from the file's binary blocks and displays your route on a satellite map, synced frame-accurately to video playback. No external tools, no OCR, no GPS app required.

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
- **Frame-accurate map sync** — the car marker on the map moves in sync with video playback
- **Satellite map** — Mapbox GL JS v3, switchable between satellite+streets and dark vector
- **Follow car mode** — map viewport auto-pans to keep the car marker centered
- **Waypoint timeline** — scrollable list of GPS waypoints with timestamps, speed, and bearing; click to seek
- **Trip stats** — total distance, max speed, average speed, GPS fix rate
- **Swappable layout** — swap the map and video between the main panel and sidebar
- **Keyboard shortcuts** — Space (play/pause), ←/→ (±10s), Shift+←/→ (±30s), M (mute)
- **WebSocket progress** — real-time extraction progress streamed during upload

---

## Getting started

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) (for production)
- Node.js 18+ and Python 3.12+ (for development)
- A Viofo dashcam MP4 file with GPS data

### Run with Docker (recommended)

```bash
docker build -t dashtrack .
docker run -p 8080:8000 dashtrack
```

Open [http://localhost:8080](http://localhost:8080).

To make your footage directory accessible inside the container:

```bash
docker run -p 8080:8000 -v /path/to/your/footage:/footage dashtrack
```

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

1. Open the app in your browser
2. Drag and drop (or click to select) a Viofo `.MP4` file onto the upload zone
3. DashTrack uploads the file, extracts the GPS blocks, and streams progress via WebSocket
4. Once done, load the same `.MP4` into the video player using the file picker above the video
5. Press play — the map marker follows your route in real time
6. Click any waypoint in the timeline to jump to that moment in the video

> **Note:** The upload sends the file to the FastAPI backend for GPS extraction. The video itself is played locally in your browser via `createObjectURL` — it is never stored server-side.

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
| Backend | FastAPI (Python 3.12) |
| Server | Uvicorn |
| Container | Docker (multi-stage build) |

---

## API

```
POST /api/extract/start        Upload MP4 → { job_id, file_size }
WS   /api/ws/extract/{job_id}  Progress stream:
                                 { type:'progress', points:N }
                                 { type:'done', gpx:'...', stats:{...} }
                                 { type:'error', message:'...' }
GET  /api/health               { status:'ok' }
GET  /api/docs                 Swagger UI
```

---

## Project structure

```
dashtrack-single/
├── Dockerfile              # Multi-stage: node build → python serve
├── requirements.txt
├── package.json
├── main.py                 # FastAPI app: SPA serving + API routes
├── extractor.py            # Viofo freeGPS binary parser
└── src/
    ├── App.tsx             # Root layout, keyboard shortcuts
    ├── store/index.ts      # Zustand global state
    ├── hooks/useGPX.ts     # GPX parser, haversine distance, helpers
    └── components/
        ├── UploadZone.tsx  # Drag & drop upload + WS progress
        ├── VideoPlayer.tsx # Video element + controls
        ├── MapView.tsx     # Mapbox GL map, route, car marker
        └── Timeline.tsx    # Waypoints list + trip stats
```

---

## Known limitations

- **Altitude is always 0.0** — the A229 Plus firmware doesn't write altitude data
- **No authentication** — designed for local use only
- **Viofo-specific** — only tested with Novatek NT96660-based cameras; other brands use different GPS block formats

---

## Roadmap

- Multi-channel video support (front + rear synchronized playback)
- Library system — auto-index footage from a mounted directory, SQLite storage
- Multi-segment route selection — compose routes from multiple clips across different days
