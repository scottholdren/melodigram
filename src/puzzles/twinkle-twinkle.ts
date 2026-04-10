import type { Puzzle } from "./types";
import { pianoRow } from "./types";

const puzzle: Puzzle = {
  id: "twinkle-twinkle",
  title: "Twinkle Twinkle Little Star",
  composer: "Traditional",
  category: "Classic",
  difficulty: "easy",
  bpm: 100,
  rows: [
    pianoRow("A4"),
    pianoRow("G4"),
    pianoRow("F4"),
    pianoRow("E4"),
    pianoRow("D4"),
    pianoRow("C4"),
    pianoRow("G3"),
    pianoRow("C3"),
  ],
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
