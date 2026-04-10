import type { Puzzle } from "./types";
import twinkle from "./twinkle-twinkle";
import mary from "./mary-had-a-little-lamb";

export { type Puzzle, combined, isMusic, isExtra } from "./types";

// Puzzle library. Order here determines level select order.
// To add a puzzle: drop a .ts file in this folder and import it here.
export const PUZZLES: Puzzle[] = [
  twinkle,
  mary,
];

export function getPuzzleById(id: string): Puzzle | undefined {
  return PUZZLES.find((p) => p.id === id);
}
