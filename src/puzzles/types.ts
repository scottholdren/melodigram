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
  /**
   * Optional: which music cells start a new note attack.
   * If omitted, the player computes attacks from runs — first cell of every
   * consecutive run of music cells is treated as a new attack, so held notes
   * work but trills merge into single sustained notes. Set this explicitly to
   * preserve rapid repeated notes from MIDI imports.
   */
  attacks?: boolean[][];
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

/**
 * Compute default attack markers from a music grid: the first cell of every
 * consecutive run of filled cells is an attack. Used when a puzzle doesn't
 * ship with explicit attack data.
 */
export function deriveAttacks(music: boolean[][]): boolean[][] {
  return music.map((row) => {
    const out = Array(row.length).fill(false);
    for (let c = 0; c < row.length; c++) {
      if (row[c] && (c === 0 || !row[c - 1])) out[c] = true;
    }
    return out;
  });
}

/** Get the attack grid for a puzzle, deriving from music if not present. */
export function getAttacks(p: Puzzle): boolean[][] {
  return p.attacks || deriveAttacks(p.music);
}
