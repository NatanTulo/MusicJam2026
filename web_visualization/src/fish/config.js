// Ustawienia ryb w morzu. Wartości z URL (?fish=..., ?demo=1) nadpisują domyślne.
const QRY = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
const HOST = (typeof location !== 'undefined' && location.hostname) || '127.0.0.1';

export const FISH_CONFIG = {
  // Mostek z detekcji (people_detection/serve.py). ?fish=off wyłącza połączenie.
  bridgeUrl: QRY.get('fish') || `http://${HOST}:8765/fish`,
  demo: QRY.get('demo') === '1',

  // ŁOWISKO: prostokąt na mapie, na który rozkładana jest podłoga z kamery
  // (u: lewo->prawo = zachód->wschód, v: daleko->blisko = północ->południe).
  // Zatoka Gdańska wokół startu łódki: dno opada z ~20 m (SW) do ~70 m (NE),
  // więc ryby naturalnie pływają na bardzo różnych głębokościach.
  // ~9 × 7 km: dość blisko, żeby łódka "słyszała" całe łowisko
  // (dźwięk z 5 km idzie ~3,4 s i jest ~20 dB cichszy niż ze 100 m).
  ground: { latMin: 54.485, latMax: 54.55, lonMin: 18.84, lonMax: 18.98 },

  minWaterDepth: 4,      // [m] ryba nie wpływa na płyciznę
  // Prędkości realistyczne (dorsz: ~1 m/s marszu, kilka m/s w zrywie).
  // Ryby płyną spokojnie za celami z kamery, więc opóźnienia i poziomy
  // w hydrofonie zmieniają się powoli i dźwięk jest spójny (mały Doppler).
  // Gdy łódka odpłynie daleko od łowiska, cała ławica teleportuje się
  // w jej okolice (followBoat) zamiast gonić przez kilometry.
  fishSpeed: 1.6,         // [m/s] marsz; z pobudzeniem do ~2,4× tyle w zrywie
  fishAccel: 3.0,         // [m/s²]
  followRadius: 1200,     // [m] łódka dalej niż tyle od środka łowiska = teleport łowiska do łódki
  teleportScatter: 120,   // [m] losowy rozrzut ryb przy teleportacji (żeby nie stały w punkcie)
  teleportCooldown: 1.0,  // [s] nie częściej niż 1 teleport na sekundę
  teleportMaxBoatSpeed: 2.0, // [m/s] powyżej tej prędkości teleport tylko po puszczeniu gazu
  searchGrace: 1.5,      // [s] tyle ryba czeka (krąży), gdy detektor zgubi człowieka
  leaveTime: 3.0,        // [s] tyle odpływa i gaśnie po odejściu człowieka
};
