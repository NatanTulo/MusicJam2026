# MusicJam2026 — ludzie z kamery jako ryby

Kamera patrzy na przestrzeń, system wykrywa ludzi i każdemu z nich przypisuje rybę.
Ryba żyje tak długo, jak człowiek jest w kadrze: podąża za nim, przyspiesza gdy on
przyspiesza, a gdy wyjdzie — odpływa poza ekran. W tle pływa ławica, która reaguje
na ryby-awatary.

Docelowo całość chodzi na **Raspberry Pi 5 (8 GB)** z kamerą, bez akceleratora.
Teraz działa na laptopie z kamerą internetową; kod jest ten sam.

```
  kamera ──► detekcja osób ──► tracking (ID) ──► mapowanie ──► ryby ──► render
  30 Hz      NanoDet ONNX      IoU + wygładz.   osoba→cel     boidy    pygame
             ~12 Hz            stabilne ID      SZEW          60 Hz    TYMCZASOWY
  └──────────── wątek wizji ─────────────────┘  └──────── wątek główny ─────────┘
```

Dwa wątki, bo detekcja na CPU jest wolniejsza niż oko. Wizja liczy ~12 razy na
sekundę, obraz renderuje się 60 razy — ryby poruszają się bezwładnie, więc
interpolują między rzadkimi aktualizacjami celu i nic nie „skacze”.

## Start

```bash
pip install -r requirements.txt
bash models/download_models.sh        # NanoDet-Plus, 3.8 MB
python app.py                         # kamera 0
```

Bez pobierania modelu: `python app.py --detector hog` (wbudowany w OpenCV HOG —
działa od razu, ale wykrywa znacznie gorzej; tylko do sprawdzenia, że wszystko się spina).

Inne warianty:

```bash
python app.py --camera nagranie.mp4 --no-mirror   # powtarzalny test z pliku
python app.py --camera picam --fullscreen         # RPi5, kamera CSI
python app.py --shoal 0                           # bez ławicy tła, same „ludzkie” ryby
python app.py --debug                             # od razu z podglądem kamery
python tools/bench.py --video nagranie.mp4        # pomiary pod dobór ustawień
```

**Klawisze:** `TAB` okno kamery · `P` ten sam podgląd jako panel w rogu · `H` HUD · `T` smugi · `F` pełny ekran · `ESC` wyjście.

## Dwa okna

Uruchamiają się dwa okna:

1. **Akwarium** — ryby. To idzie docelowo na projektor.
2. **Kamera — kogo widzę** — surowy obraz z kamery z nałożoną detekcją: ramka wokół
   każdej rozpoznanej osoby, jej `#ID` i pewność, krzyżyk na stopach (czyli w punkcie,
   który steruje pozycją ryby w pionie), wektor prędkości i pasek ze statystykami.

**Kolor ramki = kolor ryby tej osoby**, więc od razu widać, która ryba należy do kogo.
Osoba, którą detektor chwilowo zgubił (ryba krąży w miejscu), dostaje cieńszą ramkę
i podpis `(zgubiony)`. Przyciemniony pas u góry to obszar kadru, z którego mapowanie
**nie** czyta pozycji w pionie — jeśli ludzie chodzą po ciemnym, popraw `y_in`
w `PersonToFishMapper`.

`TAB` chowa i pokazuje to okno; zamknięcie go krzyżykiem nie zamyka instalacji.
Gdy akwarium idzie na pełnym ekranie i drugie okno przeszkadza: `--no-camera-window`
(wtedy `TAB` przełącza podgląd jako panel w rogu akwarium). Rozmiar: `--preview-width 640`.

## Co gdzie jest

| Plik | Rola |
|---|---|
| `people_detektion/types.py` | **Kontrakt**: `Detection`, `Person`, `PeopleFrame`. Wszystkie współrzędne znormalizowane do `[0,1]`, więc zmiana rozdzielczości kamery nic nie psuje. |
| `people_detektion/camera.py` | Wątek grabbera — zawsze najnowsza klatka. Backendy: OpenCV (USB/plik) i picamera2 (CSI na RPi). |
| `people_detektion/detector.py` | NanoDet-Plus przez onnxruntime + fallback HOG. Bierzemy tylko klasę COCO `person`. |
| `people_detektion/tracker.py` | Nadaje stabilne ID, wygładza pozycję, liczy prędkość, przetrzymuje krótkie zgubienia. |
| `people_detektion/pipeline.py` | Spina powyższe w wątku tła, oddaje `latest()` bez blokowania. |
| **`fish/mapping.py`** | **SZEW — tu wchodzi docelowa logika.** Osoba → `FishTarget`. |
| `fish/world.py` | Zachowanie ryb (boidy, podążanie, rozpierzchanie). Zero rysowania. |
| `people_detektion/preview_window.py` | Drugie okno: obraz z kamery + kogo rozpoznajemy. Narzędzie do strojenia. |
| `fish/render_pygame.py` | **TYMCZASOWA** wizualizacja. Do wyrzucenia, gdy przyjdzie docelowa grafika. |
| `app.py` | Pętla główna, parametry z CLI. |

### Szew: `fish/mapping.py`

Reszta systemu nie wie nic o rybach, a grafika nie wie nic o kamerze. Jedyny styk to:

```python
FishTarget(person_id, x, y, scale, excitement, confidence, fresh)
```

- `person_id` — tożsamość z trackera; ta sama osoba zawsze dostaje tę samą rybę (i ten sam kolor),
- `x, y` — cel w akwarium `[0,1]`; `y` liczone ze **stóp** (dolna krawędź bboxa), bo to lepszy
  wskaźnik pozycji w przestrzeni niż środek sylwetki,
- `scale` — z wysokości bboxa, czyli głębia: bliżej kamery = większa ryba,
- `excitement` — z prędkości człowieka; ryba szybciej macha ogonem i mocniej rusza,
- `fresh=False` — detektor chwilowo zgubił człowieka; ryba krąży w miejscu zamiast znikać.

Podmiana mapowania (inna geometria sceny, kalibracja projektora, sonifikacja) nie wymaga
dotykania ani pipeline'u, ani renderera.

## Strojenie

| Objaw | Co ruszyć |
|---|---|
| Ludzie gubieni / migotanie | `--score 0.25`, `--max-age 1.5` |
| Fałszywe wykrycia | `--score 0.5`, `--min-hits 5` |
| Ryby „skaczą” za osobą | niższe `smoothing` w `PeopleTracker` (domyślnie 0.55) |
| Ryby zbyt ospałe | `base_speed` / `max_force` w `FishWorld` |
| Ludzie nie sięgają dołu akwarium | `y_in` / `y_out` w `PersonToFishMapper` — domyślnie zakładamy, że stopy są w dolnych 75 % kadru |
| Zbyt duże opóźnienie | `--detect-fps` w górę, `--cam-width 480` w dół |

## Raspberry Pi 5

```bash
sudo apt install -y python3-picamera2        # tylko dla kamery CSI
pip install -r requirements.txt              # onnxruntime ma koła na aarch64
python app.py --camera picam --cam-width 640 --cam-height 480 \
              --detect-fps 10 --threads 4 --fullscreen
```

Na jednym ekranie z projektorem dołóż `--no-camera-window`; przy dwóch wyjściach
zostaw okno kamery na monitorze podglądowym.

Zmierzone na laptopie (Intel Meteor Lake, ten sam kod):

| | |
|---|---|
| NanoDet 416, 1 wątek | 19 ms/klatkę |
| NanoDet 416, 4 wątki | 9 ms/klatkę |
| symulacja 40 ryb | 0,5 ms/krok (3 % budżetu klatki 60 fps) |
| cały pipeline, 13 osób w kadrze | 12 fps detekcji, 44 ms opóźnienia klatka→wynik |

Na RPi5 spodziewaj się ok. 4–6× wolniejszej inferencji, czyli **~40–70 ms/klatkę,
realnie 10–15 Hz detekcji** — czyli tyle, ile zakłada architektura. Jeśli zabraknie:
`--detect-fps 8`, `--shoal 12`, `--fps 30`, rozdzielczość kamery 480×360.
Wszystkie cztery rdzenie idą na onnxruntime (`--threads 4`); renderowanie i symulacja
siedzą w wątku głównym i zostawiają zapas.

## Ograniczenia (świadome)

- **Brak re-ID.** Człowiek, który wyjdzie z kadru i wróci, dostanie nową rybę.
  Dodanie re-ID (np. `person_reid_youtureid` z OpenCV Zoo) to koszt CPU, którego
  na RPi5 nie ma za darmo — do decyzji, czy jest potrzebne.
- **Tracking po IoU.** Gdy dwie osoby całkowicie się przesłonią, ID mogą się zamienić.
  Dla instalacji, gdzie ludzie stoją obok siebie, wystarcza.
- **Renderer jest tymczasowy.** Rysuje wielokąty w pygame; na RPi5 przy 60 fps i dużej
  rozdzielczości będzie ciasno — docelowa grafika powinna iść przez GPU.
