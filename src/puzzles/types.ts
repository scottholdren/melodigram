import type { InstrumentKey } from "../instruments";

/**
 * Puzzle data format.
 *
 * A puzzle is a grid with row labels + per-row instruments. Each row has
 * its own sound: piano notes, drum hits, synth bass, strings, whatever.
 * The music and extras grids tell you which cells are filled.
 */
export interface Puzzle {
  id: string;
  title: string;
  composer?: string;
  category?: string;
  difficulty?: "easy" | "medium" | "hard";
  bpm: number;

  rows: RowSound[];
  music: boolean[][];
  extras: boolean[][];
}

export interface RowSound {
  /** Display label shown to the right of the row (e.g. "C4", "808 Kick") */
  label: string;
  /** Which instrument plays this row */
  instrument: InstrumentKey;
  /** For pitched instruments: the pitch to play (e.g. "C4"). Required unless drumSound is set. */
  pitch?: string;
  /** For drum rows: the sound name from drum-sounds.ts */
  drumSound?: string;
}

/** Compute combined pattern = music OR extras */
export function combined(p: Puzzle): boolean[][] {
  return p.music.map((row, r) =>
    row.map((m, c) => m || p.extras[r]?.[c] === true)
  );
}

export function isMusic(p: Puzzle, r: number, c: number): boolean {
  return p.music[r]?.[c] === true;
}

export function isExtra(p: Puzzle, r: number, c: number): boolean {
  return !isMusic(p, r, c) && p.extras[r]?.[c] === true;
}

/** Helper: build a piano row from a pitch string */
export function pianoRow(pitch: string): RowSound {
  return { label: pitch, instrument: "piano", pitch };
}

/** Helper: build a drum row from a sound name */
export function drumRow(soundName: string): RowSound {
  return { label: soundName, instrument: "drums", drumSound: soundName };
}
