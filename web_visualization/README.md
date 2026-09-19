# 🛶 Batymetry Boat — łódka po prawdziwym dnie Bałtyku

Webowa gra 3D (Three.js + Vite): pływasz łódką po **rzeczywistym modelu dna Bałtyku**,
a echosonda na żywo pokazuje głębokość pod łódką.

## Skąd model dna? (nie satelity!)

Głębokości nie mierzy się satelitami optycznymi (woda pochłania światło), tylko:

| Źródło | Rozdzielczość | Pokrycie | Licencja | Użycie w projekcie |
|---|---|---|---|---|
| **[EMODnet DTM 2024](https://doi.org/10.12770/cf51df64-56f9-4a99-b1aa-36b8d7b743a1)** | 1/16 minuty łuku (~115 m) | morza Europy, w tym **cały Bałtyk** | darmowe, nie do nawigacji | ✅ aktualne dane w grze (pobrane przez `scripts/fetch-bathymetry.mjs`) |
| **[GEBCO 2026](https://www.gebco.net/data_and_products/gridded_bathymetry_data)** | 15 sekund łuku (~450 m) | **globalne** | domena publiczna | ⏭️ docelowo: rozszerzenie na inne morza/oceany |
| [ETOPO1 (NOAA)](https://www.ncei.noaa.gov/products/etopo-global-relief-model) | 1 minuta (~1,8 km) | globalne | domena publiczna | fallback / prototyp |
| [Baltic Sea Bathymetry Database (BSBD)](http://data.bshc.pro/) | ~500 m | Bałtyk | naukowa | alternatywa |

Dane powstają z **echa sonarów (multibeam/singlebeam) ze statków** + kompilacji
rejsów pomiarowych; satelitarna **altimetria radarowa** (Sandwell/Smith, SRTM15+)
uzupełnia tylko pełne oceany w GEBCO. Dlatego w grze używamy EMODnet (sonary),
a GEBCO zostawiamy jako ścieżkę rozszerzeń poza Europę.

## Start

```bash
npm install
npm run fetch:data   # świeża batymetria z EMODnet ERDDAP: cały Bałtyk + detal Zatoki Gdańskiej
npm run dev          # http://127.0.0.1:5173
npm run build        # build do dist/
```

Dwa regiony w grze (przełączane z GUI):
- **Bałtyk — cały** (401×705 komórek po ~3,5 km, ~1,4 MB) — start natychmiastowy;
  w tle dociąga się **pełna rozdzielczość** (2401×4225 po ~580×340 m, PNG 3,5 MB)
  i podmienia siatkę bez resetowania łódki (`npm run fetch:fullres` regeneruje PNG
  z EMODnet; obszar Zatoki doklejany jest z siatki detalicznej, żeby faza
  próbkowania nie urywała Mierzei Helskiej).
- **Zatoka Gdańska — detal** (154×327 po ~575 m) — precyzyjne pływanie, prawdziwy kształt Mierzei Helskiej.

## Sterowanie

- **W/S** – gaz / wstecz, **A/D** – skręt, mysz – orbita/zoom, **C** – kamera podążająca, **R** – restart
- **Tempo testowe**: selektor 1–500× w panelu (lub klawisze **1**/**2**/**3**/**4** = 1×/10×/100×/500×) — nierealistycznie szybkie rejsy po całym Bałtyku
- HUD: głębokość pod łódką (m), pozycja lat/lon, prędkość (węzły), kurs, echosonda, minimapa z trasą
- Mielizna: łódka staje, status „MIELIZNA!”
- **Granice i nazwy państw** (3D + minimapa, z przełącznikami w panelu): dane
  [tiny-world-map](https://github.com/tinyworldmap/tiny-world-map) © OpenStreetMap
  contributors, licencja ODbL — lokalny wyciąg generuje `npm run fetch:borders`

## Ryby = ludzie z kamery

Każda osoba wykryta przez `people_detection` staje się rybą w morzu.

```bash
cd ../people_detection && python serve.py     # detekcja (na razie z nagrania testowego)
npm run dev                                   # gra: panel "Ryby — ludzie z kamery"
```

Bez detekcji: zaznacz **tryb demo** w panelu albo otwórz `?demo=1` — sztuczni ludzie
chodzą po podłodze. Przycisk **„Pokaż łowisko”** ustawia kamerę nad rybami (`C` wraca do łódki).

- **Gdzie są ryby:** podłoga z kamery jest rozłożona na **łowisko** — prostokąt w Zatoce
  Gdańskiej wokół startu łódki (~9 × 7 km), zmiana w
  [`src/fish/config.js`](src/fish/config.js), linia 16 (`ground`). Dno opada tam
  z ~20 do ~70 m, więc głębokości są naprawdę różne. Cel na lądzie (np. Mierzeja)
  jest przesuwany do najbliższej wody; ryby omijają płycizny < 4 m.
- **Na jakiej głębokości:** gatunek (stały dla osoby) wyznacza warstwę jako ułamek słupa
  wody pod rybą: szprot 5–28 %, śledź 28–58 %, dorsz 60–86 %, flądra 88–97 %.
  Nad Głębią Gdańską ta sama ryba pływa więc głębiej niż nad płycizną. W warstwie
  powoli faluje, a gdy człowiek się rusza — wypływa wyżej.
- **Cykl życia:** człowiek zgubiony przez detektor → ryba krąży i miga (1,5 s);
  człowiek wyszedł → ryba odpływa od środka łowiska i gaśnie (3 s).
- **Kolor ryby = kolor ramki osoby** w podglądzie kamery (`python serve.py --preview`).
- Adres mostka: domyślnie `http://<host strony>:8765/fish`, inny: `?fish=http://ip:8765/fish`,
  wyłączenie: `?fish=off`.

## Dźwięk: hydrofon łódki

Przycisk **„🔊 Włącz dźwięk”** (przeglądarka wymaga kliknięcia). Łódka słucha
hydrofonem na linie (`Q`/`E` w górę/w dół, suwak w panelu). Ryby grają nuty,
a woda i dno Bałtyku je kształtują: opóźnienie ~0,69 s/km, cichnięcie i ciemnienie
z odległością, echa od powierzchni i dna, cień za wzniesieniami dna. Skala muzyki
zależy od dna pod łódką. Tło morza zmienia się z głębokością hydrofonu.

**Laboratorium dźwięku:** [`sound-lab.html`](sound-lab.html) (`npm run dev` →
http://127.0.0.1:5173/sound-lab.html) — przekrój morza, przeciągane ryby i hydrofon,
suwaki, widmo, liczby. Ten sam silnik co w grze.

Koncepcja, wzory, uproszczenia i pomiary: **[docs/dzwiek.md](docs/dzwiek.md)**.

```bash
npm test      # testy fizyki dźwięku (node --test)
```

| Plik | Rola |
|---|---|
| `src/fish/config.js` | łowisko, adres mostka, prędkości ryb |
| `src/fish/species.js` | gatunki: warstwa wody, rozmiar, głos |
| `src/fish/fishSim.js` | pozycja, głębokość, omijanie lądu, cykl życia |
| `src/fish/fishRender.js` | ryby w Three.js (stały rozmiar ekranowy, linia głębokości, kółko na tafli) |
| `src/fish/link.js`, `demo.js` | źródło celów: mostek SSE albo demo |
| `src/sound/acoustics.js` | fizyka: c(z), pochłanianie, drogi, odbicia, cień (czyste funkcje) |
| `src/sound/music.js` | skale, rytm, nuta z głębokości |
| `src/sound/engine.js` | silnik WebAudio (gra + laboratorium, też offline) |
| `src/sound/controller.js` | dźwięk w grze: panel, `Q`/`E`, lina hydrofonu w 3D |

## Dostęp do głębokości (API)

W konsoli przeglądarki (i dla przyszłej logiki gry):

```js
boatAPI.getDepth()       // głębokość pod łódką w metrach
boatAPI.getElevation()   // wysokość dna względem LAT (ujemna = pod wodą)
boatAPI.getPosition()    // { lat, lon }
boatAPI.getSpeedKnots()  // prędkość w węzłach
boatAPI.getHeadingDeg()  // kurs 0–360°
boatAPI._step(dt)        // deterministyczny krok fizyki (do testów headless)
boatAPI.getFish()        // [{ id, species, lat, lon, depth, seabed, state, alpha }]
boatAPI.getSoundInfo()   // co słyszy hydrofon: ryby, opóźnienia, poziomy, skala
boatAPI.setHydrophoneDepth(m)
```

## Jak dodać nowe morze?

1. Dopisz region do `REGIONS` w `scripts/fetch-bathymetry.mjs`
   (dowolny bbox w Europie → EMODnet; poza Europą → GEBCO subset/OPeNDAP).
2. `npm run fetch:data`, 3. dopisz wpis do `REGIONS` w `src/main.js`. Gotowe —
   teren, kolory, echosonda i minimapa budują się automatycznie z siatki.
