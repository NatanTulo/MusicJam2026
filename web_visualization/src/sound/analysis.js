// Proste pomiary nagranego dźwięku (bez bibliotek): widmo, pasma, "oddychanie" fal.
// Używane przez laboratorium do raportu i przez testy (renderOffline).

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k), wi = Math.sin(ang * k);
        const ar = re[i + k + len / 2], ai = im[i + k + len / 2];
        const tr = ar * wr - ai * wi, ti = ar * wi + ai * wr;
        re[i + k + len / 2] = re[i + k] - tr; im[i + k + len / 2] = im[i + k] - ti;
        re[i + k] += tr; im[i + k] += ti;
      }
    }
  }
}

/** Średnie widmo mocy (okno Hanna, ramki 4096) kanału mono. */
export function powerSpectrum(samples, sampleRate, size = 4096) {
  const spec = new Float64Array(size / 2);
  let frames = 0;
  for (let start = 0; start + size <= samples.length; start += size / 2) {
    const re = new Float64Array(size), im = new Float64Array(size);
    for (let i = 0; i < size; i++) re[i] = samples[start + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1)));
    fft(re, im);
    for (let k = 0; k < size / 2; k++) spec[k] += re[k] * re[k] + im[k] * im[k];
    frames++;
  }
  if (frames) for (let k = 0; k < spec.length; k++) spec[k] /= frames;
  return { spec, binHz: sampleRate / size };
}

export function analyze(buffer) {
  const n = buffer.length;
  const mono = new Float32Array(n);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const d = buffer.getChannelData(ch);
    for (let i = 0; i < n; i++) mono[i] += d[i] / buffer.numberOfChannels;
  }
  let sum = 0;
  for (let i = 0; i < n; i++) sum += mono[i] * mono[i];
  const rms = Math.sqrt(sum / n);

  const { spec, binHz } = powerSpectrum(mono, buffer.sampleRate);
  let total = 0, weighted = 0;
  const bands = { '20-200': 0, '200-1k': 0, '1k-4k': 0, '4k-16k': 0 };
  for (let k = 1; k < spec.length; k++) {
    const f = k * binHz;
    total += spec[k]; weighted += spec[k] * f;
    if (f < 200) bands['20-200'] += spec[k];
    else if (f < 1000) bands['200-1k'] += spec[k];
    else if (f < 4000) bands['1k-4k'] += spec[k];
    else if (f < 16000) bands['4k-16k'] += spec[k];
  }
  const db = (x) => 10 * Math.log10(Math.max(x, 1e-20));
  const bandDb = Object.fromEntries(Object.entries(bands).map(([k, v]) => [k, +db(v).toFixed(1)]));

  // "oddychanie": zmienność głośności w oknach 100 ms (falowanie daje duże wahania)
  const win = Math.floor(buffer.sampleRate * 0.1);
  const env = [];
  for (let s = 0; s + win <= n; s += win) {
    let e = 0;
    for (let i = s; i < s + win; i++) e += mono[i] * mono[i];
    env.push(Math.sqrt(e / win));
  }
  const mean = env.reduce((a, b) => a + b, 0) / (env.length || 1);
  const sd = Math.sqrt(env.reduce((a, b) => a + (b - mean) ** 2, 0) / (env.length || 1));

  return {
    rmsDb: +(20 * Math.log10(Math.max(rms, 1e-10))).toFixed(1),
    centroidHz: Math.round(total > 0 ? weighted / total : 0),
    bandDb,
    modulation: +(mean > 0 ? sd / mean : 0).toFixed(3),
  };
}
