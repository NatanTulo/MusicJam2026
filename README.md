# MusicJam2026

Repozytorium z dwoma niezależnymi projektami. Każdy ma swój folder, swoje zależności
i swoje README ze szczegółami.

| Folder | Projekt | Technologia |
|---|---|---|
| [`people_detection/`](people_detection/README.md) | **Ludzie z kamery jako ryby.** Kamera (na razie nagranie testowe) wykrywa ludzi i wysyła ich pozycje do morza. Docelowo Raspberry Pi 5. | Python, OpenCV, onnxruntime (NanoDet) |
| [`web_visualization/`](web_visualization/README.md) | **Batymetry Boat.** Webowa gra 3D: łódka pływa po prawdziwym dnie Bałtyku (EMODnet DTM 2024), ryby = ludzie z kamery, hydrofon łódki słucha ich muzyki. | JavaScript, Three.js, WebAudio, Vite |

## Jak to się łączy

```
 people_detection/serve.py                       web_visualization (przeglądarka)
 film/kamera -> detekcja -> tracking ──SSE:8765──> ryby na łowisku w Zatoce Gdańskiej
                                                   -> hydrofon łódki -> muzyka + dźwięk morza
```

**Źródło obrazu** (nagranie ↔ kamera) zmienia się w jednym miejscu:
[`people_detection/config.py`](people_detection/config.py), linia 18 (`SOURCE`).
Szczegóły: [README detekcji](people_detection/README.md#źródło-obrazu-nagranie-zamiast-kamery).

Koncepcja dźwięku: [`web_visualization/docs/dzwiek.md`](web_visualization/docs/dzwiek.md),
laboratorium: `web_visualization/sound-lab.html`.

## Szybki start

### Całość: detekcja → ryby w morzu → dźwięk

```bash
# terminal 1: detekcja
cd people_detection
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
bash models/download_models.sh
bash media/download_sample_video.sh      # nagranie testowe (domyślne źródło)
python serve.py                          # --preview: okno z ramkami ludzi

# terminal 2: morze
cd web_visualization
npm install
npm run dev                              # http://127.0.0.1:5173 -> "Pokaż łowisko", "Włącz dźwięk"
```

Samo morze bez detekcji: `http://127.0.0.1:5173/?demo=1`.
Lokalny podgląd ryb w pygame (bez przeglądarki): `cd people_detection && python app.py`.

### Wizualizacja web

```bash
cd web_visualization
npm install
npm run dev          # http://127.0.0.1:5173
```

Polecenia uruchamiaj z folderu danego projektu, bo ścieżki do modeli i danych
(`models/`, `public/data/`) są względne.
