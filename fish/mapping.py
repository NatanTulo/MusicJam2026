"""SZEW: osoba (kamera) -> cel ryby (akwarium).

>>> To jest miejsce do podmiany, gdy dojdzie docelowa logika ryb. <<<

Reszta systemu nie wie nic o rybach, a warstwa graficzna nie wie nic o
kamerze. Jedyny kontrakt to `FishTarget`. Zeby zmienic zachowanie mapowania
(inna geometria sceny, kalibracja projektora, sonifikacja...) wystarczy
podmienic ta klase - pipeline i renderer zostaja bez zmian.

Uklady wspolrzednych:
    kamera   x,y in [0,1], y=0 gora kadru       (people_detektion.types)
    akwarium x,y in [0,1], y=0 gora akwarium    (fish.world)
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List

from people_detektion.types import Person, PeopleFrame


@dataclass
class FishTarget:
    """Czego ryba ma sie trzymac w tej chwili."""

    person_id: int      # tozsamosc: ta sama osoba -> ta sama ryba
    x: float            # cel w akwarium [0,1]
    y: float
    scale: float        # 0.6 .. 1.8, z "glebi" (wielkosci osoby w kadrze)
    excitement: float   # 0..1, jak szybko osoba sie rusza -> jak zywo plywa ryba
    confidence: float
    fresh: bool         # False = osoba chwilowo zgubiona przez detektor


class PersonToFishMapper:
    def __init__(
        self,
        margin: float = 0.08,
        # z jakiego zakresu pionu kadru korzystamy (stopy ludzi rzadko sa u gory)
        y_in: tuple[float, float] = (0.25, 1.0),
        y_out: tuple[float, float] = (0.15, 0.9),
        # wysokosc bboxa odpowiadajaca "blisko" i "daleko" - podstawa skali ryby
        height_near: float = 0.85,
        height_far: float = 0.12,
        scale_range: tuple[float, float] = (0.65, 1.8),
        excitement_speed: float = 0.45,   # predkosc osoby [1/s] uznana za "szybko"
        use_foot: bool = True,
    ) -> None:
        self.margin = margin
        self.y_in = y_in
        self.y_out = y_out
        self.height_near = height_near
        self.height_far = height_far
        self.scale_range = scale_range
        self.excitement_speed = excitement_speed
        self.use_foot = use_foot

    @staticmethod
    def _remap(v: float, a0: float, a1: float, b0: float, b1: float) -> float:
        if a1 == a0:
            return b0
        t = (v - a0) / (a1 - a0)
        t = min(1.0, max(0.0, t))
        return b0 + t * (b1 - b0)

    def map_person(self, person: Person) -> FishTarget:
        # poziomo: srodek sylwetki, sciagniety o margines zeby ryba nie kleila sie do krawedzi
        x = self.margin + person.cx * (1.0 - 2.0 * self.margin)

        # pionowo: stopy niosa wiecej informacji o pozycji w przestrzeni niz srodek bboxa
        src_y = person.foot_y if self.use_foot else person.cy
        y = self._remap(src_y, self.y_in[0], self.y_in[1], self.y_out[0], self.y_out[1])

        # glebia: wieksza sylwetka = blizej kamery = wieksza ryba
        scale = self._remap(
            person.height, self.height_far, self.height_near,
            self.scale_range[0], self.scale_range[1],
        )

        excitement = min(1.0, person.speed / self.excitement_speed)

        return FishTarget(
            person_id=person.id,
            x=min(1.0, max(0.0, x)),
            y=min(1.0, max(0.0, y)),
            scale=scale,
            excitement=excitement,
            confidence=person.score,
            fresh=person.time_since_seen < 0.25,
        )

    def map_frame(self, frame: PeopleFrame) -> Dict[int, FishTarget]:
        return {p.id: self.map_person(p) for p in frame.people}
