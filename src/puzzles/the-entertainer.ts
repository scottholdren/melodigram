import type { Puzzle } from "./types";
import { pianoRow } from "./types";

const puzzle: Puzzle = {
  id: "the-entertainer",
  title: "The Entertainer",
  composer: "Scott Joplin",
  category: "Ragtime",
  difficulty: "medium",
  bpm: 165,
  rows: [
    pianoRow("E6"), pianoRow("D6"), pianoRow("C6"),
    pianoRow("B5"), pianoRow("A5"), pianoRow("G5"),
    pianoRow("E5"), pianoRow("D5"), pianoRow("C5"),
    pianoRow("B4"), pianoRow("A4"), pianoRow("G4"),
  ],
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
