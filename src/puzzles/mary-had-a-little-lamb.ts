import type { Puzzle } from "./types";
import { pianoRow } from "./types";

const puzzle: Puzzle = {
  id: "mary-had-a-little-lamb",
  title: "Mary Had a Little Lamb",
  composer: "Traditional",
  category: "Classic",
  difficulty: "easy",
  bpm: 100,
  rows: [
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
    [false, false, false, false, false, false, false], // G4
    [false, false, false, false, false, false, false], // F4
    [ true, false, false, false,  true,  true,  true], // E4
    [false,  true, false,  true, false, false, false], // D4
    [false, false,  true, false, false, false, false], // C4
    [ true, false, false,  true, false, false,  true], // G3
    [ true,  true,  true,  true,  true,  true,  true], // C3
  ],
  extras: [
    [false, false, false, false, false, false, false],
    [false, false, false, false, false, false, false],
    [false, false, false, false, false, false, false],
    [false, false,  true, false, false, false, false],
    [false, false, false, false, false, false, false],
    [false, false, false, false, false, false, false],
    [false, false, false, false, false, false, false],
  ],
};

export default puzzle;
