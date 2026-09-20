"""SZEW: osoba (kamera) -> cel ryby.

>>> To jest miejsce do podmiany, gdy dojdzie docelowa logika ryb. <<<

Reszta systemu nie wie nic o rybach, a warstwa graficzna nie wie nic o
kamerze. Jedyny kontrakt to `FishTarget`.

Uklady wspolrzednych:
    kamera   x,y in [0,1], y=0 gora kadru       (people_detektion.types)
    podloga  u,v in [0,1], v=0 daleko, v=1 blisko kamery  -> FishTarget.u/.v
             To jest wejscie dla morza w przegladarce (web_visualization):
             tam u,v sa rozkladane na prostokat "lowiska" na mapie Baltyku.
    akwarium x,y in [0,1], y=0 gora akwarium    -> FishTarget.x/.y (podglad pygame)

Rozrzucenie po mapie - dwa mechanizmy:
  1. AutoRange: ludzie zwykle zajmuja tylko fragment kadru (w nagraniu testowym
     chodza po gornej polowie). Mapper uczy sie tego fragmentu z ostatnich
     detekcji i rozciaga go na cale lowisko.
  2. Rozsuniecie: kazda osoba dostaje staly, maly offset z ID (zloty kat),
     wiec dwie osoby stojace obok siebie nie daja ryb w jednym punkcie.
"""
from __future__ import annotations

import math
from collections import deque
from dataclasses import dataclass
from typing import Deque, Dict, Optional, Tuple

import numpy as np

from people_detektion.types import Person, PeopleFrame

GOLDEN_ANGLE = math.pi * (3.0 - math.sqrt(5.0))


@dataclass
class FishTarget:
    """Czego ryba ma sie trzymac w tej chwili."""

    person_id: int      # tozsamosc: ta sama osoba -> ta sama ryba
    u: float            # pozycja na podlodze [0,1] (po auto-zakresie i rozsunieciu)
    v: float
    x: float            # to samo w ukladzie akwarium pygame
    y: float
    scale: float        # 0.6 .. 1.8, z "glebi" (wielkosci osoby w kadrze)
    excitement: float   # 0..1, jak szybko osoba sie rusza -> jak zywo plywa ryba
    confidence: float
    fresh: bool         # False = osoba chwilowo zgubiona przez detektor


class AutoRange:
    """Zakres wartosci, ktory ludzie faktycznie zajmuja (percentyle z okna)."""

    def __init__(
        self,
        fallback: Tuple[float, float],
        window: int = 1500,
        quantiles: Tuple[float, float] = (3.0, 97.0),
        min_span: float = 0.12,
        min_samples: int = 60,
    ) -> None:
        self.fallback = fallback
        self.samples: Deque[float] = deque(maxlen=window)
        self.quantiles = quantiles
        self.min_span = min_span
        self.min_samples = min_samples
        self._range = fallback
        self._since_update = 0

    def add(self, value: float) -> None:
        self.samples.append(value)
        self._since_update += 1
        if self._since_update >= 20 and len(self.samples) >= self.min_samples:
            self._since_update = 0
            lo, hi = np.percentile(np.fromiter(self.samples, float), self.quantiles)
            if hi - lo < self.min_span:  # wszyscy w jednym miejscu - nie rozciagaj w nieskonczonosc
                mid = 0.5 * (lo + hi)
                lo, hi = mid - self.min_span / 2, mid + self.min_span / 2
            self._range = (float(lo), float(hi))

    @property
    def range(self) -> Tuple[float, float]:
        return self._range

    def normalize(self, value: float) -> float:
        lo, hi = self._range
        return min(1.0, max(0.0, (value - lo) / (hi - lo))) if hi > lo else 0.5


class PersonToFishMapper:
    def __init__(
        self,
        margin: float = 0.08,
        # staly zakres pionu kadru - uzywany, dopoki AutoRange nie zbierze probek
        y_in: tuple[float, float] = (0.25, 1.0),
        y_out: tuple[float, float] = (0.15, 0.9),
        height_near: float = 0.85,
        height_far: float = 0.12,
        scale_range: tuple[float, float] = (0.65, 1.8),
        excitement_speed: float = 0.28,   # predkosc osoby [1/s] uznana za "szybko"
        # 0.28 = przejscie przez pol kadru w ~3 s. Wyzej: ryba reaguje dopiero
        # na bieg; nizej: kazdy drobny ruch rozpedza rybe na maksa.
        use_foot: bool = True,
        auto_range: bool = True,
        scatter: float = 0.12,           # promien rozsuniecia osob (w jednostkach podlogi)
    ) -> None:
        self.margin = margin
        self.y_in = y_in
        self.y_out = y_out
        self.height_near = height_near
        self.height_far = height_far
        self.scale_range = scale_range
        self.excitement_speed = excitement_speed
        self.use_foot = use_foot
        self.auto_range = auto_range
        self.scatter = scatter
        self._x_range = AutoRange(fallback=(0.0, 1.0))
        self._y_range = AutoRange(fallback=y_in)

    @staticmethod
    def _remap(v: float, a0: float, a1: float, b0: float, b1: float) -> float:
        if a1 == a0:
            return b0
        t = min(1.0, max(0.0, (v - a0) / (a1 - a0)))
        return b0 + t * (b1 - b0)

    def current_y_band(self) -> Tuple[float, float]:
        """Pionowy wycinek kadru uzywany teraz do mapowania (podglad kamery go zaznacza)."""
        return self._y_range.range if self.auto_range else self.y_in

    def _floor_position(self, person: Person) -> Tuple[float, float]:
        src_y = person.foot_y if self.use_foot else person.cy
        if self.auto_range:
            u = self._x_range.normalize(person.cx)
            v = self._y_range.normalize(src_y)
        else:
            u = person.cx
            v = self._remap(src_y, self.y_in[0], self.y_in[1], 0.0, 1.0)

        if self.scatter > 0:
            ang = person.id * GOLDEN_ANGLE
            r = self.scatter * (0.4 + 0.6 * ((person.id * 0.618034) % 1.0))
            u += math.cos(ang) * r
            v += math.sin(ang) * r
        return min(1.0, max(0.0, u)), min(1.0, max(0.0, v))

    def map_person(self, person: Person) -> FishTarget:
        u, v = self._floor_position(person)

        # akwarium pygame: margines od krawedzi + zakres pionu y_out
        x = self.margin + u * (1.0 - 2.0 * self.margin)
        y = self.y_out[0] + v * (self.y_out[1] - self.y_out[0])

        # glebia sceny: wieksza sylwetka = blizej kamery = wieksza ryba
        scale = self._remap(
            person.height, self.height_far, self.height_near,
            self.scale_range[0], self.scale_range[1],
        )
        excitement = min(1.0, person.speed / self.excitement_speed)

        return FishTarget(
            person_id=person.id,
            u=u, v=v, x=x, y=y,
            scale=scale,
            excitement=excitement,
            confidence=person.score,
            fresh=person.time_since_seen < 0.25,
        )

    def observe(self, frame: PeopleFrame) -> None:
        """Karmi AutoRange tylko swiezymi detekcjami (nie ekstrapolacja zgubionych)."""
        if not self.auto_range:
            return
        for p in frame.people:
            if p.time_since_seen < 0.25:
                self._x_range.add(p.cx)
                self._y_range.add(p.foot_y if self.use_foot else p.cy)

    def map_frame(self, frame: PeopleFrame, observe: bool = True) -> Dict[int, FishTarget]:
        if observe:
            self.observe(frame)
        return {p.id: self.map_person(p) for p in frame.people}
