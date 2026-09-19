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

## Dostęp do głębokości (API)

W konsoli przeglądarki (i dla przyszłej logiki gry):

```js
boatAPI.getDepth()       // głębokość pod łódką w metrach
boatAPI.getElevation()   // wysokość dna względem LAT (ujemna = pod wodą)
boatAPI.getPosition()    // { lat, lon }
boatAPI.getSpeedKnots()  // prędkość w węzłach
boatAPI.getHeadingDeg()  // kurs 0–360°
boatAPI._step(dt)        // deterministyczny krok fizyki (do testów headless)
```

## Jak dodać nowe morze?

1. Dopisz region do `REGIONS` w `scripts/fetch-bathymetry.mjs`
   (dowolny bbox w Europie → EMODnet; poza Europą → GEBCO subset/OPeNDAP).
2. `npm run fetch:data`, 3. dopisz wpis do `REGIONS` w `src/main.js`. Gotowe —
   teren, kolory, echosonda i minimapa budują się automatycznie z siatki.
