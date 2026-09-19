// Tryb demo: sztuczni "ludzie" chodzący po podłodze — do pracy nad morzem
// i dźwiękiem bez uruchomionej detekcji. Ten sam format co mostek (u, v, ...).
export class DemoPeople {
  constructor(count = 7) {
    this.count = count;
    this.nextId = 1000;           // ID poza zakresem trackera, żeby nie mylić z prawdziwymi
    this.walkers = [];
    this.time = 0;
    for (let i = 0; i < count; i++) this.walkers.push(this._walker());
  }

  _walker() {
    const r = () => Math.random();
    return {
      id: this.nextId++,
      phase: [r() * 10, r() * 10, r() * 10, r() * 10],
      speed: 0.04 + r() * 0.08,
      life: 25 + r() * 45,
      age: 0,
      u: r(), v: r(), pu: 0, pv: 0,
    };
  }

  update(dt) {
    this.time += dt;
    const out = [];
    this.walkers = this.walkers.map((w) => {
      w.age += dt;
      if (w.age > w.life) return this._walker();   // ktoś wyszedł, ktoś wszedł
      const t = this.time * w.speed;
      w.pu = w.u; w.pv = w.v;
      w.u = 0.5 + 0.42 * Math.sin(t * 1.3 + w.phase[0]) * Math.cos(t * 0.7 + w.phase[1]);
      w.v = 0.5 + 0.42 * Math.sin(t * 0.9 + w.phase[2]) * Math.cos(t * 0.5 + w.phase[3]);
      return w;
    });
    for (const w of this.walkers) {
      const sp = dt > 0 ? Math.hypot(w.u - w.pu, w.v - w.pv) / dt : 0;
      out.push({ id: w.id, u: w.u, v: w.v, scale: 1, excitement: Math.min(1, sp / 0.08), fresh: true });
    }
    return out;
  }
}
