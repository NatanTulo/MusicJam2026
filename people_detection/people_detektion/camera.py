"""Zrodlo klatek - watek grabbera, ktory zawsze oddaje NAJNOWSZA klatke.

Powod: detekcja na CPU jest wolniejsza niz kamera. Bez osobnego watku
cv2.VideoCapture.read() zwraca klatki z bufora sterownika i narasta
opoznienie (czlowiek rusza sie na ekranie 1-2 s po fakcie).
Tu grabber mieli w kolko, a konsument bierze tylko ostatnia klatke.

Backendy:
    OpenCVCamera  - webcam / plik wideo / strumien (laptop, USB cam na RPi)
    PiCamera2     - natywna kamera CSI na Raspberry Pi 5 (libcamera)
"""
from __future__ import annotations

import threading
import time
from typing import Optional, Tuple

import cv2
import numpy as np


class FrameSource:
    """Wspolny interfejs zrodla klatek."""

    def start(self) -> "FrameSource":
        raise NotImplementedError

    def read(self) -> Tuple[Optional[np.ndarray], float]:
        """Zwraca (klatka BGR albo None, timestamp monotonic)."""
        raise NotImplementedError

    def stop(self) -> None:
        raise NotImplementedError

    @property
    def fps(self) -> float:
        return 0.0


class OpenCVCamera(FrameSource):
    def __init__(
        self,
        source: int | str = 0,
        width: int = 640,
        height: int = 480,
        fps: int = 30,
        flip: bool = False,
    ) -> None:
        self.source = source
        self.width = width
        self.height = height
        self.target_fps = fps
        self.flip = flip

        self._cap: cv2.VideoCapture | None = None
        self._frame: np.ndarray | None = None
        self._stamp: float = 0.0
        self._lock = threading.Lock()
        self._thread: threading.Thread | None = None
        self._running = False
        self._fps = 0.0
        self._is_file = isinstance(source, str) and not str(source).isdigit()

    def start(self) -> "OpenCVCamera":
        src = int(self.source) if str(self.source).isdigit() else self.source
        cap = cv2.VideoCapture(src)
        if not cap.isOpened():
            raise RuntimeError(f"Nie moge otworzyc zrodla wideo: {self.source!r}")

        if not self._is_file:
            # MJPG zamiast YUYV - bez tego wiekszosc kamer USB tnie do 5-10 fps w 720p
            cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
            cap.set(cv2.CAP_PROP_FRAME_WIDTH, self.width)
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self.height)
            cap.set(cv2.CAP_PROP_FPS, self.target_fps)
            try:
                cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            except cv2.error:
                pass

        self._cap = cap
        self._running = True
        self._thread = threading.Thread(target=self._loop, name="camera", daemon=True)
        self._thread.start()

        # czekamy na pierwsza klatke, zeby reszta apki znala rozmiar
        deadline = time.monotonic() + 5.0
        while time.monotonic() < deadline:
            with self._lock:
                if self._frame is not None:
                    return self
            time.sleep(0.01)
        raise RuntimeError("Kamera nie oddala zadnej klatki w 5 s")

    def _loop(self) -> None:
        assert self._cap is not None
        last = time.monotonic()
        ema = 0.0
        frame_budget = 1.0 / max(1, self.target_fps)
        while self._running:
            ok, frame = self._cap.read()
            if not ok:
                if self._is_file:  # zapetlamy plik wideo
                    self._cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                    continue
                time.sleep(0.05)
                continue

            if self.flip:
                frame = cv2.flip(frame, 1)

            now = time.monotonic()
            with self._lock:
                self._frame = frame
                self._stamp = now

            dt = now - last
            last = now
            if dt > 0:
                ema = 0.9 * ema + 0.1 * (1.0 / dt) if ema else 1.0 / dt
                self._fps = ema
            if self._is_file:
                # plik czytamy w tempie odtwarzania, nie tak szybko jak sie da
                time.sleep(max(0.0, frame_budget - (time.monotonic() - now)))

    def read(self) -> Tuple[Optional[np.ndarray], float]:
        with self._lock:
            if self._frame is None:
                return None, 0.0
            return self._frame, self._stamp

    def stop(self) -> None:
        self._running = False
        if self._thread is not None:
            self._thread.join(timeout=1.0)
        if self._cap is not None:
            self._cap.release()

    @property
    def fps(self) -> float:
        return self._fps


class PiCamera2Source(FrameSource):
    """Kamera CSI na RPi5 przez libcamera/picamera2.

    Instalacja na RPi:  sudo apt install -y python3-picamera2
    Uzycie:             python app.py --camera picam
    """

    def __init__(self, width: int = 640, height: int = 480, fps: int = 30, flip: bool = False) -> None:
        self.width, self.height, self.target_fps, self.flip = width, height, fps, flip
        self._picam = None
        self._fps = 0.0
        self._last = 0.0

    def start(self) -> "PiCamera2Source":
        try:
            from picamera2 import Picamera2  # type: ignore
        except ImportError as exc:  # pragma: no cover - tylko na RPi
            raise RuntimeError(
                "picamera2 niedostepne. Na RPi5: sudo apt install -y python3-picamera2, "
                "albo uzyj --camera 0 dla kamery USB."
            ) from exc

        picam = Picamera2()
        cfg = picam.create_video_configuration(
            main={"size": (self.width, self.height), "format": "RGB888"},
            controls={"FrameDurationLimits": (int(1e6 / self.target_fps),) * 2},
            buffer_count=4,
        )
        picam.configure(cfg)
        picam.start()
        self._picam = picam
        time.sleep(0.5)  # auto-ekspozycja
        return self

    def read(self) -> Tuple[Optional[np.ndarray], float]:
        if self._picam is None:
            return None, 0.0
        frame = self._picam.capture_array()  # RGB888 == BGR w pamieci dla OpenCV
        if self.flip:
            frame = cv2.flip(frame, 1)
        now = time.monotonic()
        if self._last:
            dt = now - self._last
            if dt > 0:
                self._fps = 0.9 * self._fps + 0.1 / dt if self._fps else 1.0 / dt
        self._last = now
        return frame, now

    def stop(self) -> None:
        if self._picam is not None:
            self._picam.stop()

    @property
    def fps(self) -> float:
        return self._fps


def open_camera(spec: str | int, width: int, height: int, fps: int, flip: bool) -> FrameSource:
    """spec: '0' / '/dev/video0' / 'picam' / sciezka do pliku .mp4"""
    if str(spec) == "picam":
        return PiCamera2Source(width, height, fps, flip).start()
    return OpenCVCamera(spec, width, height, fps, flip).start()
