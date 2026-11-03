const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const states = new Set(['idle', 'notice', 'listen', 'think', 'speak']);

export class Engagement {
  constructor() {
    this.mode = 'idle'; this.time = 0; this.until = Infinity; this.enteredAt = 0;
    this.emotion = { valence: .08, arousal: -.08, dominance: .05 };
    this.target = { ...this.emotion }; this.energy = 0; this.progress = 0; this.interruptions = 0;
  }
  set(mode, { duration = Infinity } = {}) {
    if (!states.has(mode)) return false;
    this.mode = mode; this.enteredAt = this.time; this.until = this.time + duration;
    if (mode === 'notice') { this.target.valence = .32; this.target.arousal = .16; }
    if (mode === 'listen') { this.target.valence = .15; this.target.arousal = -.03; }
    if (mode === 'think') { this.target.arousal = -.18; this.target.dominance = -.08; }
    if (mode === 'speak') { this.target.valence = .25; this.target.arousal = .15; this.progress = 0; }
    if (mode !== 'speak') this.energy = 0;
    return true;
  }
  interrupt() { this.interruptions++; this.set('listen', { duration: 4 }); this.target.arousal = .22; }
  step(dt) {
    this.time += dt;
    if (this.time >= this.until) this.set('idle');
    for (const key of ['valence', 'arousal', 'dominance']) {
      const baseline = { valence: .08, arousal: -.08, dominance: .05 }[key];
      this.target[key] += (baseline - this.target[key]) * (1 - Math.exp(-dt / 14));
      this.emotion[key] += (this.target[key] - this.emotion[key]) * (1 - Math.exp(-dt / .9));
    }
    return this;
  }
  audio(energy, progress) { this.energy = this.mode === 'speak' ? clamp(energy, 0, 1) : 0; this.progress = clamp(progress, 0, 1); }
  snapshot() { return { mode: this.mode, time: this.time, elapsed: this.time - this.enteredAt, emotion: { ...this.emotion }, energy: this.energy, progress: this.progress, interruptions: this.interruptions }; }
}
