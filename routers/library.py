"""
DashTrack — library API routes.

GET  /api/library                       list all indexed clips
GET  /api/library/session/{session_id}  both clips in a session with GPX
GET  /api/library/{clip_id}             single clip metadata + GPX
GET  /api/footage/{clip_id}             stream video file (Range-request capable)
"""

from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlmodel import Session, select

from db import Clip, get_engine

router = APIRouter()


# ── Response models ───────────────────────────────────────────────────────────

class ClipResponse(BaseModel):
    id: str
    filename: str
    channel: str
    session_id: Optional[str]
    recorded_at: Optional[str]
    duration_sec: Optional[float]
    size_bytes: int
    lat_min: Optional[float]
    lat_max: Optional[float]
    lon_min: Optional[float]
    lon_max: Optional[float]
    max_speed_kmh: Optional[float]
    point_count: Optional[int]
    status: str
    peer_clip_id: Optional[str] = None


class ClipDetailResponse(ClipResponse):
    gpx: Optional[str] = None


# ── Helpers ───────────────────────────────────────────────────────────────────

def _to_response(clip: Clip, peer_id: Optional[str] = None) -> ClipResponse:
    return ClipResponse(
        id=clip.id,
        filename=clip.filename,
        channel=clip.channel,
        session_id=clip.session_id,
        recorded_at=clip.recorded_at.isoformat() if clip.recorded_at else None,
        duration_sec=clip.duration_sec,
        size_bytes=clip.size_bytes,
        lat_min=clip.lat_min,
        lat_max=clip.lat_max,
        lon_min=clip.lon_min,
        lon_max=clip.lon_max,
        max_speed_kmh=clip.max_speed_kmh,
        point_count=clip.point_count,
        status=clip.status,
        peer_clip_id=peer_id,
    )


def _to_detail(clip: Clip, peer_id: Optional[str] = None) -> ClipDetailResponse:
    gpx = None
    if clip.gpx_path:
        p = Path(clip.gpx_path)
        if p.exists():
            gpx = p.read_text(encoding='utf-8')
    base = _to_response(clip, peer_id)
    return ClipDetailResponse(**base.model_dump(), gpx=gpx)


def _peer_id(clip: Clip, sess: Session) -> Optional[str]:
    if not clip.session_id:
        return None
    peers = sess.exec(
        select(Clip).where(
            Clip.session_id == clip.session_id,
            Clip.id != clip.id,
            Clip.status == 'indexed',
        )
    ).all()
    return peers[0].id if peers else None


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get('/api/library', response_model=list[ClipResponse])
async def list_clips(date: Optional[str] = None, status: str = 'indexed'):
    """List all indexed clips ordered by recorded_at DESC."""
    with Session(get_engine()) as sess:
        stmt = select(Clip).where(Clip.status == status)
        if date:
            from datetime import datetime as dt
            try:
                day = dt.strptime(date, '%Y-%m-%d')
                stmt = stmt.where(
                    Clip.recorded_at >= day.replace(hour=0, minute=0, second=0),
                    Clip.recorded_at < day.replace(hour=23, minute=59, second=59),
                )
            except ValueError:
                pass
        stmt = stmt.order_by(Clip.recorded_at.desc())  # type: ignore
        clips = sess.exec(stmt).all()

        # Build peer map from session groups
        session_groups: dict[str, list[Clip]] = {}
        for c in clips:
            if c.session_id:
                session_groups.setdefault(c.session_id, []).append(c)

        results = []
        for c in clips:
            peer_id = None
            if c.session_id and c.session_id in session_groups:
                peers = [p for p in session_groups[c.session_id] if p.id != c.id]
                peer_id = peers[0].id if peers else None
            results.append(_to_response(c, peer_id))
    return results


@router.get('/api/library/session/{session_id}', response_model=list[ClipDetailResponse])
async def get_session_clips(session_id: str):
    """Return all clips in a session (front + rear) with full GPX."""
    with Session(get_engine()) as sess:
        clips = sess.exec(
            select(Clip).where(
                Clip.session_id == session_id,
                Clip.status == 'indexed',
            )
        ).all()
        if not clips:
            raise HTTPException(404, f'Session {session_id} not found')

        # Sort: front first, rear second
        clips = sorted(clips, key=lambda c: (0 if c.channel == 'front' else 1))
        peer_map = (
            {clips[0].id: clips[1].id, clips[1].id: clips[0].id}
            if len(clips) == 2 else {}
        )
        return [_to_detail(c, peer_map.get(c.id)) for c in clips]


@router.get('/api/library/{clip_id}', response_model=ClipDetailResponse)
async def get_clip(clip_id: str):
    """Return a single clip's metadata and GPX."""
    with Session(get_engine()) as sess:
        clip = sess.get(Clip, clip_id)
        if not clip:
            raise HTTPException(404, 'Clip not found')
        peer_id = _peer_id(clip, sess)
        return _to_detail(clip, peer_id)


@router.get('/api/footage/{clip_id}')
async def stream_footage(clip_id: str, request: Request):
    """Stream MP4 video file — FastAPI FileResponse handles Range requests natively."""
    with Session(get_engine()) as sess:
        clip = sess.get(Clip, clip_id)
        if not clip:
            raise HTTPException(404, 'Clip not found')
        if not Path(clip.path).exists():
            raise HTTPException(404, 'Video file not found on disk')
    return FileResponse(clip.path, media_type='video/mp4')
