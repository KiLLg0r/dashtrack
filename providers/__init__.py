"""
DashTrack — provider registry.

Add a new dashcam brand by implementing ``providers.base.Provider`` and
appending an instance to ``PROVIDERS``. Detection tries each provider in order;
the Viofo provider is also the default fallback, so any MP4 whose name doesn't
match a known convention (e.g. a merged clip) is still probed for freeGPS data.
"""

from pathlib import Path

from providers.base import ClipMeta, Provider
from providers.viofo import ViofoProvider

# Registered providers, tried in order. Register new brands here.
PROVIDERS: list[Provider] = [ViofoProvider()]

# Fallback when no provider matches a file by name — preserves the "probe every
# MP4 for GPS" behavior and handles merged clips with non-standard names.
DEFAULT_PROVIDER: Provider = PROVIDERS[0]


def detect_provider(path: Path) -> Provider | None:
    """Return the first provider that recognizes the file, or None."""
    for provider in PROVIDERS:
        if provider.matches(path):
            return provider
    return None


def provider_for(path: Path) -> Provider:
    """Provider that owns the file, falling back to ``DEFAULT_PROVIDER``."""
    return detect_provider(path) or DEFAULT_PROVIDER


def get_provider(provider_id: str) -> Provider | None:
    """Look up a registered provider by its id."""
    return next((p for p in PROVIDERS if p.id == provider_id), None)


__all__ = [
    "ClipMeta",
    "Provider",
    "PROVIDERS",
    "DEFAULT_PROVIDER",
    "detect_provider",
    "provider_for",
    "get_provider",
]
