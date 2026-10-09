import test from 'node:test';
import assert from 'node:assert/strict';
import { GameAudio } from './audio';
import { MUSIC_SCORES } from './music';
import { MusicPlayer } from './music-player';

type Automation = { kind: string; value?: number; time: number };

class FakeParam {
  value = 1;
  events: Automation[] = [];
  private record(kind: string, value: number, time: number) {
    assert.ok(Number.isFinite(value) && Number.isFinite(time), 'Audio automation must stay finite');
    this.events.push({ kind, value, time });
    this.value = value;
    return this;
  }
  setValueAtTime(value: number, time: number) { return this.record('set', value, time); }
  linearRampToValueAtTime(value: number, time: number) { return this.record('linear', value, time); }
  exponentialRampToValueAtTime(value: number, time: number) {
    assert.ok(value > 0, 'Exponential ramps require positive values');
    return this.record('exponential', value, time);
  }
  setTargetAtTime(value: number, time: number) { return this.record('target', value, time); }
  cancelScheduledValues(time: number) { this.events.push({ kind: 'cancel', time }); return this; }
}

class FakeNode {
  outputs: FakeNode[] = [];
  disconnected = false;
  constructor(readonly context: FakeContext) { context.nodes.push(this); }
  connect(node: FakeNode) { this.outputs.push(node); return node; }
  disconnect() { this.disconnected = true; this.outputs = []; }
}

class FakeGain extends FakeNode { gain = new FakeParam(); }
class FakeFilter extends FakeNode { type = 'lowpass'; frequency = new FakeParam(); Q = new FakeParam(); }
class FakeCompressor extends FakeNode { threshold = new FakeParam(); knee = new FakeParam(); ratio = new FakeParam(); }

class FakeSource extends FakeNode {
  type = 'sine';
  frequency = new FakeParam();
  buffer: unknown = null;
  startTime: number | null = null;
  stopTimes: number[] = [];
  ended = false;
  onended: (() => void) | null = null;
  start(time: number) {
    assert.equal(this.startTime, null, 'A source can only be started once');
    assert.ok(time >= this.context.currentTime, 'Do not schedule stale notes in the past');
    this.startTime = time;
  }
  stop(time = this.context.currentTime) { this.stopTimes.push(time); }
  finishIfDue() {
    if (!this.ended && this.stopTimes.length && this.stopTimes.at(-1)! <= this.context.currentTime) {
      this.ended = true;
      this.onended?.();
    }
  }
}

class FakeContext {
  currentTime = 0;
  state = 'running';
  sampleRate = 8000;
  nodes: FakeNode[] = [];
  sources: FakeSource[] = [];
  destination = new FakeNode(this);
  resumes = 0;
  closes = 0;
  createGain() { return new FakeGain(this); }
  createBiquadFilter() { return new FakeFilter(this); }
  createDynamicsCompressor() { return new FakeCompressor(this); }
  private source() { const source = new FakeSource(this); this.sources.push(source); return source; }
  createOscillator() { return this.source(); }
  createBufferSource() { return this.source(); }
  createBuffer(_channels: number, length: number) { return { getChannelData: () => new Float32Array(length) }; }
  resume() { this.resumes++; this.state = 'running'; return Promise.resolve(); }
  close() { this.closes++; this.state = 'closed'; return Promise.resolve(); }
  advanceTo(time: number) {
    this.currentTime = time;
    for (const source of this.sources) source.finishIfDue();
  }
}

type AudioHarness = {
  audio: GameAudio;
  contexts: FakeContext[];
  timers: Map<number, () => void>;
  tick: () => void;
};

function withAudio(run: (harness: AudioHarness) => void) {
  const contexts: FakeContext[] = [];
  const timers = new Map<number, () => void>();
  let nextTimer = 0;
  const globals = {
    window: { AudioContext: class extends FakeContext { constructor() { super(); contexts.push(this); } } },
    setInterval: (callback: () => void) => { const id = ++nextTimer; timers.set(id, callback); return id; },
    clearInterval: (id: number) => { timers.delete(id); },
  };
  const descriptors = Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { value, configurable: true });
  const audio = new GameAudio();
  try {
    run({ audio, contexts, timers, tick: () => { for (const callback of [...timers.values()]) callback(); } });
  } finally {
    audio.dispose();
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
}

function player(context: FakeContext) {
  const output = context.createGain();
  const music = new MusicPlayer(
    context as unknown as AudioContext,
    output as unknown as AudioNode,
    context.createBuffer(1, 8000) as unknown as AudioBuffer,
  );
  return { music, output };
}

test('music waits for a gesture and repeated unlocks keep one context and one sequencer', () => withAudio(({ audio, contexts, timers }) => {
  audio.setMusic('overworld');
  audio.play('swing');
  assert.equal(contexts.length, 0);
  assert.equal(timers.size, 0);
  audio.unlock();
  assert.equal(contexts.length, 1);
  const context = contexts[0];
  assert.ok(context.sources.length > 0, 'The queued theme starts after the gesture');
  const sources = context.sources.length, nodes = context.nodes.length;
  const timerIds = [...timers.keys()];
  assert.equal(timerIds.length, 1);
  audio.setMusic('overworld');
  audio.unlock();
  audio.unlock();
  assert.equal(contexts.length, 1);
  assert.equal(context.sources.length, sources);
  assert.equal(context.nodes.length, nodes, 'Repeated state syncs must not create overlapping layers');
  assert.deepEqual([...timers.keys()], timerIds);
}));

test('boss warning, lunge, and explosion cues produce finite, bounded audio voices', () => withAudio(({ audio, contexts }) => {
  audio.unlock();
  const context = contexts[0];
  for (const cue of ['boss-windup', 'boss-lunge', 'ranged-explode'] as const) {
    const before = context.sources.length;
    audio.play(cue);
    const voices = context.sources.slice(before);
    assert.ok(voices.length > 0, `${cue} should be audible`);
    assert.ok(voices.every(voice => voice.stopTimes[0] > voice.startTime! && voice.stopTimes[0] < 1));
  }
  context.advanceTo(1);
  assert.ok(context.sources.every(source => source.ended && source.disconnected));
}));

test('mute and paused music stop scheduling and unmute uses the most recently selected track', () => withAudio(({ audio, contexts, timers, tick }) => {
  audio.setMusic('overworld');
  audio.unlock();
  const context = contexts[0];
  audio.setMuted(true);
  assert.equal(timers.size, 0);
  const beforeMute = context.sources.length;
  audio.setMusic('boss');
  audio.unlock();
  audio.play('hit');
  context.advanceTo(1);
  tick();
  assert.equal(context.sources.length, beforeMute);
  assert.ok(context.sources.every(source => source.ended));
  audio.setMuted(false);
  assert.equal(timers.size, 1);
  const resumed = context.sources.slice(beforeMute);
  assert.ok(resumed.length > 0);
  const firstLead = MUSIC_SCORES.boss.notes.find(note => note.voice === 'lead')!;
  assert.ok(resumed.some(source => source.frequency.events.some(event => event.value === 440 * 2 ** ((firstLead.midi - 69) / 12))),
    'Changing areas while muted must select the new theme when unmuted');
  audio.setMusic(null);
  assert.equal(timers.size, 0);
  const beforePause = context.sources.length;
  context.advanceTo(2);
  tick();
  audio.setMuted(true);
  audio.setMuted(false);
  assert.equal(context.sources.length, beforePause, 'Unmuting while paused must not restart a theme');
  assert.ok(context.sources.every(source => source.ended));
}));

test('changing tracks fades outgoing layers and cancels their already scheduled voices', () => withAudio(({ timers }) => {
  const context = new FakeContext();
  const { music, output } = player(context);
  try {
    music.setTrack('overworld');
    const outgoing = [...context.sources];
    const oldLayer = context.nodes.find(node => node instanceof FakeGain && node.outputs.includes(output)) as FakeGain;
    assert.ok(outgoing.some(source => source.startTime! > context.currentTime), 'The sequencer schedules ahead of playback');
    context.advanceTo(0.01);
    music.setTrack('dungeon');
    assert.equal(timers.size, 1);
    assert.ok(oldLayer.gain.events.some(event => event.kind === 'linear' && event.value === 0 && event.time > context.currentTime));
    for (const source of outgoing) {
      assert.equal(source.stopTimes.length, 2, 'The natural note ending is replaced by a fade cutoff');
      assert.ok(source.stopTimes.at(-1)! < 0.6);
    }
    assert.equal(oldLayer.disconnected, false, 'The output stays connected during its fade');
    context.advanceTo(0.6);
    assert.ok(outgoing.every(source => source.ended && source.disconnected));
    assert.equal(oldLayer.disconnected, true, 'Retired layers release their output after the last voice ends');
  } finally { music.dispose(); }
}));

test('the audio clock schedules a seamless repeat across the end of a score', () => withAudio(({ tick }) => {
  const context = new FakeContext();
  const { music } = player(context);
  try {
    music.setTrack('boss');
    const firstStarts = context.sources.map(source => source.startTime!);
    const score = MUSIC_SCORES.boss;
    const loopSeconds = score.beats * 60 / score.bpm;
    for (let now = 0.025; now < loopSeconds + 0.08; now += 0.025) {
      context.advanceTo(now);
      tick();
    }
    const repeatedStarts = context.sources.map(source => source.startTime!).filter(start => start >= loopSeconds && start < loopSeconds + 0.18);
    assert.equal(repeatedStarts.length, firstStarts.length, 'The next downbeat plays each initial voice exactly once');
    for (let index = 0; index < firstStarts.length; index++) {
      assert.ok(Math.abs(repeatedStarts[index] - firstStarts[index] - loopSeconds) < 1e-9);
    }
    assert.ok(context.sources.slice(0, firstStarts.length).every(source => source.ended && source.disconnected));
  } finally { music.dispose(); }
}));

test('a delayed timer skips missed notes instead of bursting several loops of audio', () => withAudio(({ tick }) => {
  const context = new FakeContext();
  const { music } = player(context);
  try {
    music.setTrack('boss');
    const firstCount = context.sources.length;
    const score = MUSIC_SCORES.boss;
    const loopSeconds = score.beats * 60 / score.bpm;
    context.advanceTo(loopSeconds * 3 + 0.03);
    tick();
    const recovered = context.sources.slice(firstCount);
    assert.equal(recovered.length, firstCount, 'Only the next downbeat is scheduled after the long delay');
    assert.ok(recovered.every(source => source.startTime! >= context.currentTime && source.startTime! < context.currentTime + 0.18));
    tick();
    assert.equal(context.sources.length, firstCount + recovered.length, 'Repeated ticks never schedule the same beat twice');
  } finally { music.dispose(); }
}));

test('suspended contexts produce no new voices and a later gesture resumes playback', () => withAudio(({ audio, contexts, tick }) => {
  audio.setMusic('dungeon');
  audio.unlock();
  const context = contexts[0];
  context.state = 'suspended';
  const before = context.sources.length;
  tick();
  tick();
  assert.equal(context.sources.length, before);
  audio.setMusic('boss');
  assert.equal(context.sources.length, before, 'A track change cannot schedule audio into a suspended context');
  audio.unlock();
  assert.equal(context.resumes, 1);
  tick();
  assert.ok(context.sources.length > before);
}));

test('disposal clears every timer, stops live sources, disconnects music nodes, and prevents restart', () => withAudio(({ audio, contexts, timers, tick }) => {
  audio.setMusic('overworld');
  audio.unlock();
  const context = contexts[0];
  // Preserve the shared output graph; everything subsequently allocated belongs to music.
  const musicNodes = context.nodes.slice(3);
  audio.setMusic('boss');
  const allMusicNodes = context.nodes.slice(3);
  assert.ok(allMusicNodes.length > musicNodes.length, 'Both current and retiring layers are present');
  audio.dispose();
  assert.equal(timers.size, 0);
  assert.equal(context.closes, 1);
  assert.ok(allMusicNodes.every(node => node.disconnected));
  assert.ok(context.sources.every(source => source.stopTimes.at(-1) === context.currentTime && source.onended === null));
  const sources = context.sources.length;
  tick();
  audio.setMusic('dungeon');
  audio.unlock();
  audio.play('swing');
  audio.dispose();
  assert.equal(context.sources.length, sources);
  assert.equal(contexts.length, 1);
  assert.equal(context.closes, 1);
}));
