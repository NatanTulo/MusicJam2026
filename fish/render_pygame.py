"""TYMCZASOWA wizualizacja w pygame.

Sluzy do ogladania, czy detekcja + mapowanie + zachowanie dzialaja; docelowa
grafika ma to zastapic. Renderer czyta wylacznie `FishWorld` i `PeopleFrame` -
nie wplywa na symulacje, wiec da sie go wyrzucic bez ruszania reszty.

Klawisze:
    TAB   osobne okno z podgladem kamery
    P     ten sam podglad jako panel w rogu (gdy glowne okno jest na pelnym ekranie)
    H     HUD
    T     smugi za rybami
    F     pelny ekran
    ESC/Q wyjscie
"""
from __future__ import annotations

import colorsys
import math
import random
from typing import Optional, Sequence

import numpy as np
import pygame
import pygame.gfxdraw

from people_detektion.types import PeopleFrame
from .world import AMBIENT, BOUND, LEAVING, SEARCHING, Fish, FishWorld

DEEP = (6, 22, 44)
SHALLOW = (16, 74, 110)
INK = (232, 244, 252)


def hsv(h: float, s: float, v: float) -> tuple[int, int, int]:
    r, g, b = colorsys.hsv_to_rgb(h % 1.0, s, v)
    return int(r * 255), int(g * 255), int(b * 255)


class Aquarium:
    def __init__(self, width: int = 1280, height: int = 720, fullscreen: bool = False, fps: int = 60) -> None:
        pygame.init()
        pygame.display.set_caption("MusicJam2026 - ludzie jako ryby (podglad)")
        flags = pygame.FULLSCREEN | pygame.SCALED if fullscreen else pygame.RESIZABLE
        self.screen = pygame.display.set_mode((width, height), flags)
        self.width, self.height = self.screen.get_size()
        self.clock = pygame.time.Clock()
        self.target_fps = fps

        self.font = pygame.font.SysFont("dejavusansmono,consolas,monospace", 15)
        self.small = pygame.font.SysFont("dejavusansmono,consolas,monospace", 12)
        self.big = pygame.font.SysFont("dejavusans,arial", 20, bold=True)

        self.show_debug = False
        self.show_hud = True
        self.show_trails = True
        self.running = True
        self._fullscreen = fullscreen

        self.camera_window = None   # ustawiane przez app.py, jesli okno podgladu jest wlaczone
        self.rng = random.Random(3)
        self._glow_cache: dict[tuple, pygame.Surface] = {}
        self._build_static()
        self.plankton = [
            [self.rng.uniform(0, self.width), self.rng.uniform(0, self.height),
             self.rng.uniform(4, 14), self.rng.uniform(0.15, 0.5)]
            for _ in range(90)
        ]
        self.bubbles: list[list[float]] = []
        self.time = 0.0

    # -- tlo ------------------------------------------------------------
    def _build_static(self) -> None:
        """Gradient i smugi swiatla renderujemy raz - co klatke byloby drogo."""
        grad = pygame.Surface((1, self.height))
        for y in range(self.height):
            t = (y / max(1, self.height - 1)) ** 0.85
            grad.set_at((0, y), tuple(int(SHALLOW[i] + (DEEP[i] - SHALLOW[i]) * t) for i in range(3)))
        self.background = pygame.transform.scale(grad, (self.width, self.height))

        shafts = pygame.Surface((self.width, self.height), pygame.SRCALPHA)
        for i in range(7):
            x = self.width * (i + 0.5) / 7 + self.rng.uniform(-60, 60)
            w_top, w_bot = self.rng.uniform(30, 70), self.rng.uniform(90, 190)
            skew = self.rng.uniform(-0.25, 0.25) * self.height
            poly = [(x - w_top / 2, -10), (x + w_top / 2, -10),
                    (x + w_bot / 2 + skew, self.height), (x - w_bot / 2 + skew, self.height)]
            pygame.gfxdraw.filled_polygon(shafts, [(int(a), int(b)) for a, b in poly], (150, 220, 255, 11))
        self.shafts = shafts

    def _draw_background(self, dt: float) -> None:
        self.screen.blit(self.background, (0, 0))
        drift = math.sin(self.time * 0.16) * 26
        self.screen.blit(self.shafts, (drift, 0))

        for p in self.plankton:
            p[0] += math.sin(self.time * 0.4 + p[1] * 0.01) * 7 * dt
            p[1] -= p[3] * 9 * dt
            if p[1] < -5:
                p[1] = self.height + 5
                p[0] = self.rng.uniform(0, self.width)
            a = int(60 * p[3] + 25)
            pygame.gfxdraw.filled_circle(self.screen, int(p[0]), int(p[1]), max(1, int(p[2] * 0.14)), (180, 230, 255, a))

        if self.rng.random() < dt * 2.2:
            self.bubbles.append([self.rng.uniform(0, self.width), self.height + 5,
                                 self.rng.uniform(2, 6), self.rng.uniform(40, 95)])
        for b in self.bubbles:
            b[1] -= b[3] * dt
            b[0] += math.sin(self.time * 2.5 + b[1] * 0.02) * 12 * dt
            bx, by, br = int(b[0]), int(b[1]), int(b[2])
            pygame.gfxdraw.filled_circle(self.screen, bx, by, br, (150, 210, 245, 45))
            pygame.gfxdraw.aacircle(self.screen, bx, by, br, (210, 245, 255, 130))
        self.bubbles = [b for b in self.bubbles if b[1] > -10]

    # -- ryby -----------------------------------------------------------
    def _glow(self, hue: float, radius: int) -> pygame.Surface:
        """Cache poswiat - tworzenie Surface co klatke dla kazdej ryby bylo kosztowne."""
        key = (round(hue, 2), radius)
        surf = self._glow_cache.get(key)
        if surf is None:
            surf = pygame.Surface((radius * 2, radius * 2), pygame.SRCALPHA)
            r, g, b = hsv(hue, 0.7, 1.0)
            for i in range(6, 0, -1):
                rr = int(radius * i / 6)
                k = (1.0 - i / 6.0) ** 2
                pygame.gfxdraw.filled_circle(surf, radius, radius, rr,
                                             (int(r * k * 0.30), int(g * k * 0.30), int(b * k * 0.30), 255))
            self._glow_cache[key] = surf
        return surf

    def _fish_polygon(self, fish: Fish, sx: int, sy: int, length: float):
        """Cialo z falujacego kregoslupa: amplituda rosnie ku ogonowi (t^2)."""
        half = length * 0.5
        # ryba plynaca w lewo musi byc odbita, inaczej po obrocie plynie brzuchem do gory
        flip = -1.0 if math.cos(fish.heading) < 0 else 1.0
        cos_h, sin_h = math.cos(fish.heading), math.sin(fish.heading)

        amp = length * 0.12 * (0.5 + 1.0 * fish.excitement)
        spine = []
        for i in range(9):
            t = i / 8.0
            spine.append((half - t * length, math.sin(fish.tail_phase - t * 3.1) * amp * (t * t)))

        def to_screen(bx: float, by: float) -> tuple[int, int]:
            by *= flip
            return (int(sx + bx * cos_h - by * sin_h), int(sy + bx * sin_h + by * cos_h))

        upper, lower, mid = [], [], []
        for i, (bx, by) in enumerate(spine):
            t = i / 8.0
            # profil kropli: zwezony pysk, najszerzej ok. 1/4 dlugosci, cienka nasada ogona
            w = length * 0.26 * math.sin(math.pi * t ** 0.45) * (1.0 - 0.55 * t)
            upper.append(to_screen(bx, by - w))
            lower.append(to_screen(bx, by + w))
            mid.append(to_screen(bx, by))
        body = upper + lower[::-1]
        back = upper + mid[::-1]

        # pletwa ogonowa: dwa platy rozchylone od nasady
        tx, ty = spine[-1]
        lobe = length * 0.26
        tail = [to_screen(tx + length * 0.04, ty),
                to_screen(tx - length * 0.20, ty - lobe),
                to_screen(tx - length * 0.10, ty),
                to_screen(tx - length * 0.20, ty + lobe)]

        # pletwa grzbietowa nad srodkiem ciala
        bx, by = spine[3]
        dorsal = [to_screen(bx + length * 0.10, by - length * 0.13),
                  to_screen(bx - length * 0.02, by - length * 0.30),
                  to_screen(bx - length * 0.14, by - length * 0.12)]

        eye = to_screen(half * 0.66, -length * 0.06)
        return body, back, tail, dorsal, eye

    def _draw_fish(self, fish: Fish, sx: int, sy: int) -> None:
        length = fish.size * 0.105 * self.height
        alpha = int(255 * max(0.0, min(1.0, fish.alpha)))
        if alpha <= 2:
            return

        bound = fish.state in (BOUND, SEARCHING, LEAVING) and fish.person_id is not None
        sat = 0.75 if bound else 0.45
        val = 0.95 if bound else 0.62
        if fish.state == SEARCHING:
            val *= 0.75 + 0.25 * math.sin(self.time * 7.0)   # miganie = "gdzie sie podzial czlowiek"
        body_col = hsv(fish.hue, sat, val) + (alpha,)
        fin_col = hsv(fish.hue, min(1.0, sat + 0.18), val * 0.78) + (alpha,)

        if self.show_trails and bound and len(fish.trail) > 2:
            for i in range(1, len(fish.trail)):
                a = int(alpha * 0.28 * i / len(fish.trail))
                x0, y0 = self._to_screen(*fish.trail[i - 1])
                x1, y1 = self._to_screen(*fish.trail[i])
                pygame.draw.line(self.screen, hsv(fish.hue, 0.6, 0.9) + (a,), (x0, y0), (x1, y1), max(1, int(length * 0.05)))

        body, back, tail, dorsal, eye = self._fish_polygon(fish, sx, sy, length)

        if bound:  # poswiata odrozniajaca ryby "ludzkie" od lawicy tla
            glow_r = int(length * 0.9)
            surf = self._glow(fish.hue, glow_r)
            surf.set_alpha(int(190 * fish.alpha))
            self.screen.blit(surf, (sx - glow_r, sy - glow_r), special_flags=pygame.BLEND_RGB_ADD)

        pygame.gfxdraw.filled_polygon(self.screen, tail, fin_col)
        pygame.gfxdraw.aapolygon(self.screen, tail, fin_col)
        if dorsal:
            pygame.gfxdraw.filled_polygon(self.screen, dorsal, fin_col)
            pygame.gfxdraw.aapolygon(self.screen, dorsal, fin_col)
        pygame.gfxdraw.filled_polygon(self.screen, body, body_col)
        pygame.gfxdraw.aapolygon(self.screen, body, body_col)
        # ciemniejszy grzbiet: polowa ciala nad kregoslupem - daje bryle zamiast plaskiej lopatki
        back_col = hsv(fish.hue, min(1.0, sat + 0.15), val * 0.66) + (alpha,)
        pygame.gfxdraw.filled_polygon(self.screen, back, back_col)

        r = max(1, int(length * 0.045))
        pygame.gfxdraw.filled_circle(self.screen, eye[0], eye[1], r + 1, (12, 18, 26, alpha))
        pygame.gfxdraw.filled_circle(self.screen, eye[0], eye[1], max(1, r - 1), (245, 250, 255, alpha))

        if bound and self.show_hud and fish.person_id is not None:
            tag = self.small.render(f"#{fish.person_id}", True, hsv(fish.hue, 0.35, 1.0))
            tag.set_alpha(alpha)
            self.screen.blit(tag, (sx - tag.get_width() // 2, sy - int(length * 0.75)))

    def _to_screen(self, wx: float, wy: float) -> tuple[int, int]:
        return int(wx * self.height), int(wy * self.height)

    # -- HUD i debug ------------------------------------------------------
    def _draw_hud(self, world: FishWorld, frame: PeopleFrame, detector_name: str) -> None:
        lines = [
            f"osoby: {len(frame.people):<3} ryby: {len(world.fish):<3} (awatary: {world.bound_count})",
            f"render: {self.clock.get_fps():5.1f} fps   detekcja: {frame.detect_fps:4.1f} fps ({frame.detect_ms:.0f} ms)",
            f"kamera: {frame.camera_fps:4.1f} fps {frame.frame_size[0]}x{frame.frame_size[1]}   lag: {frame.latency_ms:.0f} ms",
            f"model: {detector_name}",
        ]
        pad = 10
        w = max(self.font.size(s)[0] for s in lines) + pad * 2
        h = len(lines) * 19 + pad * 2
        panel = pygame.Surface((w, h), pygame.SRCALPHA)
        panel.fill((4, 14, 28, 155))
        self.screen.blit(panel, (12, 12))
        for i, s in enumerate(lines):
            self.screen.blit(self.font.render(s, True, INK), (12 + pad, 12 + pad + i * 19))

        hint = self.small.render("TAB okno kamery | P panel | H hud | T smugi | F pelny ekran | ESC wyjscie", True, (150, 180, 205))
        self.screen.blit(hint, (12, self.height - 22))

    def _draw_debug(self, frame: PeopleFrame) -> None:
        if frame.preview is None:
            return
        img = frame.preview
        ph, pw = img.shape[:2]
        surf = pygame.image.frombuffer(np.ascontiguousarray(img).tobytes(), (pw, ph), "RGB")
        x0, y0 = self.width - pw - 12, 12
        self.screen.blit(surf, (x0, y0))
        pygame.draw.rect(self.screen, (120, 200, 255), (x0 - 1, y0 - 1, pw + 2, ph + 2), 1)

        for p in frame.people:
            col = hsv((p.id * 0.381966) % 1.0, 0.8, 1.0)
            rect = pygame.Rect(x0 + p.x1 * pw, y0 + p.y1 * ph, (p.x2 - p.x1) * pw, (p.y2 - p.y1) * ph)
            pygame.draw.rect(self.screen, col, rect, 2)
            label = self.small.render(f"{p.id} {p.score:.2f}", True, col)
            self.screen.blit(label, (rect.x, max(y0, rect.y - 13)))
            # wektor predkosci - widac czy tracker nie gubi tozsamosci
            cx, cy = x0 + p.cx * pw, y0 + p.cy * ph
            pygame.draw.line(self.screen, col, (cx, cy), (cx + p.vx * pw * 0.6, cy + p.vy * ph * 0.6), 2)

    # -- petla ------------------------------------------------------------
    def toggle_camera_window(self) -> None:
        if self.camera_window is not None and self.camera_window.alive:
            self.camera_window.toggle()
        else:
            self.show_debug = not self.show_debug   # brak osobnego okna - zostaje panel

    def handle_events(self, listeners: "Sequence" = ()) -> None:
        """`listeners` to obiekty z handle_event() - np. osobne okno kamery.

        Kolejka zdarzen SDL jest wspolna dla wszystkich okien, wiec pompujemy ja
        w jednym miejscu i rozdajemy zdarzenia dalej.
        """
        for event in pygame.event.get():
            if any(listener.handle_event(event) for listener in listeners):
                continue
            if event.type == pygame.QUIT:
                self.running = False
            elif event.type == pygame.VIDEORESIZE and not self._fullscreen:
                self.width, self.height = event.w, event.h
                self._build_static()
            elif event.type == pygame.KEYDOWN:
                if event.key in (pygame.K_ESCAPE, pygame.K_q):
                    self.running = False
                elif event.key == pygame.K_TAB:
                    self.toggle_camera_window()
                elif event.key == pygame.K_p:
                    self.show_debug = not self.show_debug
                elif event.key == pygame.K_h:
                    self.show_hud = not self.show_hud
                elif event.key == pygame.K_t:
                    self.show_trails = not self.show_trails
                elif event.key == pygame.K_f:
                    self._fullscreen = not self._fullscreen
                    flags = pygame.FULLSCREEN | pygame.SCALED if self._fullscreen else pygame.RESIZABLE
                    self.screen = pygame.display.set_mode((self.width, self.height), flags)
                    self.width, self.height = self.screen.get_size()
                    self._build_static()

    def draw(self, world: FishWorld, frame: PeopleFrame, detector_name: str, dt: float) -> None:
        self.time += dt
        self._draw_background(dt)

        # mniejsze/dalsze ryby najpierw - daje prosta glebie sceny
        for fish in sorted(world.fish, key=lambda f: f.size):
            sx, sy = self._to_screen(fish.x, fish.y)
            self._draw_fish(fish, sx, sy)

        if self.show_debug:
            self._draw_debug(frame)
        if self.show_hud:
            self._draw_hud(world, frame, detector_name)

        pygame.display.flip()

    def tick(self) -> float:
        return self.clock.tick(self.target_fps) / 1000.0

    @property
    def aspect(self) -> float:
        return self.width / self.height

    def close(self) -> None:
        pygame.quit()
