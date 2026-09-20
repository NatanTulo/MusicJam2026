"""Podglad kamery jako JPEG - to samo co okno `--preview`, tylko dla przegladarki.

Rysuje na malym podgladzie z pipeline'u (PeopleFrame.preview): ramka wokol
kazdej osoby w jej kolorze, #ID z pewnoscia, krzyzyk na stopach (ta wspolrzedna
steruje pozycja ryby w pionie), wektor predkosci i pasek ze statystykami.

Osobny modul od preview_window, bo tamten ciagnie pygame i drugie okno SDL -
tutaj wystarczy OpenCV, wiec dziala tez na maszynie bez ekranu (RPi po ssh).
"""
from __future__ import annotations

import colorsys
from typing import Callable, Optional, Sequence, Union

import cv2
import numpy as np

from .types import PeopleFrame

BAR_H = 22
YBand = Union[Sequence[float], Callable[[], Sequence[float]], None]


def person_color_bgr(person_id: int) -> tuple[int, int, int]:
    """Ten sam wzor hue co w preview_window i w rendererze ryb - jeden kolor na osobe."""
    r, g, b = colorsys.hsv_to_rgb((person_id * 0.381966) % 1.0, 0.8, 1.0)
    return int(b * 255), int(g * 255), int(r * 255)   # OpenCV trzyma BGR


def _shade_outside_band(img: np.ndarray, y_band: YBand) -> None:
    """Przyciemnia pas kadru, z ktorego mapowanie NIE czyta pozycji w pionie."""
    if y_band is None:
        return
    band = y_band() if callable(y_band) else y_band
    h, w = img.shape[:2]
    top, bottom = int(band[0] * h), int(band[1] * h)
    dark = np.zeros((h, w, 3), np.uint8)
    if top > 0:
        img[:top] = cv2.addWeighted(img[:top], 0.6, dark[:top], 0.4, 0)
    if bottom < h:
        img[bottom:] = cv2.addWeighted(img[bottom:], 0.6, dark[bottom:], 0.4, 0)


def _draw_person(img: np.ndarray, person) -> None:
    h, w = img.shape[:2]
    col = person_color_bgr(person.id)
    x1, y1 = int(person.x1 * w), int(person.y1 * h)
    x2, y2 = int(person.x2 * w), int(person.y2 * h)
    stale = person.time_since_seen > 0.25            # detektor chwilowo zgubil te osobe
    cv2.rectangle(img, (x1, y1), (x2, y2), col, 1 if stale else 2)

    label = f"#{person.id}" if x2 - x1 < 60 else f"#{person.id} {person.score:.2f}"
    if stale and x2 - x1 >= 60:
        label += " (zgubiony)"
    (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.4, 1)
    ty = max(th + 3, y1)
    cv2.rectangle(img, (x1, ty - th - 4), (x1 + tw + 6, ty), col, -1)
    cv2.putText(img, label, (x1 + 3, ty - 3), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (10, 12, 18), 1, cv2.LINE_AA)

    # punkt zaczepienia: stopy
    fx, fy = int(person.cx * w), int(person.foot_y * h)
    cv2.line(img, (fx - 6, fy), (fx + 6, fy), col, 2)
    cv2.line(img, (fx, fy - 4), (fx, fy + 4), col, 2)

    if person.speed > 0.02:
        cx, cy = int(person.cx * w), int(person.cy * h)
        cv2.arrowedLine(img, (cx, cy), (int(cx + person.vx * w * 0.5), int(cy + person.vy * h * 0.5)),
                        col, 2, tipLength=0.3)


def annotate(frame: PeopleFrame, y_band: YBand = None) -> Optional[np.ndarray]:
    """Obraz BGR z naniesiona detekcja albo None, gdy pipeline nie robi podgladu."""
    if frame.preview is None:
        return None
    img = cv2.cvtColor(frame.preview, cv2.COLOR_RGB2BGR)
    _shade_outside_band(img, y_band)
    for person in frame.people:
        _draw_person(img, person)

    h, w = img.shape[:2]
    bar = np.full((BAR_H, w, 3), (18, 22, 30), np.uint8)
    img = np.vstack([img, bar])
    stats = (f"osob: {len(frame.people)}   detekcja: {frame.detect_fps:.1f} fps   "
             f"kamera: {frame.camera_fps:.1f} fps   opoznienie: {frame.latency_ms:.0f} ms")
    cv2.putText(img, stats, (6, h + BAR_H - 7), cv2.FONT_HERSHEY_SIMPLEX, 0.36, (128, 146, 166), 1, cv2.LINE_AA)
    return img


def encode(frame: PeopleFrame, y_band: YBand = None, quality: int = 70) -> Optional[bytes]:
    """Gotowy JPEG do wyslania przegladarce."""
    img = annotate(frame, y_band)
    if img is None:
        return None
    ok, buf = cv2.imencode(".jpg", img, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
    return buf.tobytes() if ok else None
