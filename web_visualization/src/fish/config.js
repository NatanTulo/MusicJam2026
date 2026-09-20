// Ustawienia ryb w morzu. Wartości z URL (?fish=..., ?demo=1) nadpisują domyślne.
const QRY = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
const HOST = (typeof location !== 'undefined' && location.hostname) || '127.0.0.1';

export const FISH_CONFIG = {
  // Mostek z detekcji (people_detection/serve.py). ?fish=off wyłącza połączenie.
  bridgeUrl: QRY.get('fish') || `http://${HOST}:8765/fish`,
  demo: QRY.get('demo') === '1',

  // ŁOWISKO: prostokąt na mapie, na który rozkładana jest podłoga z kamery
  // (u: lewo->prawo = zachód->wschód, v: daleko->blisko = północ->południe).
  //
  // ~250 × 195 m, czyli TYLE, ŻEBY RYBA NADĄŻAŁA ZA CZŁOWIEKIEM. Rozmiar łowiska
  // przelicza ruch w kadrze na metry w morzu: przy 9 × 7 km (wersja pierwotna)
  // dwa kroki w bok to były 3 km, więc ryba płynąca 1,6 m/s nie miała szans
  // dogonić celu i tylko dryfowała w jedną stronę. Tu przejście przez pół kadru
  // to ~125 m — ryba realnie rusza za człowiekiem i dobija do celu, gdy ten stanie.
  //
  // Koszt: dno pod całym łowiskiem jest płaskie (~64 m), więc wysokość dźwięku
  // nie zależy juz od tego, gdzie człowiek stoi — rozrzut wysokości niosą gatunki
  // (szprot tuż pod powierzchnią, flądra przy dnie) i pobudzenie (ryba wypływa
  // wyżej = gra wyżej). Wróć do kilometrów, jeśli ważniejsza jest zależność
  // "pozycja w kadrze -> wysokość dźwięku" niż podążanie ryby za człowiekiem.
  ground: { latMin: 54.51663, latMax: 54.51838, lonMin: 18.90807, lonMax: 18.91193 },

  minWaterDepth: 4,      // [m] ryba nie wpływa na płyciznę
  // Prędkości: spokojnie przy swoim człowieku, zryw gdy trzeba go dogonić.
  // Zryw (~26 m/s) jest szybszy niż prawdziwa ryba, bo czytelność ruchu wygrywa
  // z biologią — a i tak to tylko 1,8 % prędkości dźwięku w wodzie, czyli Doppler
  // rzędu 30 centów: ryba w pogoni lekko podnosi ton i to slychac jako efekt.
  // Gdy łódka odpłynie daleko od łowiska, cała ławica teleportuje się
  // w jej okolice (followBoat) zamiast gonić przez kilometry.
  // Ruch ryby idzie za ruchem czlowieka: stoi -> ryba dopływa do celu i zwalnia,
  // rusza się -> ryba przyspiesza (excitement z prędkości osoby, patrz mapping.py),
  // została z tyłu -> zrywa się w pogoń (chaseBoost), żeby dogonić i znów zwolnić.
  fishSpeed: 3.0,         // [m/s] spokojny marsz przy celu
  excitementBoost: 3.0,   // maxSpeed × (1 + boost · pobudzenie) -> ~8,8 m/s przy biegu
  chaseBoost: 5.0,        // dodatkowy mnożnik, gdy cel ucieka daleko (~26 m/s w zrywie)
  chaseDistance: 90,      // [m] dystans, przy którym zryw osiąga pełną wartość
  spacing: 14,            // [m] ryby nie nakładają się na siebie
  searchRadius: 15,       // [m] promień krążenia, gdy detektor zgubi człowieka
  fishAccel: 10.0,         // [m/s²] zryw ma być widoczny, nie płynny jak u barki
  followRadius: 600,      // [m] łódka dalej niż tyle od środka łowiska = teleport łowiska do łódki
  teleportScatter: 50,    // [m] losowy rozrzut ryb przy teleportacji (żeby nie stały w punkcie)
  teleportCooldown: 1.0,  // [s] nie częściej niż 1 teleport na sekundę
  teleportMaxBoatSpeed: 2.0, // [m/s] powyżej tej prędkości teleport tylko po puszczeniu gazu
  searchGrace: 1.5,      // [s] tyle ryba czeka (krąży), gdy detektor zgubi człowieka
  leaveTime: 3.0,        // [s] tyle odpływa i gaśnie po odejściu człowieka
};
