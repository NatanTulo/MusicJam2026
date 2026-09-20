// Ustawienia ryb w morzu. Wartości z URL (?fish=..., ?demo=1) nadpisują domyślne.
const QRY = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
const HOST = (typeof location !== 'undefined' && location.hostname) || '127.0.0.1';

export const FISH_CONFIG = {
  // Mostek z detekcji (people_detection/serve.py). ?fish=off wyłącza połączenie.
  bridgeUrl: QRY.get('fish') || `http://${HOST}:8765/fish`,
  demo: QRY.get('demo') === '1',

  // ŁOWISKO: ~1000 × 780 m, czyli TYLE, ŻEBY RYBY MIAŁY GDZIE PŁYWAĆ.
  // Rozmiar łowiska przelicza ruch w kadrze na metry w morzu: przy 250 × 195 m
  // trzynastoosobowy tłum z kamery lądował w jednym punkcie pod łódką.
  // Tu przejście przez pół kadru to ~500 m, a marsz 131 m/s i tak dobija
  // do celu w sekundy.
  //
  // Koszt: dno pod całym łowiskiem jest prawie płaskie (~64 m), więc wysokość
  // dźwięku nie zależy juz od tego, gdzie człowiek stoi — rozrzut wysokości
  // niosą losowa głębokość ryby (depthRepick) i gatunki (barwa głosu).
  ground: { latMin: 54.51401, latMax: 54.52101, lonMin: 18.9023, lonMax: 18.9177 },

  minWaterDepth: 4,      // [m] ryba nie wpływa na płyciznę
  // Prędkości: SZTUCZNE (czytelne), w połowie między symbolicznymi 260 m/s
  // sprzed 65194c9 a realistycznymi 3 m/s. Marsz 131,5 m/s, z pobudzeniem
  // do ~2,4× tyle (~316 m/s) — jak przed commitem. Mnożnik pogoni (chaseBoost)
  // wyłączony (=1): przy takim marszu ryba i tak dogania cel bez zrywu.
  // Ruch ryby idzie za ruchem czlowieka: stoi -> ryba dopływa do celu i zwalnia,
  // rusza się -> ryba przyspiesza (excitement z prędkości osoby, patrz mapping.py).
  fishSpeed: 131.5,      // [m/s] marsz; z pobudzeniem do ~2,4× tyle w zrywie
  excitementBoost: 1.4,  // maxSpeed × (1 + boost · pobudzenie), jak przed 65194c9
  chaseBoost: 1,         // dodatkowy mnożnik pogoni — wyłączony (patrz wyżej)
  chaseDistance: 90,     // [m] dystans, przy którym zryw osiąga pełną wartość
  spacing: 30,            // [m] osobista bańka ryby: nie podpływaj bliżej
  searchRadius: 15,      // [m] promień krążenia, gdy detektor zgubi człowieka
  fishAccel: 355,        // [m/s²] w połowie między 700 a 10
  followRadius: 600,      // [m] łódka dalej niż tyle od środka łowiska = teleport łowiska do łódki
  teleportScatter: 50,    // [m] losowy rozrzut ryb przy teleportacji (żeby nie stały w punkcie)
  teleportCooldown: 1.0,  // [s] nie częściej niż 1 teleport na sekundę
  teleportMaxBoatSpeed: 2.0, // [m/s] powyżej tej prędkości teleport tylko po puszczeniu gazu
  searchGrace: 1.5,      // [s] tyle ryba czeka (krąży), gdy detektor zgubi człowieka
  leaveTime: 3.0,        // [s] tyle odpływa i gaśnie po odejściu człowieka
  depthRepick: [6, 14],  // [s] po takim czasie (losowo z zakresu) ryba losuje nową głębokość
};
