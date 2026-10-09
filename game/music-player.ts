import { MUSIC_SCORES, type MusicNote, type MusicTrack } from './music';

type Voice = { source: AudioScheduledSourceNode; nodes: AudioNode[] };
type Layer = {
  track: MusicTrack;
  gain: GainNode;
  voices: Set<Voice>;
  retired: boolean;
  origin: number;
  cycle: number;
  note: number;
};

const LOOK_AHEAD = 0.18;
const MUSIC_LEVEL = 0.72;

/** A small look-ahead sequencer: the audio clock keeps time independently of FPS. */
export class MusicPlayer {
  private layer: Layer | null = null;
  private layers = new Set<Layer>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;

  constructor(
    private context: AudioContext,
    private output: AudioNode,
    private noiseBuffer: AudioBuffer,
  ) {}

  setTrack(track: MusicTrack | null): void {
    if (this.disposed || this.layer?.track === track) return;
    if (this.timer !== null) { clearInterval(this.timer); this.timer = null; }
    this.retireLayer(track ? 0.45 : 0.12);
    if (!track) return;
    const now = this.context.currentTime;
    const gain = this.context.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(MUSIC_LEVEL, now + 0.45);
    gain.connect(this.output);
    this.layer = { track, gain, voices: new Set(), retired: false, origin: now + 0.035, cycle: 0, note: 0 };
    this.layers.add(this.layer);
    this.schedule();
    this.timer = setInterval(() => this.schedule(), 25);
  }

  private retireLayer(fade: number): void {
    const layer = this.layer;
    if (!layer) return;
    this.layer = null;
    layer.retired = true;
    const now = this.context.currentTime;
    const level = layer.gain.gain.value;
    layer.gain.gain.cancelScheduledValues(now);
    layer.gain.gain.setValueAtTime(level, now);
    layer.gain.gain.linearRampToValueAtTime(0, now + fade);
    // Also stop notes already scheduled ahead, so old tracks cannot leak voices.
    for (const voice of layer.voices) voice.source.stop(now + fade + 0.025);
    this.releaseLayer(layer);
  }

  private releaseLayer(layer: Layer): void {
    if (!layer.retired || layer.voices.size) return;
    layer.gain.disconnect();
    this.layers.delete(layer);
  }

  private schedule(): void {
    const layer = this.layer;
    if (!layer || this.context.state !== 'running') return;
    const score = MUSIC_SCORES[layer.track];
    const beatSeconds = 60 / score.bpm;
    const loopSeconds = score.beats * beatSeconds;
    const now = this.context.currentTime;
    // A throttled timer skips missed beats instead of bursting a backlog of notes.
    const currentCycle = Math.floor((now - layer.origin) / loopSeconds);
    if (currentCycle > layer.cycle) { layer.cycle = currentCycle; layer.note = 0; }
    while (true) {
      const note = score.notes[layer.note];
      const start = layer.origin + layer.cycle * loopSeconds + note.beat * beatSeconds;
      if (start >= now + LOOK_AHEAD) break;
      if (start >= now) this.playNote(layer, note, start, note.duration * beatSeconds);
      if (++layer.note === score.notes.length) { layer.note = 0; layer.cycle++; }
    }
  }

  private connectVoice(layer: Layer, source: AudioScheduledSourceNode, nodes: AudioNode[], start: number, end: number): void {
    const voice = { source, nodes: [source, ...nodes] };
    layer.voices.add(voice);
    source.onended = () => {
      for (const node of voice.nodes) node.disconnect();
      layer.voices.delete(voice);
      this.releaseLayer(layer);
    };
    source.start(start);
    source.stop(end);
  }

  private pitched(
    layer: Layer, frequency: number, start: number, duration: number,
    type: OscillatorType, volume: number, attack: number, release: number, cutoff = 0,
  ): void {
    const oscillator = this.context.createOscillator();
    const envelope = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    const peak = Math.max(0.0001, volume);
    const rise = Math.min(attack, duration * 0.3);
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(peak, start + rise);
    envelope.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak * 0.55), start + duration);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration + release);
    const nodes: AudioNode[] = [envelope];
    if (cutoff) {
      const filter = this.context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = cutoff;
      filter.Q.value = 0.5;
      oscillator.connect(filter);
      filter.connect(envelope);
      nodes.push(filter);
    } else oscillator.connect(envelope);
    envelope.connect(layer.gain);
    this.connectVoice(layer, oscillator, nodes, start, start + duration + release + 0.015);
  }

  private playNote(layer: Layer, note: MusicNote, start: number, duration: number): void {
    const frequency = 440 * 2 ** ((note.midi - 69) / 12);
    const velocity = note.velocity;
    switch (note.voice) {
      case 'lead':
        this.pitched(layer, frequency, start, duration, 'triangle', 0.24 * velocity, 0.012, 0.09, 3200);
        break;
      case 'bell':
        this.pitched(layer, frequency, start, duration, 'sine', 0.19 * velocity, 0.006, 0.23);
        this.pitched(layer, frequency * 2, start, duration * 0.35, 'sine', 0.035 * velocity, 0.004, 0.12);
        break;
      case 'pad':
        this.pitched(layer, frequency, start, duration, 'triangle', 0.055 * velocity, 0.28, 0.45, 1100);
        this.pitched(layer, frequency * 1.002, start, duration, 'sine', 0.025 * velocity, 0.32, 0.5);
        break;
      case 'bass':
        this.pitched(layer, frequency, start, duration, 'triangle', 0.27 * velocity, 0.012, 0.07, 650);
        break;
      case 'kick': {
        const oscillator = this.context.createOscillator();
        const envelope = this.context.createGain();
        oscillator.frequency.setValueAtTime(125, start);
        oscillator.frequency.exponentialRampToValueAtTime(43, start + 0.13);
        envelope.gain.setValueAtTime(0.0001, start);
        envelope.gain.exponentialRampToValueAtTime(0.4 * velocity, start + 0.004);
        envelope.gain.exponentialRampToValueAtTime(0.0001, start + 0.22);
        oscillator.connect(envelope);
        envelope.connect(layer.gain);
        this.connectVoice(layer, oscillator, [envelope], start, start + 0.24);
        break;
      }
      case 'snare':
      case 'hat': {
        const hat = note.voice === 'hat';
        const source = this.context.createBufferSource();
        const filter = this.context.createBiquadFilter();
        const envelope = this.context.createGain();
        const length = hat ? 0.055 : 0.13;
        source.buffer = this.noiseBuffer;
        filter.type = hat ? 'highpass' : 'bandpass';
        filter.frequency.value = hat ? 6500 : 1800;
        filter.Q.value = 0.7;
        envelope.gain.setValueAtTime(0.0001, start);
        envelope.gain.exponentialRampToValueAtTime((hat ? 0.1 : 0.21) * velocity, start + 0.003);
        envelope.gain.exponentialRampToValueAtTime(0.0001, start + length);
        source.connect(filter);
        filter.connect(envelope);
        envelope.connect(layer.gain);
        this.connectVoice(layer, source, [filter, envelope], start, start + length + 0.015);
        break;
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    for (const layer of this.layers) {
      for (const voice of layer.voices) {
        voice.source.onended = null;
        voice.source.stop();
        for (const node of voice.nodes) node.disconnect();
      }
      layer.voices.clear();
      layer.gain.disconnect();
    }
    this.layers.clear();
    this.layer = null;
  }
}
