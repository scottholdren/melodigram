/**
 * Nonogram line solver using constraint propagation.
 * Returns solve status plus diagnostics on problematic rows/columns.
 */

type Cell = 0 | 1 | -1; // 0=unknown, 1=filled, -1=empty

function generatePlacements(clues: number[], length: number): boolean[][] {
  const results: boolean[][] = [];

  function place(clueIdx: number, pos: number, current: boolean[]): void {
    if (clueIdx === clues.length) {
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
      while (line.length < start) line.push(false);
      for (let i = 0; i < clueLen; i++) line.push(true);
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

function filterPlacements(placements: boolean[][], known: Cell[]): boolean[][] {
  return placements.filter((p) =>
    p.every((val, i) => {
      if (known[i] === 0) return true;
      return val === (known[i] === 1);
    })
  );
}

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

export interface LineDiag {
  index: number;
  type: "row" | "col";
  clue: number[];
  possiblePlacements: number; // how many valid placements remain
  unknownCells: number; // how many cells still undetermined
}

export interface SolverResult {
  solved: boolean;
  grid: Cell[][];
  iterations: number;
  totalCells: number;
  solvedCells: number;
  /** Rows/cols that still have unknown cells, sorted by most problematic first */
  problematic: LineDiag[];
  /** true if solver hit a contradiction (impossible clue combination) */
  contradiction: boolean;
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

  const rowPlacements = rowClues.map((clue) => generatePlacements(clue, cols));
  const colPlacements = colClues.map((clue) => generatePlacements(clue, rows));

  let changed = true;
  let iterations = 0;
  const maxIterations = 100;
  let contradiction = false;

  while (changed && iterations < maxIterations) {
    changed = false;
    iterations++;

    for (let r = 0; r < rows; r++) {
      const known = grid[r];
      const valid = filterPlacements(rowPlacements[r], known);
      rowPlacements[r] = valid;

      if (valid.length === 0) {
        contradiction = true;
        break;
      }

      const deduced = deduceLine(valid, cols);
      for (let c = 0; c < cols; c++) {
        if (grid[r][c] === 0 && deduced[c] !== 0) {
          grid[r][c] = deduced[c];
          changed = true;
        }
      }
    }

    if (contradiction) break;

    for (let c = 0; c < cols; c++) {
      const known: Cell[] = [];
      for (let r = 0; r < rows; r++) known.push(grid[r][c]);

      const valid = filterPlacements(colPlacements[c], known);
      colPlacements[c] = valid;

      if (valid.length === 0) {
        contradiction = true;
        break;
      }

      const deduced = deduceLine(valid, rows);
      for (let r = 0; r < rows; r++) {
        if (grid[r][c] === 0 && deduced[r] !== 0) {
          grid[r][c] = deduced[r];
          changed = true;
        }
      }
    }

    if (contradiction) break;
  }

  const totalCells = rows * cols;
  let solvedCells = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] !== 0) solvedCells++;
    }
  }

  // Build diagnostics for unsolved lines
  const problematic: LineDiag[] = [];

  for (let r = 0; r < rows; r++) {
    const unknowns = grid[r].filter((c) => c === 0).length;
    if (unknowns > 0) {
      problematic.push({
        index: r,
        type: "row",
        clue: rowClues[r],
        possiblePlacements: rowPlacements[r].length,
        unknownCells: unknowns,
      });
    }
  }

  for (let c = 0; c < cols; c++) {
    let unknowns = 0;
    for (let r = 0; r < rows; r++) {
      if (grid[r][c] === 0) unknowns++;
    }
    if (unknowns > 0) {
      problematic.push({
        index: c,
        type: "col",
        clue: colClues[c],
        possiblePlacements: colPlacements[c].length,
        unknownCells: unknowns,
      });
    }
  }

  // Sort: most possible placements = most ambiguous = most problematic
  problematic.sort((a, b) => b.possiblePlacements - a.possiblePlacements);

  const solved = solvedCells === totalCells && !contradiction;
  return { solved, grid, iterations, totalCells, solvedCells, problematic, contradiction };
}

/**
 * Compute nonogram clues from a boolean line.
 */
export function computeClues(line: boolean[]): number[] {
  const clues: number[] = [];
  let run = 0;
  for (const cell of line) {
    if (cell) { run++; } else if (run > 0) { clues.push(run); run = 0; }
  }
  if (run > 0) clues.push(run);
  return clues;
}

/**
 * Run full solvability check on a grid (solution).
 * Returns a human-readable report.
 */
export function checkSolvability(
  solution: boolean[][],
  rowLabels?: string[],
  colLabels?: string[]
): { result: SolverResult; report: string } {
  const rows = solution.length;
  const cols = solution[0]?.length || 0;

  const rowClues = solution.map((row) => computeClues(row));
  const colClues: number[][] = [];
  for (let c = 0; c < cols; c++) {
    colClues.push(computeClues(solution.map((row) => row[c])));
  }

  const result = solve(rows, cols, rowClues, colClues);
  const pct = Math.round((result.solvedCells / result.totalCells) * 100);

  let report = "";

  if (result.contradiction) {
    report += "CONTRADICTION — the clues are internally inconsistent (bug in solver or clue generation).\n\n";
  }

  if (result.solved) {
    report += `SOLVABLE — the puzzle is uniquely solvable by logic alone.\n`;
    report += `${result.totalCells} cells resolved in ${result.iterations} iterations.\n`;
  } else {
    report += `NOT SOLVABLE by line logic alone.\n`;
    report += `${result.solvedCells}/${result.totalCells} cells resolved (${pct}%), ${result.totalCells - result.solvedCells} ambiguous.\n`;
    report += `Solved in ${result.iterations} iterations before getting stuck.\n\n`;

    // Group problematic lines
    const probRows = result.problematic.filter((p) => p.type === "row");
    const probCols = result.problematic.filter((p) => p.type === "col");

    if (probRows.length > 0) {
      report += `Problem rows (${probRows.length}):\n`;
      for (const p of probRows) {
        const label = rowLabels ? rowLabels[p.index] : `Row ${p.index + 1}`;
        report += `  ${label}: clue [${p.clue.join(",")}] — ${p.possiblePlacements} possible placements, ${p.unknownCells} unknown cells\n`;
      }
      report += "\n";
    }

    if (probCols.length > 0) {
      report += `Problem columns (${probCols.length}):\n`;
      for (const p of probCols) {
        const label = colLabels ? colLabels[p.index] : `Col ${p.index + 1}`;
        report += `  ${label}: clue [${p.clue.join(",")}] — ${p.possiblePlacements} possible placements, ${p.unknownCells} unknown cells\n`;
      }
      report += "\n";
    }

    // Suggestions
    report += "Tips to improve solvability:\n";

    // Find duplicate clues
    const rowClueStrs = rowClues.map((c) => c.join(","));
    const colClueStrs = colClues.map((c) => c.join(","));
    const dupRows = rowClueStrs.filter((c, i) => rowClueStrs.indexOf(c) !== i);
    const dupCols = colClueStrs.filter((c, i) => colClueStrs.indexOf(c) !== i);

    if (dupRows.length > 0) {
      const unique = [...new Set(dupRows)];
      for (const dup of unique) {
        const indices = rowClueStrs.map((c, i) => c === dup ? i : -1).filter((i) => i >= 0);
        const labels = indices.map((i) => rowLabels ? rowLabels[i] : `Row ${i + 1}`);
        report += `  - Duplicate row clue [${dup}] in: ${labels.join(", ")} — these rows are interchangeable\n`;
      }
    }

    if (dupCols.length > 0) {
      const unique = [...new Set(dupCols)];
      for (const dup of unique) {
        const indices = colClueStrs.map((c, i) => c === dup ? i : -1).filter((i) => i >= 0);
        const labels = indices.map((i) => colLabels ? colLabels[i] : `Col ${i + 1}`);
        report += `  - Duplicate col clue [${dup}] in: ${labels.join(", ")} — these columns are interchangeable\n`;
      }
    }

    // Find very short clues (low constraint)
    const weakLines = result.problematic.filter((p) => p.possiblePlacements > 10);
    if (weakLines.length > 0) {
      report += `  - ${weakLines.length} lines have 10+ possible placements — add more notes to constrain them\n`;
    }

    const fillRate = solution.flat().filter(Boolean).length / result.totalCells;
    if (fillRate < 0.4) {
      report += `  - Fill rate is ${Math.round(fillRate * 100)}% — puzzles under 40% are rarely solvable. Add more notes.\n`;
    }
  }

  return { result, report };
}
