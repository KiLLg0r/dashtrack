"""
DashTrack — Viofo provider (freeGPS / Novatek NT96660).

Filename convention:

    2026_0314_114143_025729F.MP4
    └─ date/time ─┘ └seq─┘ └ channel: F=front, R=rear, I=interior

Front, rear and interior files that share the 15-char timestamp prefix are the
channels of one recording (grouped by session_id — the rear/interior sequence
numbers differ from front's, so the prefix is what ties them together). GPS is
decoded from the freeGPS binary blocks embedded in the MP4 by ``extractor``.
"""

import re
from collections.abc import Iterator
from datetime import datetime
from pathlib import Path

from extractor import GPSPoint
from extractor import extract_points as extract_freegps
from providers.base import ClipMeta, Provider

# Viofo channel suffix → logical channel. 3-channel units (e.g. A229 Plus) add
# an interior (cabin) camera alongside the front and rear channels.
CHANNEL_BY_SUFFIX = {"F": "front", "R": "rear", "I": "interior"}

_FILENAME_RE = re.compile(r"(\d{4}_\d{4}_\d{6})_\d+([FRI])\.MP4", re.IGNORECASE)


class ViofoProvider(Provider):
    id = "viofo"
    name = "Viofo (freeGPS / Novatek)"

    def matches(self, path: Path) -> bool:
        return bool(_FILENAME_RE.match(path.name))

    def parse_meta(self, filename: str) -> ClipMeta:
        m = _FILENAME_RE.match(filename)
        if not m:
            return ClipMeta(session_id=None, recorded_at=None, channel="unknown")
        try:
            recorded_at = datetime.strptime(m.group(1), "%Y_%m%d_%H%M%S")
        except ValueError:
            recorded_at = None
        return ClipMeta(
            session_id=m.group(1),
            recorded_at=recorded_at,
            channel=CHANNEL_BY_SUFFIX.get(m.group(2).upper(), "unknown"),
        )

    def extract_points(self, path: Path) -> Iterator[GPSPoint]:
        return extract_freegps(str(path))
