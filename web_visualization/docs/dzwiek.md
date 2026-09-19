# Dźwięk morza — koncepcja i model

Łódka słucha morza hydrofonem opuszczonym na linie. Ryby (czyli ludzie z kamery)
grają nuty, a woda i dno kształtują to, co dociera do hydrofonu. Ta sama muzyka
brzmi więc inaczej zależnie od tego, **gdzie jest łódka**, **jak głęboko wisi hydrofon**
i **jakie jest dno między rybą a łódką**.

Do testowania: **`sound-lab.html`** (laboratorium — przekrój morza, przeciągane ryby,
suwak głębokości, widmo). W grze: panel „Dźwięk — hydrofon”, klawisze `Q`/`E`.

## Tor sygnału

```
 RYBA                         WODA I DNO                                HYDROFON
 gatunek -> rejestr, barwa    3 drogi dźwięku, każda osobno:            tło morza zależne
 głębokość -> nuta            ├─ bezpośrednia  (+ cień za grzbietem)    od głębokości:
 ruch człowieka -> rytm       ├─ od powierzchni (odwrócona faza,        fale, pęcherzyki,
 pozycja -> stereo            │   szorstkość fal)                        głębiny, dno, silnik
                              └─ od dna (piasek/muł, kąt krytyczny)     + echosonda łódki
                              opóźnienie = droga / c(z)
                              tłumienie = rozchodzenie + pochłanianie(f)
```

Wszystko jest liczone dla każdej nuty osobno, w chwili jej wydania. Nuta z ryby
oddalonej o 5 km dociera po ~3,4 s i jest to nuta, którą ryba zagrała 3,4 s temu.

## Co od czego zależy

| Wejście | Co zmienia w dźwięku | Gdzie w kodzie |
|---|---|---|
| **Gatunek ryby** (stały dla osoby) | rejestr i barwa: szprot wysoko i jasno, śledź w środku, dorsz nisko („chrząka” — prawdziwe dorsze to robią), flądra najniżej, długi dron | `src/fish/species.js` |
| **Głębokość ryby** w jej warstwie wody | wysokość nuty: głębiej = niżej (stopień skali) | `pitchFor` w `src/sound/music.js` |
| **Ruch człowieka** (`excitement`) | gęstość rytmu: więcej uderzeń w takcie; ryba wypływa wyżej w swojej warstwie, więc gra też wyżej | `music.js`, `fishSim.js` |
| **Dno pod łódką** | skala całej muzyki: <35 m dur pentatonika, 35–75 m moll, >75 m in-sen; echo echosondy po 2D/c | `modeForSeabed`, `_ping` |
| **Odległość ryba → hydrofon** | opóźnienie, głośność, jasność (woda zjada wysokie tony) | `propagate` w `acoustics.js` |
| **Kierunek do ryby** względem dziobu | panorama stereo (prawa burta = prawy kanał) | `_maybeNote` |
| **Dno między rybą a łódką** | grzbiet zasłania drogę bezpośrednią: ciszej i ciemniej; typ osadu decyduje o sile echa od dna | `worstObstacle`, `bottomReflection` |
| **Głębokość hydrofonu** | cały charakter tła + lustro Lloyda (patrz niżej) | `ambientLevels`, `propagate` |
| **Stan morza** (0–6) | głośność i „oddech” fal, liczba pęcherzyków, szorstkość powierzchni (echo od powierzchni traci wysokie tony) | `seaStateInfo` |

## Fizyka (co jest prawdziwe, co uproszczone)

| Zjawisko | Model | Źródło / uwagi |
|---|---|---|
| Profil wody | Zatoka Gdańska latem: 17°C nad termokliną (~22 m), ~5°C niżej, haloklina ~70 m (7 → 12 PSU) | typowy letni profil Bałtyku |
| Prędkość dźwięku | Coppens (1981) — działa dla S = 0–45 PSU, więc i dla słonawego Bałtyku (wzór Mackenziego nie) | 1480 m/s przy powierzchni, 1437 m/s pod termokliną |
| Pochłanianie | Ainslie & McColm (1998): kwas borowy + MgSO₄ + woda. W Bałtyku (S≈7) człony solne są ~5× słabsze niż w oceanie | test: 0,06 dB/km @1 kHz, 1 dB/km @10 kHz dla oceanu |
| Rozchodzenie | sferyczne 20 log r do odległości ≈ głębokości wody, dalej cylindryczne 10 log r („uwięzienie” między dnem a powierzchnią) | płytkie morze niesie dźwięk dalej |
| Odbicie od powierzchni | współczynnik −1 (odwrócenie fazy) × exp(−2(kσ sin θ)²) — Rayleigh, σ = Hs/4 ze stanu morza | przy wzburzonym morzu wysokie tony nie wracają |
| Odbicie od dna | piasek (<40 m): 0,85 poniżej kąta krytycznego 25°, 0,45 powyżej; muł (>70 m, Głębia Gdańska): 0,18 | uproszczenie: osad z głębokości |
| Cień za wzniesieniem | dyfrakcja na krawędzi (ITU-R P.526), parametr Fresnela z najgorszego punktu dna na promieniu | strata rośnie ~3 dB/oktawę: z grzbietu słychać ciemny dźwięk |
| Opóźnienie | droga / średnie c na drodze | ~0,69 s na km |
| Interferencja | każda droga to osobna kopia nuty z własnym opóźnieniem i znakiem — sumują się naprawdę w audio | stąd lustro Lloyda „za darmo” |

**Uproszczenia, które warto znać:**
- **Promienie proste.** Latem Bałtyk ma silny spadek c pod termokliną, który zagina
  dźwięk w dół i tworzy strefy cienia przy powierzchni. Tego nie ma — następny krok
  to śledzenie promieni (ray tracing) albo model modów.
- **Dno do odbicia jest płaskie** (głębokość w połowie drogi), a cień liczymy tylko
  dla drogi bezpośredniej.
- **Pochłanianie jest wzmocnione 20×** (suwak „Pochłanianie ×”, 1 = fizycznie).
  Łowisko ma kilka km, a w paśmie słyszalnym ten efekt robi różnicę dopiero na
  dziesiątkach km. Bez wzmocnienia daleka ryba byłaby tylko cichsza, nie ciemniejsza.
- **Brak Dopplera.** Ryba płynąca 1 m/s zmienia wysokość o ~1 cent — niesłyszalne.
  (Ryby w grze pływają symbolicznie szybko, bo gonią ludzi po kilometrowej mapie —
  Doppler od tej prędkości byłby artefaktem mapowania, nie fizyką.)
- **Echosonda gra w paśmie słyszalnym** (D6). Prawdziwe pracują na 50–200 kHz.
- **Tło morza to model artystyczny** oparty na zjawiskach (Knudsen: +~3 dB na stopień
  stanu morza; ruch orbitalny fal zanika jak e^(−2πh/λ); pęcherzyki mają rezonans
  Minnaerta f ≈ 3,26/R kHz·mm), ale poziomy są dobrane na ucho, nie zmierzone.
- Bałtyk nie ma krewetek pistoletowych (za zimno i za mało soli), więc przy dnie
  słychać osad i prąd, a nie typowe dla ciepłych mórz trzaski.

## Brzmienie na różnych głębokościach

| Hydrofon | Co słychać | Dlaczego |
|---|---|---|
| **0–5 m** | głośne, jasne fale, szum „oddycha” w rytmie falowania, pęcherzyki; ryby ciche i cienkie | echo od powierzchni przychodzi prawie razem z dźwiękiem bezpośrednim, w przeciwfazie, i je wygasza (**lustro Lloyda**) |
| **10–30 m** | fale ciemnieją i cichną, ryby najpełniejsze | lustro Lloyda już nie działa, szum powierzchni daleko |
| **przy dnie** | dudnienie głębin, syk osadu, echo od dna prawie bez opóźnienia, flądry i dorsze blisko | falowanie tu nie dociera, drogi przez dno są krótkie |

Zmierzone (render offline z laboratorium, ten sam los w każdym wariancie):

| Pomiar | Wynik |
|---|---|
| tło, dno 25 m, stan morza 3: hydrofon 1 → 5 → 12 → 24 m | RMS −34,5 → −38,1 → −41,0 → −42,3 dB; środek widma 1236 → 768 → 426 → 317 Hz; „oddech” 0,41 → 0,29 → 0,19 → 0,17 |
| same ryby, Głębia 105 m: hydrofon 1,5 → 8 → 30 m | RMS −52,7 → −44,1 → −36,2 dB (lustro Lloyda: 16 dB ciszej przy powierzchni) |
| sam dorsz, dno płaskie 70 m vs grzbiet 16 m w połowie drogi | −43,3 → −55,4 dB; pasmo 1–4 kHz traci 15 dB, 200 Hz–1 kHz 12 dB (za grzbietem ciemniej) |

Pomiary powtórzysz w konsoli laboratorium:
`await soundLab.renderOffline({ depth: 5, seconds: 8, seaState: 3 })`.

## Wydajność

Każda nuta to 1 oscylator na drogę (harmoniczne w jednym `PeriodicWave`, każda
tłumiona osobno), więc ~3 oscylatory na nutę. Silnik pilnuje limitu 110 dróg brzmiących
jednocześnie i nie tworzy węzłów dla dróg cichszych niż −70 dB. Przy ~15 rybach
w grze brzmi naraz ~20–40 dróg. Tło to 4 zapętlone bufory szumu + 2 oscylatory
silnika — stały, mały koszt.

## Co dalej (pomysły)

- Refrakcja w profilu c(z) (ray tracing) — letnia strefa cienia przy powierzchni i jesienny kanał dźwiękowy.
- Dno z prawdziwego osadu (mapy osadów EMODnet Geology) zamiast zgadywania z głębokości.
- Hydrofon stereo (dwa na wysięgnikach): różnica czasu dojścia daje prawdziwą przestrzeń zamiast panoramy.
- Głębokość ryby sterowana przez człowieka, np. przysiad = zanurzenie (z wysokości bboxa względem oczekiwanej).
