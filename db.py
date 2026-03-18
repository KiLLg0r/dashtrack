"""
DashTrack — SQLModel database models and engine.
"""

import hashlib
import os
from datetime import datetime
from pathlib import Path
from typing import Optional

from sqlmodel import Field, SQLModel, create_engine

DATA_DIR = Path(os.getenv('DATA_DIR', '/dashtrack/data'))


class Clip(SQLModel, table=True):
    id: str = Field(primary_key=True)           # sha256(path)[:16]
    path: str = Field(unique=True, index=True)   # absolute path on server
    filename: str
    channel: str = 'unknown'                    # 'front' | 'rear' | 'unknown'
    session_id: Optional[str] = None            # '2026_0314_114143' groups F+R pairs
    recorded_at: Optional[datetime] = None      # parsed from filename
    duration_sec: Optional[float] = None
    size_bytes: int = 0
    lat_min: Optional[float] = None
    lat_max: Optional[float] = None
    lon_min: Optional[float] = None
    lon_max: Optional[float] = None
    max_speed_kmh: Optional[float] = None
    point_count: Optional[int] = None
    gpx_path: Optional[str] = None             # absolute path to cached .gpx file
    indexed_at: Optional[datetime] = None
    status: str = 'pending'                    # 'pending' | 'indexed' | 'error'
    error_msg: Optional[str] = None


def clip_id(path: str) -> str:
    """Stable short ID for a clip based on its absolute path."""
    return hashlib.sha256(path.encode()).hexdigest()[:16]


_engine = None


def get_engine():
    global _engine
    if _engine is None:
        db_path = DATA_DIR / 'dashtrack.db'
        db_path.parent.mkdir(parents=True, exist_ok=True)
        _engine = create_engine(
            f'sqlite:///{db_path}',
            connect_args={'check_same_thread': False},
        )
        SQLModel.metadata.create_all(_engine)
    return _engine
