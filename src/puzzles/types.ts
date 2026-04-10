/**
 * Puzzle data format for the player.
 *
 * A puzzle has two layers:
 * - `music`: cells that play notes when filled
 * - `extras`: silent cells added for puzzle solvability (show in clues, no audio)
 *
 * The nonogram clues are computed from the combined pattern (music OR extras).
 *
 * Two kinds of puzzles:
 * - "piano" (default): rows are pitches like "C4", "G3". Plays piano samples.
 * - "drums": rows are drum sound names from drum-sounds.ts (e.g. "808 Kick").
 *   Plays drum samples. "pitches" field still stores the row labels.
 */
export interface Puzzle {
  id: string;
  title: string;
  composer?: string;
  category?: string;
  difficulty?: "easy" | "medium" | "hard";
  kind?: "piano" | "drums"; // default: "piano"
  pitches: string[]; // row labels top-to-bottom
  bpm: number;
  music: boolean[][]; // rows × cols
  extras: boolean[][]; // rows × cols (same dimensions as music)
}

/** Compute combined pattern = music OR extras */
export function combined(p: Puzzle): boolean[][] {
  return p.music.map((row, r) =>
    row.map((m, c) => m || p.extras[r]?.[c] === true)
  );
}

/** Is a cell a music cell in this puzzle? */
export function isMusic(p: Puzzle, r: number, c: number): boolean {
  return p.music[r]?.[c] === true;
}

/** Is a cell an extra (silent) in this puzzle? */
export function isExtra(p: Puzzle, r: number, c: number): boolean {
  return !isMusic(p, r, c) && p.extras[r]?.[c] === true;
}
