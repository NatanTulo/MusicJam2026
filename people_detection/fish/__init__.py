"""Ryby: mapowanie osoba->ryba, symulacja zachowania, tymczasowy podglad."""
from .mapping import FishTarget, PersonToFishMapper
from .world import Fish, FishWorld

__all__ = ["FishTarget", "PersonToFishMapper", "Fish", "FishWorld"]
