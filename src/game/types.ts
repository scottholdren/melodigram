export interface Puzzle {
  name: string;
  rows: number;
  cols: number;
  rowClues: number[][];
  colClues: number[][];
  /** true = filled cell in the solution */
  solution: boolean[][];
  /**
   * Note for each filled cell, read left-to-right, top-to-bottom.
   * Length must equal the number of `true` cells in the solution.
   */
  melody: NoteEvent[];
  /** Beats per minute for melody playback */
  bpm: number;
}

export interface NoteEvent {
  note: string;       // e.g. "C4", "F#5"
  duration: string;   // Tone.js duration: "8n", "4n", "2n", etc.
}

export type CellState = "empty" | "filled" | "marked";

export interface GameState {
  puzzle: Puzzle;
  grid: CellState[][];
  solved: boolean;
}
