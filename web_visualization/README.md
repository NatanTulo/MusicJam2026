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
- **Na jakiej głębokości:** losowo w całym słupie wody (1 m pod taflą – 0,5 m nad
  dnem), niezależnie od kamery. Ryba powoli dryfuje do wylosowanego celu
  (~1,5 m/s jak przy nurkowaniu), po dotarciu albo po 6–14 s losuje nowy
  (`depthRepick` w [`src/fish/config.js`](src/fish/config.js)). Gatunek (stały
  dla osoby) daje głos i wygląd, ale nie warstwę.
- **Cykl życia:** człowiek zgubiony przez detektor → ryba krąży i miga (1,5 s);
  człowiek wyszedł → ryba odpływa od środka łowiska i gaśnie (3 s).
- **Kolor ryby = kolor ramki osoby** w podglądzie kamery (`python serve.py --preview`).
- Adres mostka: domyślnie `http://<host strony>:8765/fish`, inny: `?fish=http://ip:8765/fish`,
  wyłączenie: `?fish=off`.

## Mieszkańcy morza (tło)

Morze nigdy nie jest puste: wokół łódki (promień ~4,5 km) zawsze pływa kilkaset
drobnych stworzeń — na mapie to **maleńkie kropki bez podpisów**, a w dźwięku **tło muzyczne**.
Każde ma swoje siedlisko i swoją rolę:

| Kropka | Stworzenie | Gdzie | Dźwięk / rola |
|---|---|---|---|
| ● jasnofioletowa | meduza (chełbia modra) | 15–60 % słupa wody, dryfuje z prądem | długi, miękki pad — **harmonia** |
| ● szara | morświn (stado po 3) | 5–45 %, wynurza się po powietrze | serie kliknięć (echolokacja) — **rytm** |
| ● brązowa | foka szara | przy powierzchni, wynurza się | przeciągłe zawodzenie — **melodia** |
| ● piaskowa | babka bycza | **przy dnie, tylko płycizny < 38 m** | stuki — **perkusja** |
| ● biało-błękitna | ławica szprota (2 × 28) | 20–50 %, kłębi się | jasne arpeggia — **migotanie** |
| ● zielona | plankton | cały słup wody | ciche iskierki blisko hydrofonu — **faktura** |

Wysokość trzyma zasadę całego świata (głębiej = niżej), a wszystko gra w skali
wyznaczonej przez dno pod łódką. Odgłosy przechodzą przez ten sam model wody co ryby,
więc dalsze stworzenia są cichsze, ciemniejsze i **spóźnione**.

Wyłącznik i suwak głośności tła są w panelu. Babek nie zobaczysz nad głębią —
dosiewają się same, gdy wpłyniesz na płyciznę.

## Panel DJ: muzyka spod wody

Przycisk **„🎛 Panel DJ"**. Stawiasz podwodny głośnik w dowolnym miejscu
(1 km przed łódką, na łowisku, przy cyplu Helu albo klikając minimapę), wybierasz
**podkład demo** (generowany w kodzie) albo **własny plik**, i słuchasz, jak ta sama
muzyka brzmi po przejściu przez morze. Suwak **„na lądzie ↔ na statku"** przełącza
między oryginałem a tym, co dociera do hydrofonu.

Panel pokazuje odległość, czas dolotu dźwięku, częstotliwość odcięcia basu, liczbę
dróg, echo od terenu i Doppler. Zmierzone (szum różowy jako sygnał testowy):

| Głośnik | Efekt |
|---|---|
| 1 km przed łódką, woda 65 m | prawie bez zmian: −4 dB, widmo ±2 dB, dźwięk idzie 0,68 s |
| płycizna 3 m, 13,6 km | −24 dB, **2–5 kHz o 31 dB ciszej, 5–12 kHz o 55 dB** (głuche dudnienie), bas ucięty poniżej 49 Hz, dolot 9,2 s |
| przy cyplu Helu, 13,2 km | −29 dB, podobne stłumienie góry + **echo od stoku 0,2 s po dźwięku bezpośrednim** |

## Dźwięk: hydrofon łódki

Przycisk **„🔊 Włącz dźwięk”** (przeglądarka wymaga kliknięcia). Łódka słucha
hydrofonem na linie (`Q`/`E` w górę/w dół, suwak w panelu). **Każda ryba brzmi
ciągle, wszystkie naraz**; wysokość zależy od głębokości (oktawa niżej co 30 m).
Woda i dno Bałtyku kształtują to, co dociera do hydrofonu: opóźnienie ~0,69 s/km
i Doppler przy ruchu, wielokrotne odbicia dno–powierzchnia (dźwięk się przedłuża),
echa od stoków i brzegów (wraca jeszcze raz — w stronę Helu i brzegu, bo łowisko
leży w otwartej wodzie), pogłos zależny od dna i osadu oraz blokady: cień za
wzniesieniem, ląd i odcięcie płytkiej wody (niskie tony nie przechodzą przez płyciznę).
Skala zależy od dna pod łódką, tło morza — od głębokości hydrofonu.

**Laboratorium dźwięku:** [`sound-lab.html`](sound-lab.html) (`npm run dev` →
http://127.0.0.1:5173/sound-lab.html) — przekrój morza, przeciągane ryby i hydrofon,
**echogram** (wszystkie drogi dźwięku wybranej ryby: kiedy przychodzą i jak głośno),
suwaki, widmo, liczby. Ten sam silnik co w grze.

**Podgląd muzyczny:** [`music-roll.html`](music-roll.html) (`npm run dev` →
http://127.0.0.1:5173/music-roll.html) — piano-roll tego, co jest grane, jak w FL Studio:
oś pozioma to czas, pionowa to wysokość dźwięku, kolory to instrumenty (gatunki ryb
i mieszkańcy morza w pasie perkusji). Gdy w grze włączony jest dźwięk, podgląd
podłącza się na żywo (BroadcastChannel); bez gry gra demo na tych samych zasadach.

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
| `src/sound/acoustics.js` | model kanału: metoda źródeł pozornych, cień, odcięcie płytkiej wody, echa od terenu, pogłos (czyste funkcje) |
| `src/sound/music.js` | skale, wysokość z głębokości |
| `src/sound/engine.js` | silnik WebAudio: ciągłe głosy ryb przez linie opóźniające, pogłos (gra + laboratorium, też offline) |
| `src/sound/controller.js` | dźwięk w grze: panel, `Q`/`E`, lina hydrofonu w 3D |
| `src/life/` | mieszkańcy morza: symulacja siedlisk i ruchu + kropki w Three.js |
| `src/sound/life.js` | ich odgłosy: synteza zdarzeń + planowanie na siatce rytmu |
| `src/sound/dj.js`, `demoTrack.js` | panel DJ: podwodny głośnik i podkład demo |

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
