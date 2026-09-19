#!/usr/bin/env python3
"""Pomiar wydajnosci - do doboru ustawien pod Raspberry Pi 5.

    python tools/bench.py                      # detektor przy roznej liczbie watkow
    python tools/bench.py --video nagranie.mp4 # dodatkowo caly pipeline na realnym materiale

Interesuje nas nie sam czas inferencji, tylko ile klatek na sekunde da sie
realnie przepuscic, gdy w tle chodzi jeszcze kamera i symulacja.
"""
from __future__ import annotations

import argparse
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import numpy as np

from fish.mapping import PersonToFishMapper
from fish.world import FishWorld


def bench_detector(model: str, threads_list: list[int], iters: int) -> None:
    from people_detektion.detector import NanoDetONNX

    img = (np.random.rand(480, 640, 3) * 255).astype(np.uint8)
    print(f"\n== Detektor (NanoDet-Plus 416, klatka 640x480, {iters} powtorzen)")
    for threads in threads_list:
        det = NanoDetONNX(model, num_threads=threads)
        for _ in range(3):
            det.detect(img)
        t = time.perf_counter()
        for _ in range(iters):
            det.detect(img)
        ms = (time.perf_counter() - t) / iters * 1000
        print(f"  watki={threads}: {ms:6.1f} ms/klatke  ->  {1000/ms:5.1f} fps teoretycznie")


def bench_world(sizes: list[int], iters: int) -> None:
    print(f"\n== Symulacja ryb ({iters} krokow po 1/60 s)")
    mapper = PersonToFishMapper()
    for n in sizes:
        w = FishWorld(shoal_size=n)
        t = time.perf_counter()
        for _ in range(iters):
            w.update({}, 1 / 60)
        ms = (time.perf_counter() - t) / iters * 1000
        budget = 16.7
        print(f"  {n:3d} ryb: {ms:5.2f} ms/krok  ({ms/budget*100:4.1f} % budzetu klatki 60 fps)")


def bench_pipeline(video: str, seconds: float, detect_fps: float) -> None:
    from people_detektion.pipeline import PeoplePipeline

    print(f"\n== Caly pipeline na {video} przez {seconds:.0f} s (cel: {detect_fps} Hz detekcji)")
    with PeoplePipeline(camera=video, mirror=False, detect_fps=detect_fps) as pipe:
        time.sleep(2.0)
        t_end = time.time() + seconds
        counts = []
        while time.time() < t_end:
            f = pipe.latest()
            counts.append(len(f.people))
            time.sleep(0.05)
        f = pipe.latest()
        print(f"  detekcja: {f.detect_fps:.1f} fps ({f.detect_ms:.1f} ms)   kamera: {f.camera_fps:.1f} fps")
        print(f"  opoznienie klatka->wynik: {f.latency_ms:.0f} ms")
        print(f"  osob w kadrze: srednio {np.mean(counts):.1f}, max {max(counts)}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="models/nanodet-plus-m-1.5x-416.onnx")
    ap.add_argument("--video", help="plik wideo do testu calego pipeline'u")
    ap.add_argument("--iters", type=int, default=30)
    ap.add_argument("--seconds", type=float, default=8.0)
    ap.add_argument("--detect-fps", type=float, default=12.0)
    args = ap.parse_args()

    print(f"CPU: {os.cpu_count()} rdzeni")
    if os.path.isfile(args.model):
        bench_detector(args.model, [1, 2, 4], args.iters)
    else:
        print(f"(pomijam detektor - brak {args.model}, uruchom bash models/download_models.sh)")
    bench_world([20, 40, 80], 300)
    if args.video:
        bench_pipeline(args.video, args.seconds, args.detect_fps)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
