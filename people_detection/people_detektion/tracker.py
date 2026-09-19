"""Sledzenie osob miedzy klatkami - nadaje stabilne ID.

Dlaczego to jest potrzebne: detektor nie ma pamieci, kazda klatka to nowy
zestaw prostokatow w losowej kolejnosci. Bez trackera ryba przypisana do
czlowieka zmienialaby sie 10 razy na sekunde.

Algorytm: zachlanne dopasowanie po IoU + odleglosci srodkow, wygladzanie
pozycji (EMA) i estymacja predkosci. Swiadomie bez Kalmana/re-ID:
  * dla <20 osob w kadrze roznica jakosci jest zaniedbywalna,
  * koszt CPU ~0, co ma znaczenie na RPi5,
  * zero dodatkowych zaleznosci.
Track przetrwa krotkie zgubienie (max_age) - czlowiek zasloniety przez
drugiego nie gubi swojej ryby.
"""
from __future__ import annotations

import itertools
from dataclasses import dataclass, field
from typing import List, Sequence

import numpy as np

from .types import Detection, Person


def iou(a: Detection, b: "Track") -> float:
    ix1, iy1 = max(a.x1, b.x1), max(a.y1, b.y1)
    ix2, iy2 = min(a.x2, b.x2), min(a.y2, b.y2)
    iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
    inter = iw * ih
    if inter <= 0.0:
        return 0.0
    union = a.area + (b.x2 - b.x1) * (b.y2 - b.y1) - inter
    return inter / union if union > 0 else 0.0


@dataclass
class Track:
    id: int
    x1: float
    y1: float
    x2: float
    y2: float
    score: float
    first_seen: float
    last_seen: float
    hits: int = 1
    vx: float = 0.0
    vy: float = 0.0
    confirmed: bool = False
    _last_update: float = 0.0

    @property
    def cx(self) -> float:
        return 0.5 * (self.x1 + self.x2)

    @property
    def cy(self) -> float:
        return 0.5 * (self.y1 + self.y2)

    @property
    def height(self) -> float:
        return self.y2 - self.y1

    def update(self, det: Detection, now: float, smoothing: float) -> None:
        dt = max(1e-3, now - self._last_update)
        prev_cx, prev_cy = self.cx, self.cy

        a = smoothing  # waga nowej detekcji; nizsza = gladziej, ale wieksze opoznienie
        self.x1 += a * (det.x1 - self.x1)
        self.y1 += a * (det.y1 - self.y1)
        self.x2 += a * (det.x2 - self.x2)
        self.y2 += a * (det.y2 - self.y2)
        self.score = det.score

        inst_vx = (self.cx - prev_cx) / dt
        inst_vy = (self.cy - prev_cy) / dt
        self.vx += 0.35 * (inst_vx - self.vx)
        self.vy += 0.35 * (inst_vy - self.vy)

        self.hits += 1
        self.last_seen = now
        self._last_update = now


class PeopleTracker:
    def __init__(
        self,
        iou_threshold: float = 0.25,
        max_distance: float = 0.12,
        max_age: float = 1.0,
        min_hits: int = 3,
        smoothing: float = 0.55,
    ) -> None:
        self.iou_threshold = iou_threshold
        self.max_distance = max_distance   # znormalizowany dystans srodkow - ratuje szybki ruch przy 0 IoU
        self.max_age = max_age             # ile sekund track zyje bez detekcji
        self.min_hits = min_hits           # ile trafien zanim track zostanie pokazany
        self.smoothing = smoothing
        self.tracks: List[Track] = []
        self._ids = itertools.count(1)

    def update(self, detections: Sequence[Detection], now: float) -> List[Person]:
        # 1. koszt dopasowania: IoU, a gdy zerowe - bliskosc srodkow
        pairs = []
        for di, det in enumerate(detections):
            for ti, trk in enumerate(self.tracks):
                overlap = iou(det, trk)
                dist = float(np.hypot(det.cx - trk.cx, det.cy - trk.cy))
                if overlap >= self.iou_threshold:
                    pairs.append((overlap + 1.0, di, ti))       # +1 => IoU zawsze wygrywa z dystansem
                elif dist <= self.max_distance:
                    pairs.append((1.0 - dist / self.max_distance, di, ti))

        # 2. zachlannie od najlepszego dopasowania
        pairs.sort(reverse=True)
        used_det: set[int] = set()
        used_trk: set[int] = set()
        for _, di, ti in pairs:
            if di in used_det or ti in used_trk:
                continue
            self.tracks[ti].update(detections[di], now, self.smoothing)
            used_det.add(di)
            used_trk.add(ti)

        # 3. nowe osoby
        for di, det in enumerate(detections):
            if di in used_det:
                continue
            self.tracks.append(
                Track(
                    id=next(self._ids),
                    x1=det.x1, y1=det.y1, x2=det.x2, y2=det.y2,
                    score=det.score,
                    first_seen=now, last_seen=now, _last_update=now,
                )
            )

        # 4. usuniecie wygaslych
        self.tracks = [t for t in self.tracks if now - t.last_seen <= self.max_age]

        # 5. eksport potwierdzonych
        people: List[Person] = []
        for t in self.tracks:
            if t.hits >= self.min_hits:
                t.confirmed = True
            if not t.confirmed:
                continue
            people.append(
                Person(
                    id=t.id,
                    x1=t.x1, y1=t.y1, x2=t.x2, y2=t.y2,
                    cx=t.cx, cy=t.cy,
                    foot_y=t.y2,
                    height=t.height,
                    vx=t.vx, vy=t.vy,
                    score=t.score,
                    age=now - t.first_seen,
                    time_since_seen=now - t.last_seen,
                    hits=t.hits,
                )
            )
        return people
