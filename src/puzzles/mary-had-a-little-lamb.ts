import type { Puzzle } from "./types";

// Mary Had a Little Lamb — first phrase
// E D C D E E E with bass accompaniment
// 1 silent extra added to make it fully line-solvable.
const puzzle: Puzzle = {
  id: "mary-had-a-little-lamb",
  title: "Mary Had a Little Lamb",
  composer: "Traditional",
  category: "Classic",
  difficulty: "easy",
  pitches: ["G4", "F4", "E4", "D4", "C4", "G3", "C3"],
  bpm: 100,
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
    [false, false,  true, false, false, false, false], // extra
    [false, false, false, false, false, false, false],
    [false, false, false, false, false, false, false],
    [false, false, false, false, false, false, false],
  ],
};

export default puzzle;
