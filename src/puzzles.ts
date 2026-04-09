export interface Puzzle {
  id: string;
  title: string;
  revealTitle: string;
  pitches: string[];
  bpm: number;
  solution: boolean[][];
}

export const ODE_TO_JOY: Puzzle = {
  id: "ode-to-joy",
  title: "Can you hear it?",
  revealTitle: "Ode to Joy — Beethoven",
  pitches: ["G4", "F4", "E4", "D4", "C4", "G3", "C3"],
  bpm: 92,
  solution: [
    [ true, false, false,  true,  true, false,  true,  true], // G4
    [false, false,  true, false, false,  true, false,  true], // F4
    [ true,  true, false, false, false, false,  true, false], // E4
    [false, false, false, false, false,  true, false,  true], // D4
    [false, false, false,  true,  true,  true, false, false], // C4
    [ true,  true, false,  true,  true, false,  true,  true], // G3
    [ true, false, false,  true, false,  true, false,  true], // C3
  ],
};

// The Entertainer — Scott Joplin
// 12 pitches × 16 eighth notes (pickup + 3.5 bars of 2/4)
// Melody: D4 D#4 E4 C5 . E4 C5 . E4 C5 . C5 D5 D#5 E5 C5
// Bass: ragtime oom-pah (C chord bars 1-2, F chord bar 3, resolve C)
export const ENTERTAINER: Puzzle = {
  id: "entertainer",
  title: "A ragtime classic",
  revealTitle: "The Entertainer — Scott Joplin",
  pitches: ["E5", "D#5", "D5", "C5", "E4", "D#4", "D4", "C4", "A3", "G3", "F3", "C3"],
  bpm: 160, // eighth note BPM for ragtime feel
  solution: [
    //  1      2      3      4      5      6      7      8      9     10     11     12     13     14     15     16
    [false, false, false, false, false, false, false, false, false, false, false, false, false, false,  true, false], // E5
    [false, false, false, false, false, false, false, false, false, false, false, false, false,  true, false, false], // D#5
    [false, false, false, false, false, false, false, false, false, false, false, false,  true, false, false, false], // D5
    [false, false, false,  true, false, false,  true, false, false,  true, false,  true, false, false, false,  true], // C5
    [false, false,  true, false,  true,  true,  true,  true,  true, false,  true, false, false, false, false, false], // E4
    [false,  true, false, false, false, false, false, false, false, false, false, false, false, false, false, false], // D#4
    [ true, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false], // D4
    [false, false,  true, false,  true, false,  true, false,  true, false,  true, false,  true, false,  true,  true], // C4
    [false, false, false, false, false, false, false, false, false, false, false, false,  true, false,  true, false], // A3
    [false, false,  true, false,  true, false,  true, false,  true, false,  true,  true, false, false, false, false], // G3
    [false, false, false, false, false, false, false, false, false, false, false,  true, false,  true, false, false], // F3
    [ true,  true,  true,  true, false,  true, false,  true, false,  true, false, false, false, false, false,  true], // C3
  ],
};

export const ALL_PUZZLES = [ODE_TO_JOY, ENTERTAINER];
