// Paste this into src/puzzles/the-entertainer.ts
// Then add to src/puzzles/index.ts:
//   import the_entertainer from "./the-entertainer";
//   export const PUZZLES = [..., the_entertainer];

// 12 pitches × 8 steps · 14 music + 16 extras
// Row clues: [2], [1,1], [3], [2], [4], [1], [1], [5], [2,1], [1,1,1], [2], [2]
// Col clues: [2,1], [1,4], [1,2], [2,1,1,2], [3,2,1], [2,1,1], [2,1], []

import type { Puzzle } from "./types";

// The Entertainer14 music cells + 16 silent extras
const puzzle: Puzzle = {
  id: "the-entertainer",
  title: "The Entertainer",
  composer: "",
  category: "",
  difficulty: "easy",
  pitches: ["E6", "D6", "C6", "B5", "A5", "G5", "E5", "D5", "C5", "B4", "A4", "G4"],
  bpm: 165,
  music: [
    [false,  true, false, false, false, false, false, false], // E6
    [ true, false, false, false, false, false, false, false], // D6
    [false, false,  true, false, false, false, false, false], // C6
    [false, false, false, false, false,  true, false, false], // B5
    [false, false, false,  true,  true, false, false, false], // A5
    [false, false, false, false, false, false,  true, false], // G5
    [false,  true, false, false, false, false, false, false], // E5
    [ true, false, false, false, false, false, false, false], // D5
    [false, false,  true, false, false, false, false, false], // C5
    [false, false, false, false, false,  true, false, false], // B4
    [false, false, false,  true,  true, false, false, false], // A4
    [false, false, false, false, false, false,  true, false], // G4
  ],
  extras: [
    [ true, false, false, false, false, false, false, false], // E6
    [false, false, false,  true, false, false, false, false], // D6
    [false, false, false,  true,  true, false, false, false], // C6
    [false, false, false, false,  true, false, false, false], // B5
    [false, false, false, false, false,  true,  true, false], // A5
    [false, false, false, false, false, false, false, false], // G5
    [false, false, false, false, false, false, false, false], // E5
    [false,  true,  true,  true,  true, false, false, false], // D5
    [false,  true, false, false,  true, false, false, false], // C5
    [false,  true, false,  true, false, false, false, false], // B4
    [false, false, false, false, false, false, false, false], // A4
    [false, false, false, false, false,  true, false, false], // G4
  ],
};

export default puzzle;
