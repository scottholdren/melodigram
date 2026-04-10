import type { Puzzle } from "./types";

// Twinkle Twinkle Little Star — first phrase
// C C G G A A G with basic bass accompaniment
// No extras needed — the music alone is line-solvable.
const puzzle: Puzzle = {
  id: "twinkle-twinkle",
  title: "Twinkle Twinkle Little Star",
  composer: "Traditional",
  category: "Classic",
  difficulty: "easy",
  pitches: ["A4", "G4", "F4", "E4", "D4", "C4", "G3", "C3"],
  bpm: 100,
  music: [
    //  1      2      3      4      5      6      7
    [false, false, false, false,  true,  true, false], // A4
    [false, false,  true,  true, false, false,  true], // G4
    [false, false, false, false, false, false, false], // F4
    [false, false, false, false, false, false, false], // E4
    [false, false, false, false, false, false, false], // D4
    [ true,  true, false, false, false, false, false], // C4
    [ true, false,  true, false,  true, false,  true], // G3
    [ true,  true,  true,  true,  true,  true,  true], // C3
  ],
  extras: [
    [false, false, false, false, false, false, false],
    [false, false, false, false, false, false, false],
    [false, false, false, false, false, false, false],
    [false, false, false, false, false, false, false],
    [false, false, false, false, false, false, false],
    [false, false, false, false, false, false, false],
    [false, false, false, false, false, false, false],
    [false, false, false, false, false, false, false],
  ],
};

export default puzzle;
