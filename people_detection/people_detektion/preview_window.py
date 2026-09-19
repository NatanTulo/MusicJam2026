"""Drugie okno: surowy obraz z kamery + kogo system rozpoznaje.

Osobne okno, a nie panel w akwarium, bo:
  * glowne okno moze isc na projektor / pelny ekran, a to zostaje na monitorze,
  * podczas strojenia progow chce sie widziec oba obrazy naraz.

Kolor ramki = kolor ryby tej osoby (ta sama funkcja hue co w rendererze),
wiec od razu widac, ktora ryba nalezy do kogo.

Uzywa pygame._sdl2.video - drugie okno SDL obok tego z pygame.display.
"""
from __future__ import annotations

import colorsys
from typing import Callable, Optional, Tuple, Union

import numpy as np
import pygame
from pygame._sdl2 import video as sdl2

from .types import PeopleFrame

BG = (10, 12, 18)
INK = (228, 238, 248)
DIM = (128, 146, 166)


def person_color(person_id: int) -> Tuple[int, int, int]:
    """Ten sam wzor co w fish.render_pygame - osoba i jej ryba maja jeden kolor."""
    r, g, b = colorsys.hsv_to_rgb((person_id * 0.381966) % 1.0, 0.8, 1.0)
    return int(r * 255), int(g * 255), int(b * 255)


class CameraWindow:
    BAR_H = 26

    def __init__(
        self,
        width: int = 640,
        title: str = "Kamera - kogo widze",
        position: Optional[Tuple[int, int]] = None,
        y_band: Union[None, Tuple[float, float], Callable[[], Tuple[float, float]]] = None,
    ) -> None:
        self.req_width = width
        self.y_band = y_band          # pionowy zakres kadru uzywany przez mapowanie (albo funkcja go zwracajaca)
        self.visible = True
        self.alive = True

        self.window = sdl2.Window(title, size=(width, int(width * 3 / 4) + self.BAR_H))
        if position is not None:
            self.window.position = position
        self.renderer = sdl2.Renderer(self.window)
        self.texture: sdl2.Texture | None = None
        self._tex_size: Tuple[int, int] = (0, 0)

        self.font = pygame.font.SysFont("dejavusansmono,consolas,monospace", 13)
        self.small = pygame.font.SysFont("dejavusansmono,consolas,monospace", 11, bold=True)
        self._last_index = -1

    # -- rysowanie --------------------------------------------------------
    def update(self, frame: PeopleFrame) -> None:
        if not (self.alive and self.visible) or frame.preview is None:
            return
        # przerysowujemy tylko przy nowej klatce z detekcji - reszta to marnowanie GPU
        if frame.frame_index == self._last_index:
            return
        self._last_index = frame.frame_index

        canvas = self.build_canvas(frame)
        if canvas is None:
            return
        size = canvas.get_size()
        if tuple(self.window.size) != size:
            self.window.size = size
        self._present(canvas, size)

    def build_canvas(self, frame: PeopleFrame) -> Optional[pygame.Surface]:
        """Cala zawartosc okna jako zwykly Surface.

        Wydzielone z `update`, bo dzieki temu podglad da sie zrzucic do pliku
        i sprawdzic bez otwierania okna (odczyt z GPU po present() bywa pusty).
        """
        if frame.preview is None:
            return None
        img = frame.preview
        src_h, src_w = img.shape[:2]
        view_w = self.req_width
        view_h = int(src_h * view_w / src_w)

        canvas = pygame.Surface((view_w, view_h + self.BAR_H))
        canvas.fill(BG)
        cam = pygame.image.frombuffer(np.ascontiguousarray(img).tobytes(), (src_w, src_h), "RGB")
        if (src_w, src_h) != (view_w, view_h):
            cam = pygame.transform.smoothscale(cam, (view_w, view_h))
        canvas.blit(cam, (0, 0))

        self._draw_band(canvas, view_w, view_h)
        for person in frame.people:
            self._draw_person(canvas, person, view_w, view_h)
        self._draw_bar(canvas, frame, view_w, view_h)
        return canvas

    def _draw_band(self, canvas: pygame.Surface, w: int, h: int) -> None:
        """Przyciemnia pas kadru, ktorego mapowanie NIE uzywa do pozycji w pionie.

        Stopy ludzi powinny wypadac w jasnej czesci; jesli chodza po ciemnej,
        trzeba poprawic y_in w PersonToFishMapper.
        """
        if self.y_band is None:
            return
        band = self.y_band() if callable(self.y_band) else self.y_band   # mapper uczy sie zakresu w locie
        top, bottom = int(band[0] * h), int(band[1] * h)
        shade = pygame.Surface((w, h), pygame.SRCALPHA)
        if top > 0:
            shade.fill((0, 0, 0, 105), (0, 0, w, top))
        if bottom < h:
            shade.fill((0, 0, 0, 105), (0, bottom, w, h - bottom))
        canvas.blit(shade, (0, 0))
        if top > 16:
            tag = self.small.render(" poza mapowaniem ", True, (175, 190, 205))
            chip = pygame.Surface(tag.get_size(), pygame.SRCALPHA)
            chip.fill((0, 0, 0, 130))
            chip.blit(tag, (0, 0))
            canvas.blit(chip, (4, max(0, top - chip.get_height() - 3)))

    def _draw_person(self, canvas: pygame.Surface, person, w: int, h: int) -> None:
        col = person_color(person.id)
        x1, y1 = int(person.x1 * w), int(person.y1 * h)
        x2, y2 = int(person.x2 * w), int(person.y2 * h)
        rect = pygame.Rect(x1, y1, max(2, x2 - x1), max(2, y2 - y1))

        stale = person.time_since_seen > 0.25
        pygame.draw.rect(canvas, col, rect, 1 if stale else 2)

        if rect.width < 46:
            label = f"#{person.id}"
        else:
            label = f"#{person.id}  {person.score:.2f}" + ("  (zgubiony)" if stale else "")
        text = self.small.render(label, True, (10, 12, 18))
        chip = pygame.Surface((text.get_width() + 8, text.get_height() + 4))
        chip.fill(col)
        chip.blit(text, (4, 2))
        canvas.blit(chip, (rect.x, max(0, rect.y - chip.get_height())))

        # punkt zaczepienia: stopy - to ta wspolrzedna steruje pozycja ryby w pionie
        fx, fy = int(person.cx * w), int(person.foot_y * h)
        pygame.draw.line(canvas, col, (fx - 6, fy), (fx + 6, fy), 2)
        pygame.draw.line(canvas, col, (fx, fy - 4), (fx, fy + 4), 2)

        if person.speed > 0.02:
            pygame.draw.line(canvas, col, (person.cx * w, person.cy * h),
                             (person.cx * w + person.vx * w * 0.5, person.cy * h + person.vy * h * 0.5), 2)

    def _draw_bar(self, canvas: pygame.Surface, frame: PeopleFrame, w: int, h: int) -> None:
        pygame.draw.rect(canvas, (18, 22, 30), (0, h, w, self.BAR_H))
        left = self.font.render(f"osoby: {len(frame.people)}", True, INK if frame.people else DIM)
        canvas.blit(left, (8, h + 5))

        full = (f"det {frame.detect_fps:4.1f} fps / {frame.detect_ms:3.0f} ms   "
                f"kam {frame.camera_fps:4.1f} fps   lag {frame.latency_ms:3.0f} ms")
        short = f"det {frame.detect_fps:.0f} fps  lag {frame.latency_ms:.0f} ms"
        avail = w - left.get_width() - 24
        text = full if self.font.size(full)[0] <= avail else short
        font = self.font if self.font.size(text)[0] <= avail else self.small
        rt = font.render(text, True, DIM)
        canvas.blit(rt, (w - rt.get_width() - 8, h + (self.BAR_H - rt.get_height()) // 2))

    def _present(self, canvas: pygame.Surface, size: Tuple[int, int]) -> None:
        if self.texture is None or self._tex_size != size:
            self.texture = sdl2.Texture(self.renderer, size, streaming=True)
            self._tex_size = size
        self.texture.update(canvas)
        self.renderer.clear()
        self.texture.draw()
        self.renderer.present()

    # -- zdarzenia i cykl zycia -------------------------------------------
    def handle_event(self, event: pygame.event.Event) -> bool:
        """True = zdarzenie dotyczylo tego okna i zostalo obsluzone."""
        if not self.alive:
            return False
        if event.type == pygame.WINDOWCLOSE and getattr(event, "window", None) is self.window:
            self.close()
            return True
        return False

    def toggle(self) -> None:
        if not self.alive:
            return
        self.visible = not self.visible
        (self.window.show if self.visible else self.window.hide)()
        if self.visible:
            self._last_index = -1     # wymus przerysowanie po pokazaniu

    def close(self) -> None:
        if self.alive:
            self.window.destroy()
            self.alive = False
            self.visible = False
