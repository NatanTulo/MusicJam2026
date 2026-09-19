"""Kontrakt miedzy wizja komputerowa a warstwa 'rybek'.

To jedyny modul, ktory musi znac i pipeline detekcji, i wizualizacja.
Wszystkie wspolrzedne sa ZNORMALIZOWANE do [0, 1] wzgledem klatki kamery:
    x = 0 -> lewa krawedz, x = 1 -> prawa
    y = 0 -> gora,         y = 1 -> dol
Dzieki temu zmiana rozdzielczosci kamery (laptop 640x480 -> RPi5 1280x720)
nie zmienia niczego po stronie ryb.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np


@dataclass(frozen=True)
class Detection:
    """Pojedyncza surowa detekcja z modelu (jedna klatka, bez tozsamosci)."""

    x1: float
    y1: float
    x2: float
    y2: float
    score: float

    @property
    def cx(self) -> float:
        return 0.5 * (self.x1 + self.x2)

    @property
    def cy(self) -> float:
        return 0.5 * (self.y1 + self.y2)

    @property
    def w(self) -> float:
        return self.x2 - self.x1

    @property
    def h(self) -> float:
        return self.y2 - self.y1

    @property
    def area(self) -> float:
        return max(0.0, self.w) * max(0.0, self.h)


@dataclass
class Person:
    """Sledzona osoba - stabilne ID trwajace przez wiele klatek.

    To jest wejscie dla mapowania osoba -> ryba. Pole `id` jest kluczem:
    dopoki osoba jest w kadrze, jej ryba zostaje ta sama.
    """

    id: int
    x1: float
    y1: float
    x2: float
    y2: float

    cx: float          # srodek bboxa
    cy: float
    foot_y: float      # dolna krawedz bboxa - lepszy proxy "gdzie stoi"
    height: float      # wysokosc bboxa; wieksza = blizej kamery

    vx: float          # predkosc w jednostkach znormalizowanych / sekunde
    vy: float

    score: float
    age: float         # sekundy od pierwszego wykrycia
    time_since_seen: float  # sekundy od ostatniej realnej detekcji (0 = swieza)
    hits: int          # ile razy realnie wykryta

    @property
    def speed(self) -> float:
        return float(np.hypot(self.vx, self.vy))


@dataclass
class PeopleFrame:
    """Migawka stanu swiata ludzi - to konsumuje wizualizacja."""

    people: list[Person] = field(default_factory=list)
    frame_index: int = 0
    timestamp: float = 0.0          # time.monotonic() momentu zlapania klatki

    camera_fps: float = 0.0
    detect_fps: float = 0.0
    detect_ms: float = 0.0          # czas samej inferencji
    latency_ms: float = 0.0         # od zlapania klatki do gotowego wyniku

    frame_size: tuple[int, int] = (0, 0)   # (w, h) klatki z kamery
    preview: np.ndarray | None = None      # maly podglad RGB do panelu debug
