"""
DashTrack — SQLModel database models and engine.
"""

import hashlib
import os
from datetime import datetime
from pathlib import Path

from sqlalchemy import text
from sqlmodel import Field, SQLModel, create_engine

DATA_DIR = Path(os.getenv("DATA_DIR", "/dashtrack/data"))


class Clip(SQLModel, table=True):
    id: str = Field(primary_key=True)  # sha256(path)[:16]
    path: str = Field(unique=True, index=True)  # absolute path on server
    filename: str
    channel: str = "unknown"  # 'front' | 'rear' | 'unknown'
    session_id: str | None = None  # '2026_0314_114143' groups F+R pairs
    recorded_at: datetime | None = None  # parsed from filename
    duration_sec: float | None = None
    size_bytes: int = 0
    lat_min: float | None = None
    lat_max: float | None = None
    lon_min: float | None = None
    lon_max: float | None = None
    max_speed_mps: float | None = None  # metres/second (canonical)
    point_count: int | None = None
    gpx_path: str | None = None  # absolute path to cached .gpx file
    indexed_at: datetime | None = None
    status: str = "pending"  # 'pending' | 'indexed' | 'error'
    error_msg: str | None = None


def clip_id(path: str) -> str:
    """Stable short ID for a clip based on its absolute path."""
    return hashlib.sha256(path.encode()).hexdigest()[:16]


_engine = None


def get_engine():
    global _engine
    if _engine is None:
        db_path = DATA_DIR / "dashtrack.db"
        db_path.parent.mkdir(parents=True, exist_ok=True)
        _engine = create_engine(
            f"sqlite:///{db_path}",
            connect_args={"check_same_thread": False},
        )
        SQLModel.metadata.create_all(_engine)
        _migrate(_engine)
    return _engine


def _migrate(engine) -> None:
    """In-place schema migrations for databases created by older versions."""
    with engine.connect() as conn:
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(clip)"))]
        # v2: speeds stored in m/s instead of km/h
        if "max_speed_kmh" in cols:
            conn.execute(text("ALTER TABLE clip RENAME COLUMN max_speed_kmh TO max_speed_mps"))
            conn.execute(text("UPDATE clip SET max_speed_mps = max_speed_mps / 3.6"))
            conn.commit()
