// Połączenie z detekcją (people_detection/serve.py) przez Server-Sent Events.
// EventSource sam wznawia połączenie, gdy mostek wstanie później niż strona.
export class FishLink {
  constructor(url) {
    this.url = url;
    this.targets = [];
    this.stats = null;
    this.source = null;
    this.lastMsg = -Infinity;
    this.enabled = url && url !== 'off';
    if (this.enabled) this._open();
  }

  _open() {
    this.es = new EventSource(this.url);
    this.es.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data);
        this.targets = d.fish || [];
        this.stats = d.stats || null;
        this.source = d.source || null;
        this.lastMsg = performance.now();
      } catch (err) {
        console.warn('Mostek ryb: zła wiadomość', err);
      }
    };
  }

  /** Czy dane są świeże. Gdy mostek padnie, ryby mają odpłynąć, a nie zamarznąć. */
  get alive() {
    return performance.now() - this.lastMsg < 2000;
  }

  current() {
    return this.alive ? this.targets : [];
  }

  close() {
    this.es?.close();
  }
}
