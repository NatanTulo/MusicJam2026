# Dźwięk morza — koncepcja i model

Łódka słucha morza hydrofonem opuszczonym na linie. **Każda ryba (czyli człowiek
z kamery) brzmi ciągle i wszystkie brzmią naraz.** O tym, co słychać, decyduje
droga dźwięku przez wodę: jak daleko jest ryba, jak się porusza, jakie jest dno
po drodze i wokół łódki oraz jak głęboko wisi hydrofon. Część dźwięków się
przedłuża, część odbija i wraca jeszcze raz, a część nie dociera wcale.

Do testowania: **`sound-lab.html`** (przekrój morza, przeciągane ryby, echogram,
widmo). W grze: panel „Dźwięk — hydrofon”, klawisze `Q`/`E`.

## Tor sygnału

```
 GŁOS RYBY (ciągły)            KANAŁ AKUSTYCZNY (model, co ~0,12 s)                     HYDROFON
 wysokość ← głębokość    ──>   opóźnienie τ = r/c  (zmiana τ w czasie = Doppler)         + tło morza
 barwa, puls ← gatunek         ├─ 4 najsilniejsze drogi: bezp., od powierzchni,          zależne od
 głośność ← ruch człowieka     │   od dna, wielokrotne — każda: +Δτ, znak, filtr          głębokości
                               ├─ 2 echa od terenu (stok, brzeg): +Δτ nawet sekundy     + echosonda
                               ├─ reszta dróg → wspólny pogłos słupa wody (T60)
                               └─ blokady: cień za grzbietem, ląd, odcięcie płytkiej wody
```

## 1. Głos ryby

| Cecha | Z czego | Wzór / wartość |
|---|---|---|
| **Wysokość** | głębokość ryby z | f₀ = 247 Hz · 2^(−z / 30 m), przyciągnięta do najbliższego dźwięku skali, z płynnym glissandem. 0 m ≈ C4 262 Hz · 15 m ≈ F3 175 Hz · 30 m ≈ C3 131 Hz · 60 m ≈ C2 65 Hz · ≥ 80 m → D1 37 Hz |
| **Skala** | dno pod łódką | < 35 m pentatonika durowa, 35–75 m mollowa, > 75 m in-sen (tonika D) |
| **Barwa** | gatunek | harmoniczne: szprot jasny, śledź fletowy, dorsz „chrząka” (bogate harmoniczne + puls 3 Hz), flądra miękki dron |
| **Puls i oddech** | gatunek + ruch | modulacja amplitudy (puls 0,8–7,5 Hz, szybszy przy ruchu) i powolne „oddychanie” 0,05–0,13 Hz — żeby ciągły dźwięk żył |
| **Głośność, jasność** | ruch człowieka (`excitement`) | poziom × (0,55 + 0,7·e), filtr barwy f₀ × jasność × (0,7 + 0,8·e) |

## 2. Kanał: metoda źródeł pozornych

Morze między rybą a hydrofonem traktujemy lokalnie jak **falowód**: warstwa wody
o głębokości D (średnia wzdłuż drogi) między miękką powierzchnią a dnem.
Każde odbicie zastępuje się „obrazem” źródła za lustrem — suma obrazów to
wszystkie drogi dźwięku.

**Obrazy** leżą na głębokościach zᵢ = 2nD ± z_s (n = …, −1, 0, 1, …):

| Obraz | odbić od dna n_d | odbić od powierzchni n_p |
|---|---|---|
| 2nD + z_s | \|n\| | \|n\| |
| 2nD − z_s, n ≥ 1 | n | n − 1 |
| 2nD − z_s, n ≤ 0 | \|n\| | \|n\| + 1 |

n = 0 z plusem to droga bezpośrednia; liczymy wszystkie drogi do rzędu 6 (n_d + n_p ≤ 6).

**Każda droga i** (R = odległość w poziomie, z_r = głębokość hydrofonu):

- długość rᵢ = √(R² + (zᵢ − z_r)²), kąt ślizgowy θᵢ = atan(|zᵢ − z_r| / R)
- opóźnienie τᵢ = rᵢ / c̄ (c̄ — średnia prędkość dźwięku na drodze)
- amplituda przy częstotliwości f:

  **Aᵢ(f) = (100 m / rᵢ) · R_s(f, θᵢ)^n_p · R_b(θᵢ)^n_d · 10^(−α(f)·rᵢ / 20 000) · Sᵢ(f)**

  | Człon | Model |
  |---|---|
  | R_s — powierzchnia | −exp(−2(kσ sin θ)²), k = 2πf/c, σ = Hs/4 ze stanu morza. **Znak minus: każde odbicie od powierzchni odwraca fazę.** Szorstka fala nie odbija wysokich tonów. |
  | R_b — dno | udział piasku z mapy EMODnet Geology (Seabed Substrate 250k, Folk→piasek), fallback: piasek (< 40 m): 0,85 poniżej kąta krytycznego 25°, 0,45 powyżej; muł (> 70 m): 0,18; pomiędzy płynnie. Raster: `npm run fetch:sediment` → `public/data/*.sediment.json`; w grze doczepiany do siatki (`attachSediment`), poza zasięgiem mapy wraca model z głębokości |
  | α — pochłanianie | Ainslie & McColm (1998), profil Bałtyku (T, S z głębokości), × „Pochłanianie ×” (domyślnie 20) |
  | S — cień | dyfrakcja na krawędzi (ITU-R P.526) na **prawdziwej łamanej** drogi: punkty odbić od dna leżą na rzeczywistym dnie, każdy odcinek sprawdzany z batymetrią. Strata rośnie ~3 dB/oktawę |

Drogi przychodzą gęsto (dziesiątki ms rozrzutu) i **sumują się w audio naprawdę,
z fazami**. Stąd bez osobnego kodu biorą się: wzmocnienie w płytkiej wodzie
(energia uwięziona między dnem a powierzchnią), filtr grzebieniowy
i **lustro Lloyda** (tuż pod powierzchnią dźwięk bezpośredni i odbity w przeciwfazie się znoszą).

### Kiedy dźwięk nie dociera wcale

| Blokada | Model | Efekt |
|---|---|---|
| **Ląd na drodze** | minimum głębokości na drodze < 0,5 m | wszystkie drogi = 0 (np. ryba za Mierzeją Helską) |
| **Odcięcie płytkiej wody** | falowód nie przenosi fal dłuższych niż ~4D: **f_c = 2,1·c / (4·D_min)** (piaszczyste dno, c_dna ≈ 1650 m/s); poniżej f_c fala zanika jak e^(−γr), γ = (2π/c)·√(f_c² − f²) | 25 m wody → poniżej ~30 Hz nic; 5 m → poniżej ~150 Hz nic. Głęboka, niska ryba za płycizną traci podstawę — słychać tylko wyższe harmoniczne albo nic |
| **Cień za grzbietem** | S(f) powyżej | wysokie tony ucięte, niskie przechodzą. > 30 dB = droga uznana za zablokowaną |
| **Za cicho** | droga < −100 dB albo ryba poza 14 najgłośniejszymi | pomijana |

## 3. Echa od terenu

Stoki, mielizny i brzegi odbijają dźwięk z powrotem — to są echa, które
**przychodzą jeszcze raz, nawet po kilku sekundach**.

1. **Skan ścian** (przy każdym przesunięciu łódki o ~60 m): 36 promieni poziomych
   z hydrofonu do 4,5 km. Ściana = pierwszy punkt, gdzie woda robi się płytsza niż
   55 % głębokości pod łódką. Normalna ściany n = ∇D/|∇D| (w stronę głębszej wody).
   Siła odbicia: ląd 0,85; stok 0,15 + 0,7·min(1, nachylenie / 5 %) — łagodny stok
   rozprasza, stromy odbija.
2. **Echo ryby od ściany** (ściana = lustro, obraz ryby za ścianą):
   - kierunkowość: w = 0,85·cos⁸(odchyłki od odbicia lustrzanego) + 0,15·(rozpraszanie Lamberta),
     dźwięk musi lecieć w stronę ściany,
   - droga L = |ryba → P| + |P → hydrofon|, opóźnienie L/c,
   - **energia echa = energia całego falowodu na rozwiniętej drodze L** (wszystkie
     odbicia dno–powierzchnia po drodze, z sumy obrazów powyżej) × siła ściany × w,
   - cień sprawdzany na obu ramionach drogi.
3. Dwa najsilniejsze echa na rybę dostają własne linie opóźniające i **własny
   kierunek w stereo** — echo przychodzi od strony ściany, nie ryby.

Na prawdziwej batymetrii Zatoki Gdańskiej (głębokość hydrofonu 10 m):

| Miejsce | Dno | Ściany w zasięgu | Najbliższa |
|---|---|---|---|
| start łódki 54,52°N 18,95°E | 65 m | 0 | — (otwarta woda, łagodne dno) |
| stok SW łowiska 54,49°N 18,88°E | 44 m | 0 | — |
| bliżej Gdańska 54,47°N 18,80°E | 24 m | 3 | 2,6 km, stok (odbija 34 %) |
| przy brzegu 54,43°N 18,90°E | 32 m | 8 | 2,5 km, stok (38 %) |
| **przy cyplu Helu** 54,62°N 18,84°E | 36 m | 14 | **0,3 km, stromy stok (85 %)** |

Łowisko leży w otwartej wodzie, więc **ech od terenu trzeba szukać, płynąc łódką
w stronę Helu albo brzegu**. W laboratorium: profil „Brzeg 3 km od łódki”.

## 4. Pogłos słupa wody (przedłużanie)

Drogi wielokrotnych odbić, które nie zmieściły się w 4 osobnych liniach, idą do
wspólnego pogłosu (energia się zgadza: √Σ Aᵢ²). Jego długość liczymy z dna
pod łódką:

- promień pod kątem θ ≈ 12° odbija się od pary dno + powierzchnia co **Δt = 2D / (c·sin θ)**
  i traci **L = −20·log₁₀|R_s·R_b|** dB,
- więc zanika z szybkością L/Δt dB/s i **T60 = 60·Δt / L** (ograniczone do 0,6–5 s),
- wysokie tony: to samo z R_s przy 4 kHz — przy wzburzonym morzu gasną szybciej,
- **trzepotanie**: pionowe odbicia dno–powierzchnia co 2D/c, słabnące o |R_s·R_b| na
  obieg — w płytkiej wodzie słychać je jako szybkie powtórzenia.

| Dno pod łódką | T60 | Trzepotanie |
|---|---|---|
| płycizna, piasek 20 m | 5,0 s | co 27 ms × 0,43 |
| start łódki 65 m (głównie muł) | 2,4 s | co 90 ms × 0,21 |
| Głębia Gdańska 105 m, muł | 2,8 s | co 146 ms × 0,17 |

Odpowiedź impulsową pogłosu buduje silnik (szum z zanikiem T60 w dwóch pasmach +
impulsy trzepotania) i podmienia płynnie, gdy łódka zmienia miejsce.

## 5. Od modelu do dźwięku (graf WebAudio)

| Element modelu | Węzeł audio |
|---|---|
| najwcześniejsza droga τ_min | linia opóźniająca (do 6 s ≈ 8,5 km). **Jej zmiana w czasie to Doppler** — ograniczony do 2 % (suwak), bo ryby w grze pływają symbolicznie szybko |
| 4 najsilniejsze drogi | +Δτ (do 1 s), wzmocnienie ze znakiem (faza!), filtr dolnoprzepustowy dopasowany do Aᵢ(f) (poziom przy f₀ + punkt −3 dB) |
| 2 echa od terenu | +Δτ (do 4,6 s), filtr, poziom, własne ITD od strony ściany (fala płaska) |
| reszta dróg | wysyłka do pogłosu (splot, dwa bufory na zmianę) |
| odcięcie płytkiej wody | filtr górnoprzepustowy na f_c |
| kierunek do ryby | **hydrofon stereo**: dwa uszy na wysięgnikach (rozstaw suwakiem, domyślnie 3 m) — prawdziwe ITD (max ~2 ms) + ILD z geometrii (`stereoCues`); przy rozstawie 0 wraca panorama. Odbicia wielokrotne dzielą ITD drogi bezpośredniej (przybliżenie), echa liczą własne |

Kanał przeliczany jest ~8 razy/s, a wszystkie parametry w audio zmieniają się płynnie.
Nagłe skoki (np. nowa ściana) robimy przez krótkie wyciszenie, żeby nie „wyło”.

## Tło: mieszkańcy morza

Wokół łódki zawsze pływa kilkaset drobnych stworzeń (`src/life/`). Co jakiś czas
każde „odzywa się" krótkim zdarzeniem; zdarzenie jest syntetyzowane do bufora i puszczane
przez **ten sam model kanału** (3 najsilniejsze drogi + echo od terenu + pogłos).

| Stworzenie | Synteza | Jak często | Rola |
|---|---|---|---|
| meduza | pad: podstawa + oktawa + rozstrojenie, pulsuje jak skurcz dzwonu (5–8 s) | 8–15 s | harmonia |
| morświn | seria 8–22 kliknięć, coraz gęstsza (echolokacja; prawdziwe ~130 kHz, tu 2–4 kHz) | 3–7 s | rytm |
| foka szara | harmoniczne z formantem (480 i 1150 Hz), zjazd wysokości + wibrato | 7–15 s | melodia |
| babka bycza | 3–6 stuków: tłumiony sinus ze spadkiem wysokości, szesnastki | 3–7 s | perkusja |
| ławica szprota | arpeggio dzwoneczków w górę skali + szum ruchu wody | 2,5–5 s | migotanie |
| plankton | pojedyncza iskierka 3–6 kHz, tylko bliżej niż 900 m | 1,5–4 s | faktura |

Momenty odezwania się są wyrównane do siatki ósemek (84 BPM) — tło ma puls, a woda
rozsuwa je potem w czasie (dalsze stworzenia się spóźniają). Wysokości: ta sama zasada
co u ryb (głębiej = niżej), przyciągnięte do skali wyznaczonej przez dno pod łódką.
Odzywają się tylko najbliższe osobniki liczniejszych gatunków (np. 8 meduz, 6 planktonów).

## Panel DJ: muzyka puszczona spod wody

Podwodny głośnik (`src/sound/dj.js`) to zwykłe źródło w tym samym torze co ryba,
tylko zamiast oscylatora ma bufor z muzyką: demo generowane w kodzie albo plik użytkownika.
Linia opóźniająca ma tu 20 s (≈ 29 km), bo głośnik może stać daleko. Suwak
„na lądzie ↔ na statku" miesza oryginał z sygnałem po przejściu przez morze
(równa moc, `cos`/`sin`). Ściany do ech szukane są wokół **łódki i wokół głośnika** —
głośnik postawiony pod klifem ma echo od tego klifu.

Zmierzone (szum różowy zamiast muzyki, żeby widmo było porównywalne; analizator bez wygładzania):

| Głośnik | Poziom | 600 Hz–2 kHz | 2–5 kHz | 5–12 kHz | Uwagi |
|---|---|---|---|---|---|
| 1 km, woda 65 m | −4 dB | −2,3 | +0,5 | −2,4 | praktycznie oryginał, dolot 0,68 s |
| płycizna 3 m, 13,6 km | −24 dB | −6,3 | **−31,5** | **−54,7** | bas ucięty < 49 Hz, dolot 9,2 s |
| przy cyplu Helu, 13,2 km | −29 dB | −6,3 | −27,7 | −45,4 | echo od stoku 0,2 s po dźwięku wprost |

(Wartości widma względem oryginału, odniesienie 150–600 Hz. Mierzone przed hydrofonem
stereo i mapą osadu, w grze — po zmianach do potwierdzenia na ucho.)

## Brzmienie na różnych głębokościach hydrofonu

| Hydrofon | Co słychać | Dlaczego |
|---|---|---|
| **0–5 m** | głośne, jasne fale, szum „oddycha” w rytmie falowania, pęcherzyki; ryby ciche i cienkie | lustro Lloyda: odbicie od powierzchni w przeciwfazie |
| **10–30 m** | fale ciemnieją i cichną, ryby najpełniejsze | lustro Lloyda już nie działa |
| **przy dnie** | dudnienie głębin, syk osadu, flądry i dorsze blisko | falowanie nie dociera, krótkie drogi przez dno |

## Pomiary

Render offline z laboratorium (determinystyczny: `renderOffline` domyślnie sieje los
seedem 7, więc powtórzenie daje bit-identyczny wynik; powtórzysz w konsoli:
`await soundLab.renderOffline({ depth: 5, seconds: 8, fishUntil: 3 })`).
Wiersze z samymi rybami liczone z wyłączonym tłem
(`layers: { surface: false, bubbles: false, deep: false, bottom: false, engine: false, ping: false, life: false }`).

| Co | Wynik |
|---|---|
| **Wszystkie ryby naraz, ciągle** (4 ryby, profil slope, hydrofon 10 m) | pełna mieszanka: okna 100 ms −30,9…−24,5 dB, RMS −28,5 dB, centroid ~290 Hz; same ryby: −32,0…−24,9 dB. Wahania większe niż w starym silniku (puls i oddech głosów, bąbelki) |
| **Głębiej = niżej** (wszystkie ryby na 8 m vs 70 m, Głębia) | środek widma 283 Hz vs 110 Hz |
| **Przedłużanie** — wybrzmiewanie po zniknięciu ryby (+0,5 / +1 / +2 s; bliskie ryby 200 m, inaczej 6 s drenażu linii opóźniających maskuje ogon) | płycizna, piasek 14 m: −3,4 / −1,6 / −16,2 dB; Głębia, muł 105 m: −8,2 / −17,2 / −35,1 dB. Piasek trzyma dźwięk ~19 dB dłużej przy +2 s |
| **Echo od brzegu** (profil coast, dorsz 300 m od łódki, ściana ~2,7 km) | model planuje echo +3,25 s / −29 dB; zmierzone bez pogłosu: +19 dB nad drenażem (−57,3 vs −76,7 dB); **z pogłosem echo ginie w ogonie** (+0,2 dB) — do strojenia suwakami pogłos/echo |
| **Lustro Lloyda** (tylko ryby, Głębia) | dalekie ryby labowe (700 m+): ~1 dB (1,5 m: −46,5 vs 30 m: −45,7 dB); **bliska ryba 100 m: ~10 dB** (−36,3 vs −25,9 dB). Model koherentny dalej daje ~15 dB @500 Hz, ale w audio null zakopuje multipath i szerokie pasmo głosów — dołek zależy od dystansu, nie tylko od głębokości hydrofonu. Stereo 0 vs 3 m w geometrii labu (ryby na wprost): 0,0 dB |
| W grze z detekcją (nagranie testowe) | brzmi 5–14 ryb naraz, Doppler od ruchu ≤ 0,4 %, pogłos 2,4 s przy starcie |
| Tło mieszkańców morza | ~240 stworzeń wokół łódki, 25–35 odezwań na 10 s (meduzy, ławice, plankton, morświny, foki) |
| Koszt | 8 s audio (4 ryby, pełny model) renderuje się w 0,8 s na laptopie |

Testy modelu: `npm test` (25 testów, m.in. geometria obrazów, znaki faz, odcięcie,
ląd, echo od brzegu z właściwym opóźnieniem, T60, wysokość z głębokości,
mapowanie Folk→piasek, ITD z geometrii vs fala płaska).

## Uproszczenia

- **Promienie proste** w każdym odcinku. Letni spadek c pod termokliną zagina dźwięk
  w dół i tworzy strefy cienia przy powierzchni — tego nie ma (następny krok: ray tracing).
- **Osad tylko 250k i tylko detal** (Zatoka + polskie wybrzeże): pełny Bałtyk i miejsca
  bez danych w EMODnet wracają do zgadywania z głębokości; żwir i skała liczone jak
  piasek (twardość obcięta do 1,0).
- **Stereo przybliżone**: ITD/ILD tylko dla drogi bezpośredniej (dokładnie) i ech
  (fala płaska); odbicia wielokrotne dzielą ITD bezpośredniej. Pęcherzyki i ping
  zostają mono z losową panoramą (dźwięki rozproszone).
- **Falowód lokalnie płaski** (D = średnia na drodze); zmienność dna uwzględniamy przez
  cień na prawdziwej łamanej, odcięcie z minimum głębokości i echa od ścian.
- **Echa: jedno odbicie od ściany**, bez ech wielokrotnych między ścianami.
- **Pochłanianie wzmocnione 20×** (na mapie o skali km inaczej niesłyszalne).
- **Doppler ograniczony do 2 %** — pełny przy symbolicznych prędkościach ryb dawałby wycie.
- **Echosonda gra w paśmie słyszalnym** (D6); prawdziwe pracują na 50–200 kHz.
- **Tło morza to model artystyczny** oparty na zjawiskach (Knudsen, zanik ruchu
  orbitalnego fal e^(−2πh/λ), rezonans pęcherzyków Minnaerta), poziomy dobrane liczbowo,
  **jeszcze nie na ucho** — potrzebny odsłuch na słuchawkach.
- Bałtyk nie ma krewetek pistoletowych, więc przy dnie słychać osad i prąd.

## Co dalej (pomysły)

- Ray tracing w profilu c(z): letnia strefa cienia przy powierzchni.
- Głębokość ryby sterowana przez człowieka (np. przysiad = zanurzenie).
- Wejście z mikrofonu do panelu DJ (przez ten sam ChannelChain co plik/demo).
