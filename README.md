# MusicJam2026

Repozytorium z dwoma niezależnymi projektami. Każdy ma swój folder, swoje zależności
i swoje README ze szczegółami.

| Folder | Projekt | Technologia |
|---|---|---|
| [`people_detection/`](people_detection/README.md) | **Ludzie z kamery jako ryby.** Kamera wykrywa ludzi, każdy dostaje swoją rybę w akwarium. Docelowo Raspberry Pi 5. | Python, OpenCV, onnxruntime (NanoDet), pygame |
| [`web_visualization/`](web_visualization/README.md) | **Batymetry Boat.** Webowa gra 3D: łódka pływa po prawdziwym dnie Bałtyku (EMODnet DTM 2024). | JavaScript, Three.js, Vite |

## Szybki start

### Detekcja ludzi → ryby

```bash
cd people_detection
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
bash models/download_models.sh
python app.py
```

### Wizualizacja web

```bash
cd web_visualization
npm install
npm run dev          # http://127.0.0.1:5173
```

Polecenia uruchamiaj z folderu danego projektu, bo ścieżki do modeli i danych
(`models/`, `public/data/`) są względne.
