#!/usr/bin/env python3
"""MusicJam2026 - ludzie z kamery jako ryby.

    kamera -> detekcja osob -> tracking (ID) -> mapowanie -> ryby -> render

Dwa watki:
    watek wizji   (people_detektion.pipeline)  ~10-15 Hz, zjada CPU
    watek glowny  (symulacja + pygame)         60 Hz, plynny obraz
Ryby interpoluja miedzy rzadkimi aktualizacjami celow, wiec obraz jest gladki
nawet gdy detekcja na RPi5 chodzi w 8 Hz.

Przyklady:
    python app.py                               # zrodlo z config.py (domyslnie nagranie testowe)
    python app.py --camera 0 --mirror           # kamera laptopa
    python app.py --camera nagranie.mp4         # dowolny plik (powtarzalne testy)
    python app.py --camera picam --fullscreen   # RPi5 + kamera CSI
    python app.py --detector hog                # bez pobierania modelu
"""
from __future__ import annotations

import argparse
import os
import sys

import config
from fish.mapping import PersonToFishMapper
from fish.world import FishWorld
from people_detektion.pipeline import PeoplePipeline


def parse_args(argv=None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)

    cam = p.add_argument_group("kamera")
    cam.add_argument("--camera", default=config.SOURCE,
                     help=f"indeks (0), plik wideo albo 'picam' (RPi5 CSI); domyslnie z config.py: {config.SOURCE!r}")
    cam.add_argument("--cam-width", type=int, default=640)
    cam.add_argument("--cam-height", type=int, default=480)
    cam.add_argument("--cam-fps", type=int, default=30)
    cam.add_argument("--mirror", action=argparse.BooleanOptionalAction, default=config.MIRROR,
                     help="odbicie lustrzane obrazu (domyslnie z config.py)")

    det = p.add_argument_group("detekcja")
    det.add_argument("--detector", default="auto", choices=["auto", "nanodet", "hog"])
    det.add_argument("--model", default="models/nanodet-plus-m-1.5x-416.onnx")
    det.add_argument("--score", type=float, default=0.35, help="prog pewnosci detekcji")
    det.add_argument("--nms", type=float, default=0.6)
    det.add_argument("--threads", type=int, default=4, help="watki onnxruntime (RPi5 ma 4 rdzenie)")
    det.add_argument("--detect-fps", type=float, default=12.0, help="ile razy na sekunde uruchamiac detekcje")

    trk = p.add_argument_group("tracking")
    trk.add_argument("--max-age", type=float, default=1.0, help="ile sekund track zyje bez detekcji")
    trk.add_argument("--min-hits", type=int, default=3, help="ile trafien zanim osoba zostanie uznana")

    viz = p.add_argument_group("wizualizacja")
    viz.add_argument("--width", type=int, default=1280)
    viz.add_argument("--height", type=int, default=720)
    viz.add_argument("--fps", type=int, default=60)
    viz.add_argument("--shoal", type=int, default=26, help="ile ryb tla (0 = tylko ludzie)")
    viz.add_argument("--fullscreen", action="store_true")
    viz.add_argument("--headless", action="store_true", help="bez okna - do testow i pomiarow")
    viz.add_argument("--debug", action="store_true", help="start z podgladem kamery jako panelem w rogu (klawisz P)")
    viz.add_argument("--no-camera-window", action="store_true", help="nie otwieraj drugiego okna z obrazem kamery")
    viz.add_argument("--preview-width", type=int, default=480, help="szerokosc podgladu z kamery w pikselach")
    viz.add_argument("--screenshot", metavar="PLIK", help="zapisz klatke do PNG i zakoncz")
    viz.add_argument("--screenshot-after", type=float, default=5.0, help="po ilu sekundach zrobic zrzut")
    viz.add_argument("--seconds", type=float, default=0.0, help="zakoncz po N sekundach (0 = bez limitu)")
    return p.parse_args(argv)


def main(argv=None) -> int:
    args = parse_args(argv)
    if args.headless or args.screenshot:
        os.environ.setdefault("SDL_VIDEODRIVER", "dummy")

    from fish.render_pygame import Aquarium  # import po ustawieniu SDL_VIDEODRIVER

    pipeline = PeoplePipeline(
        camera=config.resolve_source(args.camera),
        width=args.cam_width, height=args.cam_height, camera_fps=args.cam_fps,
        mirror=args.mirror,
        detector=args.detector, model_path=args.model,
        score_threshold=args.score, iou_threshold=args.nms,
        num_threads=args.threads, detect_fps=args.detect_fps,
        preview_width=args.preview_width,
        tracker_kwargs={"max_age": args.max_age, "min_hits": args.min_hits},
    )

    try:
        pipeline.start()
    except Exception as exc:
        print(f"Nie udalo sie wystartowac pipeline'u: {exc}", file=sys.stderr)
        return 1

    aquarium = Aquarium(args.width, args.height, args.fullscreen, args.fps)
    aquarium.show_debug = args.debug

    # drugie okno: surowy obraz z kamery + kogo tracker rozpoznaje
    mapper = PersonToFishMapper()
    camera_window = None
    if not (args.no_camera_window or args.headless or args.screenshot):
        try:
            from people_detektion.preview_window import CameraWindow
            camera_window = CameraWindow(
                width=args.preview_width, position=(40, 40), y_band=mapper.current_y_band
            )
            aquarium.camera_window = camera_window
        except Exception as exc:   # brak drugiego okna nie moze zabic instalacji
            print(f"[podglad] nie udalo sie otworzyc okna kamery ({exc}); zostaje panel pod klawiszem P")
            aquarium.show_debug = True
    world = FishWorld(aspect=aquarium.aspect, shoal_size=args.shoal)
    detector_name = pipeline.detector.name if pipeline.detector else "?"

    elapsed = 0.0
    try:
        while aquarium.running:
            dt = aquarium.tick()
            elapsed += dt
            aquarium.handle_events(listeners=[camera_window] if camera_window else [])

            world.aspect = aquarium.aspect          # po zmianie rozmiaru okna
            frame = pipeline.latest()
            world.update(mapper.map_frame(frame), dt)
            aquarium.draw(world, frame, detector_name, dt)
            if camera_window is not None:
                camera_window.update(frame)

            if args.screenshot and elapsed > args.screenshot_after:
                import pygame
                pygame.image.save(aquarium.screen, args.screenshot)
                print(f"zapisano {args.screenshot}")
                break
            if args.seconds and elapsed > args.seconds:
                break
    except KeyboardInterrupt:
        pass
    finally:
        if camera_window is not None:
            camera_window.close()
        pipeline.stop()
        aquarium.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
