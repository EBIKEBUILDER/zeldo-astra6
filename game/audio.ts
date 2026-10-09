import type { SoundName } from './types';
import type { MusicTrack } from './music';
import { MusicPlayer } from './music-player';

/** Small, entirely synthesized sound palette. Audio starts only after a gesture. */
export class GameAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private music: MusicPlayer | null = null;
  private musicTrack: MusicTrack | null = null;
  private muted = false;
  private disposed = false;

  unlock(): void {
    if (this.disposed) return;
    try {
      if (!this.context) {
        const AudioCtor = window.AudioContext || (window as typeof window & {
          webkitAudioContext?: typeof AudioContext;
        }).webkitAudioContext;
        if (!AudioCtor) return;
        this.context = new AudioCtor();
        this.master = this.context.createGain();
        this.master.gain.value = this.muted ? 0 : 0.32;
        const compressor = this.context.createDynamicsCompressor();
        compressor.threshold.value = -16;
        compressor.knee.value = 12;
        compressor.ratio.value = 5;
        this.master.connect(compressor);
        compressor.connect(this.context.destination);
        this.noiseBuffer = this.context.createBuffer(1, this.context.sampleRate, this.context.sampleRate);
        const data = this.noiseBuffer.getChannelData(0);
        for (let index = 0; index < data.length; index++) data[index] = Math.random() * 2 - 1;
        this.music = new MusicPlayer(this.context, this.master, this.noiseBuffer);
      }
      // Safari may also report an interrupted state after a phone call or tab switch.
      if (this.context.state !== 'running' && this.context.state !== 'closed') {
        void this.context.resume().catch(() => {});
      }
      this.music?.setTrack(this.muted ? null : this.musicTrack);
    } catch {
      // Unsupported devices still get the complete playable game.
    }
  }

  setMuted(muted: boolean): void {
    if (muted === this.muted) return;
    this.muted = muted;
    if (this.context && this.master) {
      this.master.gain.cancelScheduledValues(this.context.currentTime);
      this.master.gain.setTargetAtTime(muted ? 0 : 0.32, this.context.currentTime, 0.015);
    }
    this.music?.setTrack(muted ? null : this.musicTrack);
  }

  setMusic(track: MusicTrack | null): void {
    if (this.disposed || this.musicTrack === track) return;
    this.musicTrack = track;
    this.music?.setTrack(this.muted ? null : track);
  }

  private tone(
    frequency: number,
    duration: number,
    type: OscillatorType = 'triangle',
    volume = 0.3,
    delay = 0,
    endFrequency?: number,
  ): void {
    const context = this.context;
    if (!context || !this.master) return;
    const start = context.currentTime + delay;
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    if (endFrequency) oscillator.frequency.exponentialRampToValueAtTime(endFrequency, start + duration);
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(Math.max(volume, 0.0001), start + 0.008);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(envelope);
    envelope.connect(this.master);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.025);
    oscillator.onended = () => { oscillator.disconnect(); envelope.disconnect(); };
  }

  private noise(duration: number, volume: number, from: number, to: number, delay = 0): void {
    const context = this.context;
    if (!context || !this.master || !this.noiseBuffer) return;
    const start = context.currentTime + delay;
    const source = context.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 0.65;
    filter.frequency.setValueAtTime(from, start);
    filter.frequency.exponentialRampToValueAtTime(to, start + duration);
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(volume, start + 0.01);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(filter);
    filter.connect(envelope);
    envelope.connect(this.master);
    source.start(start);
    source.stop(start + duration + 0.02);
    source.onended = () => { source.disconnect(); filter.disconnect(); envelope.disconnect(); };
  }

  private chime(notes: number[], spacing: number, duration = 0.3): void {
    notes.forEach((note, index) => {
      this.tone(note, duration, 'triangle', 0.34, index * spacing);
      this.tone(note * 2, duration * 0.65, 'sine', 0.09, index * spacing);
    });
  }

  play(name: SoundName): void {
    if (this.muted || this.disposed || !this.context || this.context.state !== 'running') return;
    switch (name) {
      case 'swing':
        this.noise(0.16, 0.6, 2900, 550);
        this.tone(220, 0.12, 'triangle', 0.1, 0, 90);
        break;
      case 'hit':
        this.noise(0.1, 0.6, 2100, 550);
        this.tone(170, 0.13, 'square', 0.2, 0, 55);
        this.tone(840, 0.07, 'triangle', 0.22);
        break;
      case 'boss-windup':
        this.tone(146.83, .38, 'triangle', .26, 0, 110);
        this.tone(220, .18, 'sine', .18, .23);
        this.noise(.22, .12, 430, 850);
        break;
      case 'boss-lunge':
        this.noise(.28, .4, 1200, 240);
        this.tone(164.81, .3, 'triangle', .3, 0, 55);
        break;
      case 'ranged-charge':
        // A rising, three-beat breath gives the locked shot a recognizable cue.
        this.tone(196, .78, 'sine', .23, 0, 784);
        this.tone(293.66, .73, 'triangle', .12, .04, 1174.66);
        [392, 554.37, 783.99].forEach((note, i) => {
          this.tone(note, .19, 'sine', .16 + i * .025, .12 + i * .23);
        });
        this.noise(.72, .11, 280, 1800);
        break;
      case 'ranged-fire':
        this.tone(1046.5, .23, 'triangle', .3, 0, 196);
        this.tone(523.25, .30, 'sine', .22, .015, 98);
        this.noise(.18, .28, 2400, 650);
        break;
      case 'ranged-parry':
        this.tone(1567.98, .28, 'triangle', .38, 0, 2093);
        this.tone(2349.32, .20, 'sine', .22, .025);
        this.tone(3135.96, .12, 'sine', .12, .045);
        this.noise(.055, .24, 4400, 1900);
        break;
      case 'ranged-impact':
        this.tone(392, .17, 'triangle', .21, 0, 98);
        this.noise(.13, .24, 1500, 250);
        break;
      case 'ranged-explode':
        this.tone(110, .48, 'sine', .4, 0, 37);
        this.noise(.42, .42, 1700, 190);
        this.tone(587.33, .32, 'triangle', .13, .025, 146.83);
        break;
      case 'death':
        this.tone(240, 0.28, 'triangle', 0.42, 0, 48);
        this.noise(0.28, 0.4, 900, 130);
        break;
      case 'rupee':
        this.chime([1174.66, 1567.98], 0.065, 0.22);
        break;
      case 'hurt':
        this.tone(240, 0.14, 'sawtooth', 0.27, 0, 130);
        this.tone(160, 0.24, 'triangle', 0.42, 0.08, 64);
        this.noise(0.14, 0.28, 480, 100);
        break;
      case 'key':
        this.chime([523.25, 659.25, 783.99, 1046.5], 0.115, 0.55);
        this.tone(261.63, 0.7, 'sine', 0.22, 0.3);
        break;
      case 'gate':
        this.noise(0.65, 0.48, 500, 110);
        this.tone(73.42, 0.7, 'triangle', 0.42, 0, 49);
        this.chime([392, 523.25, 659.25], 0.1, 0.4);
        break;
      case 'chest':
        this.chime([392, 523.25, 659.25, 783.99, 1046.5], 0.14, 0.85);
        [261.63, 329.63, 392].forEach(note => this.tone(note, 1.35, 'triangle', 0.15, 0.6));
        break;
      case 'break':
        this.noise(0.18, 0.4, 3200, 400);
        this.tone(280, 0.065, 'triangle', 0.15, 0, 100);
        this.tone(430, 0.07, 'triangle', 0.1, 0.045, 180);
        break;
      case 'heart':
        this.chime([659.25, 783.99, 1046.5], 0.065, 0.35);
        break;
      case 'step':
        this.noise(0.045, 0.06, 300, 100);
        break;
      case 'enter':
        this.chime([392, 493.88, 587.33, 783.99], 0.13, 0.7);
        this.tone(196, 0.8, 'sine', 0.2);
        break;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.music?.dispose();
    this.music = null;
    this.musicTrack = null;
    if (this.context && this.context.state !== 'closed') void this.context.close().catch(() => {});
    this.context = null;
    this.master = null;
    this.noiseBuffer = null;
  }
}
