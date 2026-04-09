/**
 * Simple nonogram line solver using constraint propagation.
 * Returns true if the puzzle is uniquely solvable by line logic alone.
 */

type Cell = 0 | 1 | -1; // 0=unknown, 1=filled, -1=empty

/** Generate all valid placements for a set of clues in a line of given length */
function generatePlacements(clues: number[], length: number): boolean[][] {
  const results: boolean[][] = [];

  function place(clueIdx: number, pos: number, current: boolean[]): void {
    if (clueIdx === clues.length) {
      // Fill remaining with empty
      const line = [...current];
      while (line.length < length) line.push(false);
      results.push(line);
      return;
    }

    const clueLen = clues[clueIdx];
    const remainingClues = clues.slice(clueIdx + 1);
    const minRemaining = remainingClues.reduce((a, b) => a + b + 1, 0);
    const maxStart = length - clueLen - minRemaining;

    for (let start = pos; start <= maxStart; start++) {
      const line = [...current];
      // Fill gap before this clue with empty
      while (line.length < start) line.push(false);
      // Fill the clue run
      for (let i = 0; i < clueLen; i++) line.push(true);
      // Must have empty after (unless last clue at end)
      if (clueIdx < clues.length - 1) line.push(false);

      place(clueIdx + 1, line.length, line);
    }
  }

  if (clues.length === 0) {
    results.push(Array(length).fill(false));
  } else {
    place(0, 0, []);
  }

  return results;
}

/** Filter placements that are compatible with current known state */
function filterPlacements(placements: boolean[][], known: Cell[]): boolean[][] {
  return placements.filter((p) =>
    p.every((val, i) => {
      if (known[i] === 0) return true; // unknown, anything goes
      return val === (known[i] === 1);
    })
  );
}

/** From compatible placements, deduce cells that must be filled or empty */
function deduceLine(placements: boolean[][], length: number): Cell[] {
  const result: Cell[] = Array(length).fill(0);
  if (placements.length === 0) return result;

  for (let i = 0; i < length; i++) {
    const allFilled = placements.every((p) => p[i]);
    const allEmpty = placements.every((p) => !p[i]);
    if (allFilled) result[i] = 1;
    else if (allEmpty) result[i] = -1;
  }
  return result;
}

export interface SolverResult {
  solved: boolean;
  grid: Cell[][];
}

export function solve(
  rows: number,
  cols: number,
  rowClues: number[][],
  colClues: number[][]
): SolverResult {
  const grid: Cell[][] = Array.from({ length: rows }, () =>
    Array(cols).fill(0)
  );

  // Pre-generate all placements
  const rowPlacements = rowClues.map((clue) => generatePlacements(clue, cols));
  const colPlacements = colClues.map((clue) => generatePlacements(clue, rows));

  let changed = true;
  let iterations = 0;
  const maxIterations = 100;

  while (changed && iterations < maxIterations) {
    changed = false;
    iterations++;

    // Process rows
    for (let r = 0; r < rows; r++) {
      const known = grid[r];
      const valid = filterPlacements(rowPlacements[r], known);
      rowPlacements[r] = valid;

      if (valid.length === 0) {
        return { solved: false, grid }; // contradiction
      }

      const deduced = deduceLine(valid, cols);
      for (let c = 0; c < cols; c++) {
        if (grid[r][c] === 0 && deduced[c] !== 0) {
          grid[r][c] = deduced[c];
          changed = true;
        }
      }
    }

    // Process columns
    for (let c = 0; c < cols; c++) {
      const known: Cell[] = [];
      for (let r = 0; r < rows; r++) known.push(grid[r][c]);

      const valid = filterPlacements(colPlacements[c], known);
      colPlacements[c] = valid;

      if (valid.length === 0) {
        return { solved: false, grid }; // contradiction
      }

      const deduced = deduceLine(valid, rows);
      for (let r = 0; r < rows; r++) {
        if (grid[r][c] === 0 && deduced[r] !== 0) {
          grid[r][c] = deduced[r];
          changed = true;
        }
      }
    }
  }

  const solved = grid.every((row) => row.every((cell) => cell !== 0));
  return { solved, grid };
}
