"""Symulacja ryb - stan i zachowanie, zero rysowania.

Rozdzial swiadomy: `world` mozna testowac bez okna, a docelowa grafika
(shadery / projekcja / cokolwiek) podepnie sie pod te same dane.

Swiat ma szerokosc `aspect` i wysokosc 1.0, zeby odleglosci byly izotropowe -
inaczej przy ekranie 16:9 ryby trzymalyby sie w elipsach zamiast w kolach.

Zachowania:
  * ryba-awatar (przypisana do osoby) - podaza za celem, "zrywa" gdy czlowiek
    przyspiesza, krazy w miejscu gdy detektor chwilowo zgubi czlowieka,
    a po jego odejsciu odplywa poza kadr i znika,
  * lawica tla - klasyczne boidy (separacja/dopasowanie/spojnosc) plus
    ciekawosc wobec ryb-awatarow i ucieczka, gdy awatar wpadnie w srodek.
"""
from __future__ import annotations

import math
import random
from dataclasses import dataclass, field
from typing import Dict, Iterable, List, Optional

from .mapping import FishTarget

BOUND = "bound"        # ryba nalezaca do wykrytej osoby
SEARCHING = "searching"  # osoba chwilowo zgubiona
LEAVING = "leaving"    # osoba wyszla - ryba odplywa i gasnie
AMBIENT = "ambient"    # ryba tla (lawica)


def _limit(vx: float, vy: float, maximum: float) -> tuple[float, float]:
    m = math.hypot(vx, vy)
    if m > maximum and m > 1e-9:
        k = maximum / m
        return vx * k, vy * k
    return vx, vy


@dataclass
class Fish:
    fid: int
    x: float
    y: float
    vx: float = 0.0
    vy: float = 0.0
    size: float = 1.0          # mnoznik wielkosci (z "glebi" osoby)
    hue: float = 0.5           # 0..1, kolor
    state: str = AMBIENT
    person_id: Optional[int] = None

    heading: float = 0.0       # radiany, wygladzone
    tail_phase: float = 0.0    # faza machniecia ogonem
    excitement: float = 0.0    # 0..1, wygladzone
    alpha: float = 1.0         # 0..1, do wygaszania przy odplywaniu
    wander: float = 0.0        # kat bladzenia
    age: float = 0.0
    lost_for: float = 0.0      # ile sekund bez swiezego celu
    target: Optional[FishTarget] = None
    trail: List[tuple[float, float]] = field(default_factory=list)

    @property
    def speed(self) -> float:
        return math.hypot(self.vx, self.vy)


class FishWorld:
    def __init__(
        self,
        aspect: float = 16 / 9,
        shoal_size: int = 26,
        seed: int | None = 7,
        # dynamika
        base_speed: float = 0.30,      # jednostki swiata / s (1.0 = wysokosc akwarium)
        max_force: float = 2.2,
        # progi czasowe
        search_grace: float = 1.2,     # jak dlugo ryba czeka na powrot osoby
        leave_time: float = 2.5,       # jak dlugo odplywa zanim zniknie
    ) -> None:
        self.aspect = aspect
        self.rng = random.Random(seed)
        self.base_speed = base_speed
        self.max_force = max_force
        self.search_grace = search_grace
        self.leave_time = leave_time

        self.fish: List[Fish] = []
        self.by_person: Dict[int, Fish] = {}
        self._next_id = 1
        self.time = 0.0

        for _ in range(shoal_size):
            self.fish.append(self._spawn_ambient())

    # -- tworzenie ryb --------------------------------------------------
    def _new_id(self) -> int:
        fid = self._next_id
        self._next_id += 1
        return fid

    def _spawn_ambient(self) -> Fish:
        r = self.rng
        angle = r.uniform(0, math.tau)
        return Fish(
            fid=self._new_id(),
            x=r.uniform(0.05, self.aspect - 0.05),
            y=r.uniform(0.1, 0.9),
            vx=math.cos(angle) * self.base_speed * 0.5,
            vy=math.sin(angle) * self.base_speed * 0.2,
            size=r.uniform(0.35, 0.55),
            hue=(0.45 + r.uniform(-0.08, 0.08)) % 1.0,
            state=AMBIENT,
            wander=angle,
            tail_phase=r.uniform(0, math.tau),
        )

    def _spawn_bound(self, target: FishTarget) -> Fish:
        # kolor deterministyczny z ID osoby - ta sama osoba zawsze dostaje ta sama rybe
        hue = ((target.person_id * 0.381966) % 1.0)
        wx, wy = target.x * self.aspect, target.y
        fish = Fish(
            fid=self._new_id(),
            x=wx, y=wy,
            size=target.scale,
            hue=hue,
            state=BOUND,
            person_id=target.person_id,
            target=target,
            tail_phase=self.rng.uniform(0, math.tau),
        )
        self.fish.append(fish)
        self.by_person[target.person_id] = fish
        return fish

    # -- glowny krok ----------------------------------------------------
    def update(self, targets: Dict[int, FishTarget], dt: float) -> None:
        dt = min(dt, 0.05)   # zabezpieczenie: po zacieciu nie chcemy skoku symulacji
        self.time += dt

        # 1. synchronizacja ryb-awatarow z lista osob
        for pid, target in targets.items():
            fish = self.by_person.get(pid)
            if fish is None:
                fish = self._spawn_bound(target)
            fish.target = target
            fish.size += min(1.0, dt * 3.0) * (target.scale - fish.size)  # plynna zmiana rozmiaru
            if target.fresh:
                fish.state = BOUND
                fish.lost_for = 0.0
            else:
                fish.lost_for += dt
                fish.state = SEARCHING

        for pid, fish in list(self.by_person.items()):
            if pid in targets:
                continue
            fish.lost_for += dt
            if fish.lost_for > self.search_grace:
                fish.state = LEAVING
                del self.by_person[pid]

        # 2. sily i integracja
        bound_fish = [f for f in self.fish if f.state in (BOUND, SEARCHING)]
        for fish in self.fish:
            ax, ay = self._steer(fish, bound_fish, dt)
            self._integrate(fish, ax, ay, dt)

        # 3. sprzatanie
        self.fish = [f for f in self.fish if not (f.state == LEAVING and f.alpha <= 0.01)]

    # -- sterowanie -----------------------------------------------------
    def _steer(self, fish: Fish, bound_fish: List[Fish], dt: float) -> tuple[float, float]:
        ax = ay = 0.0

        if fish.state in (BOUND, SEARCHING) and fish.target is not None:
            tx, ty = fish.target.x * self.aspect, fish.target.y
            if fish.state == SEARCHING:
                # osoba zgubiona: ryba krazy wokol ostatniej pozycji zamiast zamarzac
                r = 0.06 + 0.04 * math.sin(self.time * 0.7 + fish.fid)
                tx += math.cos(self.time * 1.6 + fish.fid) * r * self.aspect
                ty += math.sin(self.time * 1.6 + fish.fid) * r
            sx, sy = self._seek(fish, tx, ty, arrive_radius=0.10)
            ax += sx * 2.6
            ay += sy * 2.6

        elif fish.state == LEAVING:
            # najblizsza krawedz pozioma - ryba "wyplywa z kadru"
            edge_x = -0.25 if fish.x < self.aspect * 0.5 else self.aspect + 0.25
            sx, sy = self._seek(fish, edge_x, fish.y - 0.05)
            ax += sx * 1.8
            ay += sy * 1.8
            fish.alpha -= dt / self.leave_time

        else:  # AMBIENT - boidy
            sep, ali, coh = self._flock(fish)
            ax += sep[0] * 1.9 + ali[0] * 0.7 + coh[0] * 0.5
            ay += sep[1] * 1.9 + ali[1] * 0.7 + coh[1] * 0.5

            # ciekawosc / poploch wobec ryb-awatarow
            for other in bound_fish:
                dx, dy = other.x - fish.x, other.y - fish.y
                d = math.hypot(dx, dy)
                if d < 1e-6:
                    continue
                if d < 0.14:                      # za blisko - rozpierzchniecie
                    ax -= dx / d * (0.14 - d) * 16.0
                    ay -= dy / d * (0.14 - d) * 16.0
                elif d < 0.55:                    # w zasiegu - podplyniecie
                    ax += dx / d * 0.55
                    ay += dy / d * 0.55

            fish.wander += self.rng.uniform(-2.5, 2.5) * dt
            ax += math.cos(fish.wander) * 0.35
            ay += math.sin(fish.wander) * 0.35

        # separacja od wszystkich - ryby nie wchodza w siebie
        for other in self.fish:
            if other is fish:
                continue
            dx, dy = fish.x - other.x, fish.y - other.y
            d2 = dx * dx + dy * dy
            r = 0.045 * (fish.size + other.size)
            if 1e-9 < d2 < r * r:
                d = math.sqrt(d2)
                ax += dx / d * (r - d) * 9.0
                ay += dy / d * (r - d) * 9.0

        if fish.state != LEAVING:
            ax, ay = self._avoid_walls(fish, ax, ay)

        return _limit(ax, ay, self.max_force)

    def _seek(self, fish: Fish, tx: float, ty: float, arrive_radius: float = 0.0) -> tuple[float, float]:
        dx, dy = tx - fish.x, ty - fish.y
        d = math.hypot(dx, dy)
        if d < 1e-6:
            return 0.0, 0.0
        desired = self._max_speed(fish)
        if arrive_radius > 0 and d < arrive_radius:
            desired *= d / arrive_radius     # hamowanie przy celu zamiast drgania wokol niego
        return (dx / d * desired - fish.vx), (dy / d * desired - fish.vy)

    def _flock(self, fish: Fish):
        sep = [0.0, 0.0]
        ali = [0.0, 0.0]
        coh = [0.0, 0.0]
        n_ali = n_coh = 0
        for other in self.fish:
            if other is fish or other.state != AMBIENT:
                continue
            dx, dy = fish.x - other.x, fish.y - other.y
            d = math.hypot(dx, dy)
            if d < 1e-6:
                continue
            if d < 0.07:
                sep[0] += dx / d / d
                sep[1] += dy / d / d
            if d < 0.28:
                ali[0] += other.vx
                ali[1] += other.vy
                coh[0] += other.x
                coh[1] += other.y
                n_ali += 1
                n_coh += 1
        if n_ali:
            ali[0] = ali[0] / n_ali - fish.vx
            ali[1] = ali[1] / n_ali - fish.vy
        if n_coh:
            coh[0] = coh[0] / n_coh - fish.x
            coh[1] = coh[1] / n_coh - fish.y
        return sep, ali, coh

    def _avoid_walls(self, fish: Fish, ax: float, ay: float) -> tuple[float, float]:
        """Zawracanie od krawedzi akwarium.

        Sterujemy PREDKOSCIA, nie pozycja: w strefie przyscianowej ryba dostaje
        zadana predkosc skierowana do srodka. Wariant "sila od glebokości
        wejscia w sciane" byl za slaby wobec sil lawicy i ryby sie przyklejaly.
        """
        m = 0.13
        speed = self._max_speed(fish)
        dvx = dvy = 0.0
        if fish.x < m:
            dvx += (1.0 - fish.x / m) * speed
        elif fish.x > self.aspect - m:
            dvx -= (1.0 - (self.aspect - fish.x) / m) * speed
        if fish.y < m:
            dvy += (1.0 - fish.y / m) * speed
        elif fish.y > 1.0 - m:
            dvy -= (1.0 - (1.0 - fish.y) / m) * speed
        if dvx or dvy:
            ax += (dvx - fish.vx) * 5.0
            ay += (dvy - fish.vy) * 5.0
        return ax, ay

    def _max_speed(self, fish: Fish) -> float:
        if fish.state == AMBIENT:
            return self.base_speed * 0.75
        if fish.state == LEAVING:
            return self.base_speed * 1.6
        exc = fish.target.excitement if fish.target else 0.0
        return self.base_speed * (1.0 + 1.6 * exc)   # czlowiek biegnie -> ryba smiga

    def _integrate(self, fish: Fish, ax: float, ay: float, dt: float) -> None:
        fish.age += dt
        fish.vx += ax * dt
        fish.vy += ay * dt
        fish.vx, fish.vy = _limit(fish.vx, fish.vy, self._max_speed(fish))
        fish.x += fish.vx * dt
        fish.y += fish.vy * dt

        if fish.state != LEAVING:
            # twardy limit + wygaszenie skladowej predkosci w sciane,
            # inaczej ryba zostaje przypieta do krawedzi napierajac na nia
            if fish.x < 0.01:
                fish.x, fish.vx = 0.01, abs(fish.vx) * 0.3
            elif fish.x > self.aspect - 0.01:
                fish.x, fish.vx = self.aspect - 0.01, -abs(fish.vx) * 0.3
            if fish.y < 0.01:
                fish.y, fish.vy = 0.01, abs(fish.vy) * 0.3
            elif fish.y > 0.99:
                fish.y, fish.vy = 0.99, -abs(fish.vy) * 0.3

        # kierunek patrzenia: obrot do wektora predkosci po krotszej stronie kola
        if fish.speed > 1e-4:
            desired = math.atan2(fish.vy, fish.vx)
            diff = (desired - fish.heading + math.pi) % math.tau - math.pi
            fish.heading += diff * min(1.0, dt * 9.0)

        target_exc = fish.target.excitement if (fish.target and fish.state == BOUND) else 0.0
        fish.excitement += (target_exc - fish.excitement) * min(1.0, dt * 2.5)

        # ogon macha tym szybciej, im szybciej ryba plynie
        fish.tail_phase += dt * (6.0 + 22.0 * fish.speed / max(1e-6, self.base_speed) * 0.35)

        fish.trail.append((fish.x, fish.y))
        if len(fish.trail) > 14:
            fish.trail.pop(0)

    # -- podglad --------------------------------------------------------
    @property
    def bound_count(self) -> int:
        return sum(1 for f in self.fish if f.state in (BOUND, SEARCHING))
