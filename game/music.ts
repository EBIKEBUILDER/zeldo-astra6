export type MusicTrack = 'overworld' | 'dungeon' | 'boss';
export type MusicVoice = 'lead' | 'bell' | 'pad' | 'bass' | 'kick' | 'snare' | 'hat';

export type MusicNote = {
  beat: number;
  duration: number;
  midi: number;
  velocity: number;
  voice: MusicVoice;
};

export type MusicScore = {
  bpm: number;
  beats: number;
  notes: readonly MusicNote[];
};

// Original sixteen-bar compositions. Positions and durations use quarter-note beats.
type PhraseNote = readonly [offset: number, midi: number, duration: number];
type Harmony = { bass: number; chord: readonly number[] };

function note(
  notes: MusicNote[], voice: MusicVoice, beat: number, duration: number,
  midi: number, velocity: number,
): void {
  notes.push({ voice, beat, duration, midi, velocity });
}

function phrase(notes: MusicNote[], voice: MusicVoice, bar: number, melody: readonly PhraseNote[], velocity: number): void {
  melody.forEach(([offset, midi, duration], index) => {
    note(notes, voice, bar * 4 + offset, duration, midi, velocity * (index % 3 === 1 ? 0.86 : 1));
  });
}

function finish(bpm: number, notes: MusicNote[]): MusicScore {
  return { bpm, beats: 64, notes: notes.sort((left, right) => left.beat - right.beat) };
}

/** A bright G-major walking tune, with an answering phrase in the second half. */
function overworld(): MusicScore {
  const notes: MusicNote[] = [];
  const harmonies: Harmony[] = [
    { bass: 43, chord: [59, 62, 67] }, // G
    { bass: 42, chord: [57, 62, 66] }, // D/F#
    { bass: 40, chord: [55, 59, 64] }, // Em
    { bass: 36, chord: [55, 60, 64] }, // C
    { bass: 47, chord: [55, 62, 67] }, // G/B
    { bass: 45, chord: [57, 60, 64] }, // Am
    { bass: 36, chord: [55, 60, 64] }, // C
    { bass: 38, chord: [57, 62, 66] }, // D
    { bass: 40, chord: [55, 59, 64] },
    { bass: 36, chord: [55, 60, 64] },
    { bass: 43, chord: [59, 62, 67] },
    { bass: 38, chord: [57, 62, 66] },
    { bass: 45, chord: [57, 60, 64] },
    { bass: 36, chord: [55, 60, 64] },
    { bass: 38, chord: [57, 62, 66] },
    { bass: 38, chord: [57, 62, 66] },
  ];
  const melody: readonly (readonly PhraseNote[])[] = [
    [[0, 67, .7], [1, 74, .4], [1.5, 71, .4], [2, 69, .7], [3, 71, .4], [3.5, 74, .4]],
    [[0, 78, .7], [1, 74, .7], [2, 69, 1.35], [3.5, 66, .4]],
    [[0, 67, .7], [1, 71, .4], [1.5, 74, .4], [2, 76, .7], [3, 74, .7]],
    [[0, 72, 1.4], [1.5, 71, .4], [2, 69, .7], [3, 67, .7]],
    [[0, 71, .7], [1, 74, .7], [2, 79, .7], [3, 78, .4], [3.5, 76, .4]],
    [[0, 76, .7], [1, 72, .7], [2, 69, 1.35], [3.5, 71, .4]],
    [[0, 72, .7], [1, 76, .4], [1.5, 74, .4], [2, 72, .7], [3, 67, .7]],
    [[0, 69, .7], [1, 66, .7], [2, 74, 1.4]],
    [[0, 76, .7], [1, 79, .4], [1.5, 78, .4], [2, 76, .7], [3, 71, .7]],
    [[0, 72, .7], [1, 76, .7], [2, 79, 1.35], [3.5, 76, .4]],
    [[0, 74, .7], [1, 71, .4], [1.5, 69, .4], [2, 67, .7], [3, 71, .7]],
    [[0, 69, 1.4], [1.5, 74, .4], [2, 78, .7], [3, 76, .7]],
    [[0, 76, .7], [1, 72, .7], [2, 69, .7], [3, 72, .4], [3.5, 74, .4]],
    [[0, 76, .7], [1, 79, .7], [2, 76, .7], [3, 72, .7]],
    [[0, 74, .7], [1, 69, .4], [1.5, 71, .4], [2, 74, .7], [3, 78, .7]],
    [[0, 76, .7], [1, 74, .7], [2, 69, .7], [3, 66, .65]],
  ];

  harmonies.forEach(({ bass, chord }, bar) => {
    const beat = bar * 4;
    phrase(notes, 'lead', bar, melody[bar], .63);
    // The accompaniment leaves room around the melody, especially on downbeats.
    chord.forEach(midi => note(notes, 'pad', beat, 3.6, midi, .15));
    note(notes, 'bass', beat, .72, bass, .6);
    note(notes, 'bass', beat + 2, .72, bass + 7, .48);
    note(notes, 'bell', beat + .75, .4, chord[1] + 12, .24);
    note(notes, 'bell', beat + 2.75, .4, chord[2] + 12, .2);
    note(notes, 'kick', beat, .16, 0, .38);
    note(notes, 'kick', beat + 2, .16, 0, .29);
    note(notes, 'snare', beat + 3, .12, 0, .18);
    [1, 2.5, 3.5].forEach(offset => note(notes, 'hat', beat + offset, .08, 0, .13));
  });
  return finish(112, notes);
}

/** Slow D-minor/add-nine harmony, isolated bell calls and a restrained low pulse. */
function dungeon(): MusicScore {
  const notes: MusicNote[] = [];
  const harmonies: Harmony[] = [
    { bass: 38, chord: [57, 64, 65] }, // Dm(add9)
    { bass: 38, chord: [57, 62, 65] },
    { bass: 34, chord: [57, 62, 65] }, // Bbmaj7
    { bass: 34, chord: [53, 57, 62] },
    { bass: 38, chord: [57, 64, 65] },
    { bass: 36, chord: [57, 60, 64] }, // Am/C
    { bass: 43, chord: [57, 58, 62] }, // Gm(add9)
    { bass: 33, chord: [55, 61, 64] }, // A7
    { bass: 38, chord: [57, 64, 65] },
    { bass: 41, chord: [57, 60, 64] }, // Fmaj7
    { bass: 34, chord: [57, 62, 65] },
    { bass: 36, chord: [55, 62, 64] }, // C(add9)
    { bass: 43, chord: [57, 58, 62] },
    { bass: 38, chord: [57, 62, 65] },
    { bass: 33, chord: [55, 61, 64] },
    { bass: 33, chord: [57, 61, 64] },
  ];
  const melody: readonly (readonly PhraseNote[])[] = [
    [[.5, 74, 1.5], [2.75, 81, .8]],
    [[1.5, 76, 1.8]],
    [[0, 77, 1.6], [2.5, 74, .9]],
    [[1.25, 69, 2]],
    [[.5, 74, 1.5], [2.75, 76, .8]],
    [[1, 72, 1.4], [3, 69, .7]],
    [[.5, 70, 1.7], [3, 74, .7]],
    [[1, 73, 1.6]],
    [[0, 81, 1.5], [2.5, 77, 1.1]],
    [[1, 76, 1.8]],
    [[.5, 74, 1.2], [2.5, 69, 1]],
    [[1.5, 67, 1.7]],
    [[0, 70, 1.5], [2.75, 69, .8]],
    [[.5, 65, 1.6], [3, 69, .7]],
    [[1, 73, 1.6], [3, 76, .7]],
    [[.5, 69, 2.4]],
  ];

  harmonies.forEach(({ bass, chord }, bar) => {
    const beat = bar * 4;
    chord.forEach(midi => note(notes, 'pad', beat, 3.85, midi, .2));
    note(notes, 'bass', beat, 2.8, bass, .43);
    phrase(notes, 'bell', bar, melody[bar], .47);
    if (bar % 2 === 0) {
      note(notes, 'kick', beat, .24, 0, .23);
      note(notes, 'hat', beat + 3.5, .12, 0, .065);
    }
    if (bar % 4 === 3) {
      note(notes, 'bell', beat + 3.5, .4, chord[0] + 12, .17);
    }
  });
  return finish(72, notes);
}

/** E-minor battle theme: pulsing eighth-note bass and a rising, syncopated lead. */
function boss(): MusicScore {
  const notes: MusicNote[] = [];
  const harmonies: Harmony[] = [
    { bass: 40, chord: [55, 59, 64] }, // Em
    { bass: 40, chord: [55, 59, 64] },
    { bass: 36, chord: [55, 60, 64] }, // C
    { bass: 38, chord: [57, 62, 66] }, // D
    { bass: 40, chord: [55, 59, 64] },
    { bass: 43, chord: [55, 59, 62] }, // G
    { bass: 36, chord: [55, 60, 64] },
    { bass: 35, chord: [54, 59, 63] }, // B
    { bass: 40, chord: [55, 59, 64] },
    { bass: 38, chord: [57, 62, 66] },
    { bass: 36, chord: [55, 60, 64] },
    { bass: 35, chord: [54, 59, 63] },
    { bass: 45, chord: [57, 60, 64] }, // Am
    { bass: 36, chord: [55, 60, 64] },
    { bass: 35, chord: [54, 59, 63] },
    { bass: 35, chord: [54, 59, 63] },
  ];
  const melody: readonly (readonly PhraseNote[])[] = [
    [[0, 76, .35], [.5, 76, .35], [1.5, 79, .35], [2, 78, .7], [3, 74, .35], [3.5, 76, .35]],
    [[0, 71, .7], [1, 74, .35], [1.5, 76, .35], [2.5, 79, .35], [3, 78, .7]],
    [[0, 76, .7], [1, 72, .35], [1.5, 74, .35], [2, 76, .7], [3, 79, .7]],
    [[0, 78, .35], [.5, 76, .35], [1.5, 74, .35], [2, 69, .7], [3, 74, .7]],
    [[0, 76, .35], [.5, 76, .35], [1.5, 79, .35], [2, 83, .7], [3, 81, .35], [3.5, 79, .35]],
    [[0, 79, .7], [1, 74, .35], [1.5, 71, .35], [2.5, 74, .35], [3, 79, .7]],
    [[0, 76, .7], [1, 79, .35], [1.5, 81, .35], [2, 79, .7], [3, 76, .7]],
    [[0, 75, .7], [1, 71, .35], [1.5, 75, .35], [2, 78, .7], [3, 75, .35], [3.5, 78, .35]],
    [[0, 83, .7], [1, 79, .35], [1.5, 81, .35], [2.5, 83, .35], [3, 79, .7]],
    [[0, 81, .7], [1, 78, .35], [1.5, 76, .35], [2, 74, .7], [3, 78, .7]],
    [[0, 79, .35], [.5, 79, .35], [1.5, 76, .35], [2, 72, .7], [3, 76, .7]],
    [[0, 78, .7], [1, 75, .35], [1.5, 71, .35], [2.5, 75, .35], [3, 78, .7]],
    [[0, 81, .7], [1, 76, .35], [1.5, 72, .35], [2, 76, .7], [3, 81, .7]],
    [[0, 79, .35], [.5, 76, .35], [1, 72, .7], [2, 76, .35], [2.5, 79, .35], [3, 84, .7]],
    [[0, 83, .7], [1, 78, .35], [1.5, 75, .35], [2, 78, .7], [3, 83, .7]],
    [[0, 81, .35], [.5, 78, .35], [1, 75, .7], [2, 71, .7], [3, 75, .35]],
  ];

  harmonies.forEach(({ bass, chord }, bar) => {
    const beat = bar * 4;
    phrase(notes, 'lead', bar, melody[bar], .7);
    chord.forEach(midi => note(notes, 'pad', beat, 3.6, midi, .16));
    [0, 0, 12, 0, 7, 0, 12, 7].forEach((interval, step) => {
      note(notes, 'bass', beat + step * .5, .32, bass + interval, step % 2 === 0 ? .66 : .5);
    });
    [0, 1.5, 2.5].forEach(offset => note(notes, 'kick', beat + offset, .16, 0, .55));
    [1, 3].forEach(offset => note(notes, 'snare', beat + offset, .13, 0, .38));
    [.5, 1.5, 2.5, 3.5].forEach(offset => note(notes, 'hat', beat + offset, .08, 0, .19));
    if (bar % 4 === 3) {
      // Short end-of-phrase fills lift the next downbeat without flooding combat cues.
      [3.5, 3.75].forEach(offset => note(notes, 'snare', beat + offset, .1, 0, .24));
    }
  });
  return finish(144, notes);
}

export const MUSIC_SCORES: Record<MusicTrack, MusicScore> = {
  overworld: overworld(),
  dungeon: dungeon(),
  boss: boss(),
};
