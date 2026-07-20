"""
DashTrack — camera provider abstraction.

A *provider* is a dashcam brand / recording-format adapter. It knows how to
recognize its own files, parse channel + session metadata from a filename, and
extract embedded GPS points. Everything downstream — the SQLite index, the
library API and the web UI — is provider-agnostic, so supporting a new camera
brand means adding one Provider subclass (plus its GPS decoder) and registering
it in providers/__init__.py. No changes to the DB, API or frontend are required.

Currently only Viofo (freeGPS / Novatek NT96660) is implemented; see viofo.py.
"""

from abc import ABC, abstractmethod
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from extractor import GPSPoint


@dataclass
class ClipMeta:
    """Metadata a provider parses from a single video file's name.

    ``channel`` is a logical camera position: 'front' | 'rear' | 'interior' |
    'unknown'. ``session_id`` groups the files recorded together (the channels
    of one recording); ``recorded_at`` is the wall-clock start time if derivable.
    """

    session_id: str | None
    recorded_at: datetime | None
    channel: str = "unknown"


class Provider(ABC):
    """Adapter for one dashcam brand / recording format."""

    #: Stable identifier stored on each clip, e.g. 'viofo'.
    id: str = "base"
    #: Human-readable label for logs / UI.
    name: str = "Base"

    @abstractmethod
    def matches(self, path: Path) -> bool:
        """Whether this provider recognizes the given file (by name/probe)."""

    @abstractmethod
    def parse_meta(self, filename: str) -> ClipMeta:
        """Parse session / channel / timestamp from a filename."""

    @abstractmethod
    def extract_points(self, path: Path) -> Iterator[GPSPoint]:
        """Yield GPS points embedded in the file (may be empty)."""
