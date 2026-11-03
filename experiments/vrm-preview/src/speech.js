// Local Web Audio only. The analyser reads the very signal sent to the speaker.
export class LocalSpeech {
  constructor(onState) { this.onState = onState; this.epoch = 0; this.context = null; this.source = null; this.energy = 0; this.progress = 0; this.playing = false; this.paused = false; }
  async play(bytes, text = '') {
    this.stop(); const epoch = this.epoch;
    this.context ||= new AudioContext();
    await this.context.resume();
    const buffer = await this.context.decodeAudioData(bytes.slice(0));
    if (epoch !== this.epoch) return false;
    this.analyser = this.context.createAnalyser(); this.analyser.fftSize = 512;
    this.samples = new Float32Array(this.analyser.fftSize);
    this.source = this.context.createBufferSource(); this.source.buffer = buffer;
    this.source.connect(this.analyser); this.analyser.connect(this.context.destination);
    this.duration = buffer.duration; this.started = this.context.currentTime; this.playing = true; this.text = text; this.paused = false;
    const done = new Promise(resolve => { this.resolve = resolve; });
    this.source.onended = () => { if (epoch === this.epoch) this.finish(true); };
    this.notified = false; this.source.start(); return done;
  }
  step() {
    if (!this.playing || this.paused) return;
    if (!this.notified && this.context.currentTime > this.started + .005) { this.notified = true; this.onState('speak'); }
    this.analyser.getFloatTimeDomainData(this.samples);
    const rms = Math.sqrt(this.samples.reduce((sum, v) => sum + v * v, 0) / this.samples.length);
    this.energy = Math.min(.9, Math.max(0, (rms - .009) * 5.5));
    this.progress = Math.min(1, (this.context.currentTime - this.started) / this.duration);
  }
  finish(completed) {
    this.playing = false; this.energy = 0; this.progress = completed ? 1 : 0;
    this.source?.disconnect(); this.analyser?.disconnect(); this.source = null;
    const resolve = this.resolve; this.resolve = null;
    this.onState(completed ? 'complete' : 'stopped'); resolve?.(completed);
  }
  stop() {
    this.epoch++;
    if (this.source) { this.source.onended = null; try { this.source.stop(); } catch { /* Already ended. */ } }
    if (this.playing) this.finish(false);
    this.energy = 0; this.progress = 0;
  }
  async pause(paused) {
    this.paused = paused;
    if (this.context) { if (paused) await this.context.suspend(); else await this.context.resume(); }
  }
  snapshot() { return { playing: this.playing, paused: this.paused, energy: this.energy, progress: this.progress, duration: this.duration || 0, text: this.text || '', context: this.context?.state || 'closed', clock: this.context?.currentTime || 0 }; }
  dispose() { this.stop(); void this.context?.close(); }
}
