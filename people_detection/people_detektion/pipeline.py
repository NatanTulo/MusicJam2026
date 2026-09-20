"""Pipeline wizyjny w osobnym watku: kamera -> detekcja -> tracking.

Klucz do plynnosci na RPi5: detekcja i renderowanie NIE dziela petli.
Detekcja leci w swoim tempie (np. 10 Hz), wizualizacja renderuje 60 Hz i
bierze ostatni gotowy `PeopleFrame`. Ryby i tak poruszaja sie inercyjnie,
wiec 10 Hz aktualizacji celow jest wizualnie nieodroznialne od 60 Hz.

Uzycie:
    with PeoplePipeline(cfg) as pipe:
        while True:
            frame = pipe.latest()     # nigdy nie blokuje
"""
from __future__ import annotations

import threading
import time
from typing import Optional

import cv2
import numpy as np

from .camera import FrameSource, open_camera
from .detector import Detector, build_detector
from .tracker import PeopleTracker
from .types import PeopleFrame


class PeoplePipeline:
    def __init__(
        self,
        camera: str | int = 0,
        width: int = 640,
        height: int = 480,
        camera_fps: int = 30,
        mirror: bool = True,
        detector: str = "auto",
        model_path: str = "models/nanodet-plus-m-1.5x-416.onnx",
        score_threshold: float = 0.35,
        iou_threshold: float = 0.5,
        num_threads: int = 4,
        detect_fps: float = 12.0,
        preview_width: int = 320,
        tracker_kwargs: Optional[dict] = None,
    ) -> None:
        self.camera_spec = camera
        self.width, self.height = width, height
        self.camera_fps = camera_fps
        self.mirror = mirror
        self.detect_interval = 1.0 / max(0.5, detect_fps)
        self.preview_width = preview_width

        self._detector_kind = detector
        self._model_path = model_path
        self._score_threshold = score_threshold
        self._iou_threshold = iou_threshold
        self._num_threads = num_threads
        self._tracker_kwargs = tracker_kwargs or {}

        self.source: FrameSource | None = None
        self.detector: Detector | None = None
        self.tracker: PeopleTracker | None = None

        self._latest = PeopleFrame()
        self._lock = threading.Lock()
        self._thread: threading.Thread | None = None
        self._running = False
        self._error: BaseException | None = None

    # -- cykl zycia ----------------------------------------------------
    def start(self) -> "PeoplePipeline":
        self.source = open_camera(self.camera_spec, self.width, self.height, self.camera_fps, self.mirror)
        self.detector = build_detector(
            self._detector_kind, self._model_path,
            self._score_threshold, self._iou_threshold, self._num_threads,
        )
        self.tracker = PeopleTracker(**self._tracker_kwargs)
        self._running = True
        self._thread = threading.Thread(target=self._loop, name="vision", daemon=True)
        self._thread.start()
        return self

    def stop(self) -> None:
        self._running = False
        if self._thread is not None:
            self._thread.join(timeout=2.0)
        if self.source is not None:
            self.source.stop()

    def __enter__(self) -> "PeoplePipeline":
        return self.start()

    def __exit__(self, *exc) -> None:
        self.stop()

    # -- petla robocza -------------------------------------------------
    def _loop(self) -> None:
        assert self.source and self.detector and self.tracker
        frame_index = 0
        last_detect = 0.0
        detect_fps_ema = 0.0
        last_stamp_seen = -1.0

        try:
            while self._running:
                now = time.monotonic()
                wait = self.detect_interval - (now - last_detect)
                if wait > 0:
                    time.sleep(min(wait, 0.005))
                    continue

                frame, stamp = self.source.read()
                if frame is None or stamp == last_stamp_seen:
                    time.sleep(0.002)   # ta sama klatka co poprzednio - nie ma czego liczyc
                    continue
                last_stamp_seen = stamp

                # odliczamy od POCZATKU detekcji, nie od konca - inaczej okres
                # to (interwal + czas inferencji) i realne fps jest nizsze od zadanego
                cycle_start = time.monotonic()
                dt = cycle_start - last_detect
                last_detect = cycle_start

                t0 = time.perf_counter()
                detections = self.detector.detect(frame)
                detect_ms = (time.perf_counter() - t0) * 1000.0

                people = self.tracker.update(detections, time.monotonic())

                if dt > 0:
                    inst = 1.0 / dt
                    detect_fps_ema = inst if detect_fps_ema == 0 else 0.85 * detect_fps_ema + 0.15 * inst

                frame_index += 1
                h, w = frame.shape[:2]
                out = PeopleFrame(
                    people=people,
                    frame_index=frame_index,
                    timestamp=stamp,
                    camera_fps=self.source.fps,
                    detect_fps=detect_fps_ema,
                    detect_ms=detect_ms,
                    latency_ms=(time.monotonic() - stamp) * 1000.0,
                    frame_size=(w, h),
                    preview=self._make_preview(frame),
                )
                with self._lock:
                    self._latest = out
        except BaseException as exc:  # watek tla - blad musi dojsc do glownego
            self._error = exc
            self._running = False

    def _make_preview(self, frame: np.ndarray) -> Optional[np.ndarray]:
        if self.preview_width <= 0:
            return None
        h, w = frame.shape[:2]
        pw = self.preview_width
        ph = max(1, int(h * pw / w))
        small = cv2.resize(frame, (pw, ph), interpolation=cv2.INTER_AREA)
        return cv2.cvtColor(small, cv2.COLOR_BGR2RGB)

    # -- odczyt --------------------------------------------------------
    def latest(self) -> PeopleFrame:
        if self._error is not None:
            raise RuntimeError("Pipeline wizyjny padl") from self._error
        with self._lock:
            return self._latest
