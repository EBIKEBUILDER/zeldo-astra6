import test from 'node:test';
import assert from 'node:assert/strict';
import { MUSIC_SCORES } from './music';
import type { MusicTrack, MusicVoice } from './music';

const tracks: MusicTrack[] = ['overworld', 'dungeon', 'boss'];
const voices = new Set<MusicVoice>(['lead', 'bell', 'pad', 'bass', 'kick', 'snare', 'hat']);

for (const track of tracks) {
  test(`${track} score can be scheduled and looped without invalid audio parameters`, () => {
    const score = MUSIC_SCORES[track];
    assert.ok(Number.isFinite(score.bpm) && score.bpm > 0, 'Tempo must produce a finite positive beat length');
    assert.ok(Number.isFinite(score.beats) && score.beats > 0, 'A loop must have a finite positive length');
    assert.ok(score.notes.length > 0, 'The selected track must contain music');
    let previousBeat = -Infinity;
    for (const [index, note] of score.notes.entries()) {
      const label = `${track} note ${index}`;
      assert.ok(Number.isFinite(note.beat) && note.beat >= 0 && note.beat < score.beats, `${label}: start inside loop`);
      assert.ok(note.beat >= previousBeat, `${label}: chronological order required by scheduler`);
      assert.ok(Number.isFinite(note.duration) && note.duration > 0, `${label}: positive finite duration`);
      assert.ok(note.beat + note.duration <= score.beats + 1e-9, `${label}: end inside loop`);
      assert.ok(Number.isInteger(note.midi) && note.midi >= 0 && note.midi <= 127, `${label}: legal MIDI pitch`);
      assert.ok(Number.isFinite(note.velocity) && note.velocity > 0 && note.velocity <= 1, `${label}: audible normalized velocity`);
      assert.ok(voices.has(note.voice), `${label}: supported synth voice`);
      previousBeat = note.beat;
    }
  });
}
