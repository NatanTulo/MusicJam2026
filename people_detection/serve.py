#!/usr/bin/env python3
"""Mostek: detekcja ludzi -> ryby w przegladarce (web_visualization).

    film/kamera -> detekcja -> tracking -> mapowanie (u,v) --SSE--> Batymetry Boat

Przegladarka otwiera strumien Server-Sent Events:
    GET http://<host>:8765/fish    strumien JSON, ~12 wiadomosci/s
    GET http://<host>:8765/state   ostatnia wiadomosc (do podgladu: curl)

Dlaczego SSE, a nie WebSocket: dane plyna tylko w jedna strone, przegladarka
sama wznawia polaczenie (EventSource), a serwer to biblioteka standardowa -
zero dodatkowych pakietow na RPi5.

Uzycie:
    python serve.py                   # zrodlo z config.py (domyslnie nagranie testowe)
    python serve.py --preview         # + okno z obrazem i ramkami ludzi
    python serve.py --camera 0 --mirror
"""
from __future__ import annotations

import argparse
import json
import queue
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import config
from fish.mapping import PersonToFishMapper
from people_detektion.pipeline import PeoplePipeline


class Broadcaster:
    """Rozsyla te same bajty do wszystkich polaczonych przegladarek."""

    def __init__(self) -> None:
        self._clients: list[queue.Queue] = []
        self._lock = threading.Lock()
        self.latest: bytes = b"{}"

    def subscribe(self) -> queue.Queue:
        q: queue.Queue = queue.Queue(maxsize=8)
        with self._lock:
            self._clients.append(q)
        return q

    def unsubscribe(self, q: queue.Queue) -> None:
        with self._lock:
            if q in self._clients:
                self._clients.remove(q)

    @property
    def client_count(self) -> int:
        with self._lock:
            return len(self._clients)

    def publish(self, payload: dict) -> None:
        data = json.dumps(payload, separators=(",", ":")).encode()
        self.latest = data
        with self._lock:
            clients = list(self._clients)
        for q in clients:
            if q.full():  # wolny klient: wyrzuc najstarsza wiadomosc, liczy sie tylko biezacy stan
                try:
                    q.get_nowait()
                except queue.Empty:
                    pass
            q.put_nowait(data)


def make_handler(bus: Broadcaster):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, fmt, *args):  # cisza w konsoli - co 80 ms byloby spamu
            pass

        def _cors(self) -> None:
            # strona web chodzi na innym porcie (vite 5173), wiec potrzebny CORS
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Cache-Control", "no-cache")

        def do_GET(self) -> None:
            path = self.path.split("?")[0]
            if path == "/fish":
                self._stream()
            elif path == "/state":
                body = bus.latest
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self._cors()
                self.end_headers()
                self.wfile.write(body)
            else:
                body = b"MusicJam fish bridge: GET /fish (SSE), GET /state (JSON)\n"
                self.send_response(200)
                self.send_header("Content-Type", "text/plain; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self._cors()
                self.end_headers()
                self.wfile.write(body)

        def _stream(self) -> None:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Connection", "keep-alive")
            self._cors()
            self.end_headers()
            q = bus.subscribe()
            try:
                self.wfile.write(b"retry: 1000\n\n")
                self.wfile.flush()
                while True:
                    try:
                        data = q.get(timeout=10.0)
                        self.wfile.write(b"data: " + data + b"\n\n")
                    except queue.Empty:
                        self.wfile.write(b": keepalive\n\n")  # proxy/przegladarka nie zamkna cichego polaczenia
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, OSError):
                pass
            finally:
                bus.unsubscribe(q)

    return Handler


def build_payload(frame, targets, source_label: str) -> dict:
    return {
        "type": "fish",
        "t": round(time.time(), 3),
        "frame": frame.frame_index,
        "source": source_label,
        "stats": {
            "people": len(frame.people),
            "detect_fps": round(frame.detect_fps, 1),
            "camera_fps": round(frame.camera_fps, 1),
            "latency_ms": round(frame.latency_ms),
        },
        "fish": [
            {
                "id": t.person_id,
                "u": round(t.u, 4),
                "v": round(t.v, 4),
                "scale": round(t.scale, 3),
                "excitement": round(t.excitement, 3),
                "confidence": round(t.confidence, 3),
                "fresh": t.fresh,
            }
            for t in targets.values()
        ],
    }


def parse_args(argv=None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--camera", default=config.SOURCE, help=f"zrodlo obrazu (domyslnie z config.py: {config.SOURCE!r})")
    p.add_argument("--mirror", action=argparse.BooleanOptionalAction, default=config.MIRROR)
    p.add_argument("--cam-width", type=int, default=640)
    p.add_argument("--cam-height", type=int, default=480)
    p.add_argument("--detector", default="auto", choices=["auto", "nanodet", "hog"])
    p.add_argument("--model", default="models/nanodet-plus-m-1.5x-416.onnx")
    p.add_argument("--threads", type=int, default=4)
    p.add_argument("--detect-fps", type=float, default=12.0)
    p.add_argument("--max-age", type=float, default=2.0,
                   help="ile sekund pamietac zgubiona osobe (dluzej = mniej 'nowych' ryb po zaslonieciu)")
    p.add_argument("--reid-window", type=float, default=4.0,
                   help="jak dlugo pamietac zniknietych do re-ID (0 = wylacza)")
    p.add_argument("--excitement-speed", type=float, default=0.45,
                   help="predkosc osoby [1/s] uznana za 'szybko' (siedzaca publika: np. 0.2)")
    p.add_argument("--host", default="0.0.0.0", help="0.0.0.0 = dostepne tez z innych urzadzen w sieci")
    p.add_argument("--port", type=int, default=config.BRIDGE_PORT)
    p.add_argument("--preview", action="store_true", help="okno z obrazem i rozpoznanymi ludzmi")
    p.add_argument("--seconds", type=float, default=0.0, help="zakoncz po N sekundach (testy)")
    return p.parse_args(argv)


def main(argv=None) -> int:
    args = parse_args(argv)
    import os
    os.chdir(os.path.dirname(os.path.abspath(__file__)))  # sciezki modeli wzgledem folderu projektu

    source = config.resolve_source(args.camera)
    pipeline = PeoplePipeline(
        camera=source, width=args.cam_width, height=args.cam_height,
        mirror=args.mirror, detector=args.detector, model_path=args.model,
        num_threads=args.threads, detect_fps=args.detect_fps,
        preview_width=480 if args.preview else 0,
        tracker_kwargs={"max_age": args.max_age, "reid_window": args.reid_window},
    )
    try:
        pipeline.start()
    except Exception as exc:
        print(f"Nie udalo sie wystartowac pipeline'u: {exc}")
        if "vtest.avi" in str(args.camera):
            print("Brak nagrania testowego? Uruchom: bash media/download_sample_video.sh")
        return 1

    mapper = PersonToFishMapper(excitement_speed=args.excitement_speed)
    bus = Broadcaster()
    server = ThreadingHTTPServer((args.host, args.port), make_handler(bus))
    server.daemon_threads = True
    threading.Thread(target=server.serve_forever, name="http", daemon=True).start()

    label = str(args.camera)
    print(f"Mostek ryb: http://127.0.0.1:{args.port}/fish  (zrodlo: {label}, detektor: {pipeline.detector.name})")
    print("Otworz Batymetry Boat (web_visualization: npm run dev) - ryby pojawia sie w Zatoce Gdanskiej.")

    window = None
    if args.preview:
        import pygame
        from people_detektion.preview_window import CameraWindow
        pygame.init()
        window = CameraWindow(width=480, y_band=mapper.current_y_band)

    last_index = -1
    last_log = time.monotonic()
    started = time.monotonic()
    try:
        while True:
            frame = pipeline.latest()
            if frame.frame_index != last_index:
                last_index = frame.frame_index
                targets = mapper.map_frame(frame)
                bus.publish(build_payload(frame, targets, label))
                if window is not None:
                    window.update(frame)

            if window is not None:
                import pygame
                for event in pygame.event.get():
                    window.handle_event(event)
                    if event.type == pygame.QUIT or (event.type == pygame.KEYDOWN and event.key == pygame.K_ESCAPE):
                        raise KeyboardInterrupt
                if not window.alive:
                    window = None

            now = time.monotonic()
            if now - last_log > 5.0:
                last_log = now
                print(f"  osob: {len(frame.people):2d}  detekcja: {frame.detect_fps:4.1f} fps  "
                      f"przegladarek: {bus.client_count}")
            if args.seconds and now - started > args.seconds:
                break
            time.sleep(0.01)
    except KeyboardInterrupt:
        pass
    finally:
        server.shutdown()
        pipeline.stop()
        if window is not None:
            window.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
