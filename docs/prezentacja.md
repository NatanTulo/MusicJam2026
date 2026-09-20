# Prezentacja — 5 minut na scenie + pytania

Plan wystąpienia dla MusicJam2026. Format: scena, projektor, dźwięk z sali,
~5 min i runda pytań.

## Jedno zdanie, które ma zostać w głowie

> **Publiczność gra na morzu: człowiek przed kamerą staje się rybą, ryba śpiewa
> pod wodą, a muszelki tańczą do tego, co słychać.**

Wszystko inne w tej prezentacji jest dowodem na to zdanie. Jeśli zabraknie
czasu, ucinasz szczegóły techniczne, nie to zdanie — powtórz je na początku i na końcu.

## Trzy akcenty (i nic więcej)

Pięć minut wystarcza na trzy rzeczy. Te trzy:

| # | Akcent | Dlaczego ten | Jak to sprzedać w jednym zdaniu |
|---|---|---|---|
| 1 | **Morze jest prawdziwe** | Odróżnia projekt od „ładnej grafiki 3D”. Jury lubi, gdy coś jest zakotwiczone w rzeczywistości. | „To nie jest wymyślone dno — to Bałtyk zmierzony sonarami, dane EMODnet, ~115 m na komórkę.” |
| 2 | **Dźwięk jest fizyką, nie efektem** | To jest serce projektu i najtrudniejsza część. Tu robicie coś, czego inni nie robią. | „Nie nakładamy pogłosu z presetu — liczymy, jak dźwięk faktycznie idzie przez wodę: odbicia od dna i powierzchni, opóźnienia, echa od stoku, cień za grzbietem.” |
| 3 | **Pętla się domyka w materii** | Muszelki to moment „ooo” — projekt wychodzi z ekranu w świat fizyczny. | „Ten sam sygnał, który słyszycie, rusza muszelkami: jest bit — tańczą w rytm, nie ma bitu — kołyszą się płynnie.” |

Kolejność nie jest przypadkowa: **prawdziwe → słyszalne → dotykalne.** Każdy
kolejny akcent jest bardziej namacalny niż poprzedni, więc uwaga sali rośnie, a nie opada.

## Minutnik

| Czas | Co się dzieje | Co mówisz |
|---|---|---|
| **0:00–0:20** | Cisza, potem dźwięk morza z sali. Ekran: morze, jeszcze bez ryb. | Nic nie mów przez pierwsze ~5 sekund. Potem: „To, co słyszycie, to dno Bałtyku i kilka ryb. Za chwilę te ryby to będziecie wy.” |
| **0:20–1:00** | Slajd/ekran: kamera + podgląd detekcji obok morza. | Zdanie-klucz (wyżej). Skąd pomysł: morze słychać tylko hydrofonem, ludzie nigdy go nie słyszeli. My dajemy ucho pod wodę. |
| **1:00–3:00** | **DEMO NA ŻYWO** — patrz scenariusz niżej. | Prowadź narracją, nie klikaniem. Mów, co się zaraz stanie, zanim to zrobisz. |
| **3:00–4:00** | Akcent 2: jak działa dźwięk. Jeden obrazek: tor sygnału z `docs/dzwiek.md`. | Głębokość → wysokość dźwięku. Odległość → opóźnienie i barwa. Dno → echa. Ruch → Doppler. Cztery zdania, po jednym na rzecz. |
| **4:00–4:40** | Muszelki: pokaż je (na żywo albo film 20 s). | Akcent 3. Amplituda i rytm z tego samego sygnału. |
| **4:40–5:00** | Wracasz do zdania-klucza. Co dalej: kamera na Raspberry Pi 5, instalacja na cały wieczór. | „Chcemy to postawić tak, żeby ktoś wszedł do sali, a morze o nim zaśpiewało.” |

Zostaw **15 sekund luzu** — demo zawsze zjada więcej, niż myślisz.

## Scenariusz demo (2 minuty, wyćwiczyć co do kliknięcia)

Stan startowy **przed** wyjściem na scenę: oba terminale już chodzą, przeglądarka
otwarta na `http://127.0.0.1:5173`, dźwięk włączony i sprawdzony, kamera wyceluje
w miejsce, gdzie staniesz. Nigdy nie uruchamiaj tego przy widowni.

1. **„Widzicie dno.”** — kamera swobodna nad Zatoką Gdańską, widać ukształtowanie.
   Jedno zdanie o EMODnet. *(15 s)*
2. **„A teraz wchodzę w kadr.”** — wchodzisz przed kamerę. Na ekranie pojawia się
   ryba. Poruszasz się — ryba płynie za tobą. *(25 s)*
   To jest najmocniejsze 25 sekund całej prezentacji. Nie streszczaj go słowami, daj sali popatrzeć.
3. **„I ona śpiewa.”** — „Włącz dźwięk”. Kucasz / wstajesz albo opuszczasz hydrofon
   klawiszami `Q`/`E` — wysokość dźwięku wyraźnie się zmienia. *(30 s)*
   Powiedz wprost, czego słuchać: „im głębiej, tym niżej”. Ludzie nie usłyszą zależności, jeśli im jej nie nazwiesz.
4. **„Wchodzi druga osoba.”** — ktoś z zespołu wchodzi w kadr. Druga ryba, drugi
   głos, brzmi razem. *(20 s)*
   Tu pada zdanie: „Każdy człowiek to osobny, ciągły głos. Sala z dwudziestoma osobami gra dwudziestogłosowo.”
5. **„A teraz spójrzcie na muszelki.”** — przejście na instalację. *(30 s)*

### Plan B (ćwicz go tak samo jak plan A)

| Co pada | Co robisz | Co mówisz |
|---|---|---|
| Kamera / detekcja | `http://127.0.0.1:5173/?demo=1` — morze z rybami bez kamery | „Puszczam tryb demo, ryby są symulowane — reszta jest identyczna.” |
| Dźwięk z sali | Opowiadaj przy `sound-lab.html` (przekrój morza, echogram) | Laboratorium pokazuje model *widzialnie* — to działa nawet bez głośników. |
| Cała przeglądarka | Klip 30 s nagrany wcześniej, odtwarzany z pliku | „Mam to nagrane, pokażę wam z dysku.” |
| Muszelki | Film 20 s z telefonu | Nagraj go **dzień wcześniej**, nie licz na to, że nie będzie potrzebny. |

Zasada: **nigdy nie debuguj na scenie.** Jedno zdanie, przełączasz na plan B, mówisz dalej.
Sala wybacza awarię, nie wybacza dwóch minut ciszy i klikania w terminalu.

## Jak tłumaczyć dźwięk (akcent 2) bez wykładu

Masz na to 60 sekund, więc nie tłumacz modelu — pokaż **cztery zależności**, każda
jedno zdanie, najlepiej przy jednym obrazku (tor sygnału z [`dzwiek.md`](../web_visualization/docs/dzwiek.md)):

- **Głębokość → wysokość.** Ryba przy powierzchni śpiewa wysoko, przy dnie nisko. Dno decyduje o skali.
- **Odległość → opóźnienie i barwa.** Woda zjada wysokie częstotliwości, więc dalekie ryby są głuche i przychodzą później.
- **Dno → echa.** Dźwięk odbija się od stoku i wraca jeszcze raz, czasem po sekundach. Za grzbietem jest cień akustyczny — ryby nie słychać wcale.
- **Ruch człowieka → Doppler i energia.** Machasz rękami, ryba się podnieca, głos rośnie i się przestraja.

Zdanie, które warto powiedzieć dosłownie:

> „Nie ma tu ani jednego sampla morza. Każdy dźwięk jest policzony z tego, gdzie
> jest ryba, gdzie jest hydrofon i jakie jest dno między nimi.”

Jeśli ktoś dopyta o metodę — masz w zanadrzu: źródła pozorne, cztery najsilniejsze
drogi, pogłos słupa wody jako reszta. Ale **sam z siebie tego nie mów.**

## Jak mówić o muszelkach

Nie mów „muszelki reagują na muzykę” — to brzmi jak dowolny wizualizator z lat 90.
Powiedz, **skąd** bierze się ta muzyka:

> „To nie jest playlista. To śpiew ludzi, którzy stoją przed kamerą, przepuszczony
> przez wodę. Muszelki tańczą do amplitudy i do rytmu: jak w sygnale jest bit,
> wchodzą w rytm; jak bitu nie ma — kołyszą się płynnie, jak przy dnie.”

To jest moment na wyciągnięcie pętli: **człowiek → ryba → dźwięk → ruch materii → człowiek patrzy.**
Jedno zdanie, po nim pauza. Nie dopowiadaj.

## Czego NIE mówić ze sceny

Wszystko poniżej jest ciekawe i wszystko zabija 5-minutową prezentację. Trzymaj w zanadrzu na pytania:

- architektura wątków, kolejki, SSE, port 8765,
- NanoDet vs YOLOX, progi `--score`, tracking po IoU,
- struktura repo, gałęzie, merge, co z czego portowaliście,
- licencje danych i formaty plików (chyba że ktoś pyta wprost),
- wykaz bibliotek („użyliśmy Three.js i WebAudio” wystarczy — nikt nie przyszedł po listę zależności),
- rzeczy, których jeszcze nie ma, opowiadane w czasie teraźniejszym. Mów „chcemy”, nie „mamy”.

## Bank pytań (przygotuj odpowiedzi po 2 zdania)

| Pytanie | Rdzeń odpowiedzi |
|---|---|
| To działa w czasie rzeczywistym? | Tak. Detekcja ~12 razy na sekundę, obraz 60 fps, dźwięk przeliczany co ~0,12 s. Opóźnienie kamera→ryba ok. 40 ms. |
| Na czym to chodzi? | Teraz laptop. Docelowo Raspberry Pi 5 z kamerą — model detekcji jest dobrany pod RPi, mieści się w ~10–15 Hz. |
| Skąd dane o dnie? | EMODnet DTM 2024 — kompilacja pomiarów sonarowych ze statków. Nie satelity: woda pochłania światło, głębokości mierzy się echem. |
| Ile osób naraz? | Testowane na 13 osobach w kadrze. Każda dostaje własny głos; miks robi model akustyczny, bo dalekie ryby są ciche z fizyki, nie z limitu. |
| Co, jak ktoś wyjdzie i wróci? | Dostaje nową rybę — nie rozpoznajemy tożsamości. Świadoma decyzja: re-ID kosztuje CPU, którego na RPi nie ma za darmo. |
| Dźwięk jest generowany czy to sample? | W całości generowany w WebAudio. Zero nagrań morza. |
| Co jest wasze, a co z biblioteki? | Three.js rysuje, WebAudio gra, NanoDet wykrywa ludzi. Nasze jest: model akustyczny, mapowanie człowiek→ryba→głos i cała integracja. |
| Dlaczego Bałtyk? | Bo to nasze morze i bo ma świetną batymetrię — Głębia Gdańska, Mierzeja, stok. Słychać różnicę między płycizną a głębią. |
| Co dalej? | Instalacja na cały wieczór: kamera nad przestrzenią, projekcja na ścianie, muszelki na środku. |

## Podział ról (zespół 2–3 osoby)

- **Mówca** — mówi i tylko mówi. Nie dotyka klawiatury.
- **Operator** — klika, pilnuje dźwięku, odpala plan B bez pytania mówcy o zgodę.
- **Trzecia osoba** — wchodzi w kadr jako druga ryba w punkcie 4 demo, potem stoi przy muszelkach.

Jeśli jesteście we dwoje: mówca wchodzi w kadr sam, operator robi drugą rybę.

## Checklista na 15 minut przed wejściem

- [ ] `python serve.py` chodzi, `npm run dev` chodzi, przeglądarka odświeżona
- [ ] Dźwięk **przetestowany na głośnikach sali**, nie na laptopie. Poziom ustawiony przy dwóch rybach, nie przy jednej
- [ ] Kamera wyceluje tam, gdzie staniesz; sprawdź światło — pod ostrym kontrem detekcja siada
- [ ] Przeglądarka: pełny ekran, powiadomienia wyłączone, zakładki zamknięte, `?demo=1` otwarte w drugiej karcie
- [ ] Klip zapasowy i film z muszelkami na pulpicie, nie w chmurze
- [ ] Laptop w zasilaniu, wygaszacz wyłączony
- [ ] Muszelki zasilone i sparowane, sprawdzone przy tej samej głośności, co demo

## Wersja na wypadek skrócenia do 2 minut

Zdarza się, że czas się sypie i moderator daje znak. Wtedy zostaje:

1. Zdanie-klucz. *(10 s)*
2. Wejście w kadr + ryba + dźwięk. *(60 s)*
3. Muszelki. *(30 s)*
4. Zdanie-klucz jeszcze raz + „chcemy z tego zrobić instalację na cały wieczór”. *(20 s)*

Wytnij dno, wytnij model akustyczny, wytnij plany. Demo i pętla — to wystarczy.
