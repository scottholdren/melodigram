/**
 * Nonogram line solver using constraint propagation.
 * Async with progress callback. Caps placement enumeration to prevent browser hang.
 */

type Cell = 0 | 1 | -1; // 0=unknown, 1=filled, -1=empty

const MAX_PLACEMENTS = 5000; // per line — bail if exceeded

function generatePlacements(clues: number[], length: number): { placements: boolean[][]; capped: boolean } {
  const results: boolean[][] = [];
  let capped = false;

  function place(clueIdx: number, pos: number, current: boolean[]): void {
    if (results.length >= MAX_PLACEMENTS) { capped = true; return; }

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
      if (results.length >= MAX_PLACEMENTS) { capped = true; return; }
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

  return { placements: results, capped };
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
  possiblePlacements: number;
  unknownCells: number;
  capped: boolean; // true = too many placements, gave up counting
}

export interface SolverResult {
  solved: boolean;
  grid: Cell[][];
  iterations: number;
  totalCells: number;
  solvedCells: number;
  problematic: LineDiag[];
  contradiction: boolean;
}

export type ProgressCallback = (msg: string) => void;

/** Yield control to the browser so UI stays responsive */
function yieldUI(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

export async function solveAsync(
  rows: number,
  cols: number,
  rowClues: number[][],
  colClues: number[][],
  onProgress?: ProgressCallback
): Promise<SolverResult> {
  const grid: Cell[][] = Array.from({ length: rows }, () =>
    Array(cols).fill(0)
  );

  onProgress?.(`Generating placements for ${rows} rows...`);
  await yieldUI();

  // Pre-generate placements with cap
  const rowData = rowClues.map((clue, i) => {
    const r = generatePlacements(clue, cols);
    return { placements: r.placements, capped: r.capped };
  });

  onProgress?.(`Generating placements for ${cols} columns...`);
  await yieldUI();

  const colData = colClues.map((clue) => {
    const r = generatePlacements(clue, rows);
    return { placements: r.placements, capped: r.capped };
  });

  const cappedRows = rowData.filter((d) => d.capped).length;
  const cappedCols = colData.filter((d) => d.capped).length;

  let changed = true;
  let iterations = 0;
  const maxIterations = 100;
  let contradiction = false;

  while (changed && iterations < maxIterations) {
    changed = false;
    iterations++;
    onProgress?.(`Solving... iteration ${iterations} (${countSolved(grid, rows, cols)} / ${rows * cols} cells)`);
    await yieldUI();

    for (let r = 0; r < rows; r++) {
      const known = grid[r];
      const valid = filterPlacements(rowData[r].placements, known);
      rowData[r].placements = valid;

      if (valid.length === 0 && !rowData[r].capped) {
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

      const valid = filterPlacements(colData[c].placements, known);
      colData[c].placements = valid;

      if (valid.length === 0 && !colData[c].capped) {
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
  const solvedCells = countSolved(grid, rows, cols);

  const problematic: LineDiag[] = [];

  for (let r = 0; r < rows; r++) {
    const unknowns = grid[r].filter((c) => c === 0).length;
    if (unknowns > 0) {
      problematic.push({
        index: r, type: "row", clue: rowClues[r],
        possiblePlacements: rowData[r].placements.length,
        unknownCells: unknowns, capped: rowData[r].capped,
      });
    }
  }

  for (let c = 0; c < cols; c++) {
    let unknowns = 0;
    for (let r = 0; r < rows; r++) { if (grid[r][c] === 0) unknowns++; }
    if (unknowns > 0) {
      problematic.push({
        index: c, type: "col", clue: colClues[c],
        possiblePlacements: colData[c].placements.length,
        unknownCells: unknowns, capped: colData[c].capped,
      });
    }
  }

  problematic.sort((a, b) => b.possiblePlacements - a.possiblePlacements);

  const solved = solvedCells === totalCells && !contradiction;
  return { solved, grid, iterations, totalCells, solvedCells, problematic, contradiction };
}

function countSolved(grid: Cell[][], rows: number, cols: number): number {
  let n = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] !== 0) n++;
    }
  }
  return n;
}

/** Synchronous version for small puzzles (game page) */
export function solve(
  rows: number,
  cols: number,
  rowClues: number[][],
  colClues: number[][]
): SolverResult {
  const grid: Cell[][] = Array.from({ length: rows }, () =>
    Array(cols).fill(0)
  );

  const rowData = rowClues.map((clue) => generatePlacements(clue, cols));
  const colData = colClues.map((clue) => generatePlacements(clue, rows));

  let changed = true;
  let iterations = 0;
  const maxIterations = 100;
  let contradiction = false;

  while (changed && iterations < maxIterations) {
    changed = false;
    iterations++;

    for (let r = 0; r < rows; r++) {
      const known = grid[r];
      const valid = filterPlacements(rowData[r].placements, known);
      rowData[r].placements = valid;
      if (valid.length === 0 && !rowData[r].capped) { contradiction = true; break; }
      const deduced = deduceLine(valid, cols);
      for (let c = 0; c < cols; c++) {
        if (grid[r][c] === 0 && deduced[c] !== 0) { grid[r][c] = deduced[c]; changed = true; }
      }
    }
    if (contradiction) break;

    for (let c = 0; c < cols; c++) {
      const known: Cell[] = [];
      for (let r = 0; r < rows; r++) known.push(grid[r][c]);
      const valid = filterPlacements(colData[c].placements, known);
      colData[c].placements = valid;
      if (valid.length === 0 && !colData[c].capped) { contradiction = true; break; }
      const deduced = deduceLine(valid, rows);
      for (let r = 0; r < rows; r++) {
        if (grid[r][c] === 0 && deduced[r] !== 0) { grid[r][c] = deduced[r]; changed = true; }
      }
    }
    if (contradiction) break;
  }

  const totalCells = rows * cols;
  const solvedCells = countSolved(grid, rows, cols);
  const problematic: LineDiag[] = [];

  for (let r = 0; r < rows; r++) {
    const unknowns = grid[r].filter((c) => c === 0).length;
    if (unknowns > 0) {
      problematic.push({ index: r, type: "row", clue: rowClues[r],
        possiblePlacements: rowData[r].placements.length, unknownCells: unknowns, capped: rowData[r].capped });
    }
  }
  for (let c = 0; c < cols; c++) {
    let unknowns = 0;
    for (let r = 0; r < rows; r++) { if (grid[r][c] === 0) unknowns++; }
    if (unknowns > 0) {
      problematic.push({ index: c, type: "col", clue: colClues[c],
        possiblePlacements: colData[c].placements.length, unknownCells: unknowns, capped: colData[c].capped });
    }
  }
  problematic.sort((a, b) => b.possiblePlacements - a.possiblePlacements);

  return { solved: solvedCells === totalCells && !contradiction, grid, iterations, totalCells, solvedCells, problematic, contradiction };
}

export function computeClues(line: boolean[]): number[] {
  const clues: number[] = [];
  let run = 0;
  for (const cell of line) {
    if (cell) { run++; } else if (run > 0) { clues.push(run); run = 0; }
  }
  if (run > 0) clues.push(run);
  return clues;
}

export async function checkSolvability(
  solution: boolean[][],
  rowLabels?: string[],
  colLabels?: string[],
  onProgress?: ProgressCallback
): Promise<{ result: SolverResult; report: string }> {
  const rows = solution.length;
  const cols = solution[0]?.length || 0;

  const rowClues = solution.map((row) => computeClues(row));
  const colClues: number[][] = [];
  for (let c = 0; c < cols; c++) {
    colClues.push(computeClues(solution.map((row) => row[c])));
  }

  const result = await solveAsync(rows, cols, rowClues, colClues, onProgress);
  const pct = Math.round((result.solvedCells / result.totalCells) * 100);

  let report = "";

  if (result.contradiction) {
    report += "CONTRADICTION — the clues are internally inconsistent.\n\n";
  }

  if (result.solved) {
    report += `SOLVABLE — uniquely solvable by logic alone.\n`;
    report += `${result.totalCells} cells resolved in ${result.iterations} iterations.\n`;
  } else {
    report += `NOT SOLVABLE by line logic alone.\n`;
    report += `${result.solvedCells}/${result.totalCells} cells resolved (${pct}%), ${result.totalCells - result.solvedCells} ambiguous.\n`;
    report += `Ran ${result.iterations} iterations before getting stuck.\n\n`;

    const probRows = result.problematic.filter((p) => p.type === "row");
    const probCols = result.problematic.filter((p) => p.type === "col");

    if (probRows.length > 0) {
      report += `Problem rows (${probRows.length}):\n`;
      for (const p of probRows) {
        const label = rowLabels ? rowLabels[p.index] : `Row ${p.index + 1}`;
        const cappedNote = p.capped ? " (TOO MANY — capped)" : "";
        report += `  ${label}: clue [${p.clue.join(",")}] — ${p.possiblePlacements} placements${cappedNote}, ${p.unknownCells} unknown\n`;
      }
      report += "\n";
    }

    if (probCols.length > 0) {
      report += `Problem columns (${probCols.length}):\n`;
      for (const p of probCols) {
        const label = colLabels ? colLabels[p.index] : `Col ${p.index + 1}`;
        const cappedNote = p.capped ? " (TOO MANY — capped)" : "";
        report += `  ${label}: clue [${p.clue.join(",")}] — ${p.possiblePlacements} placements${cappedNote}, ${p.unknownCells} unknown\n`;
      }
      report += "\n";
    }

    report += "Tips:\n";

    const rowClueStrs = rowClues.map((c) => c.join(","));
    const colClueStrs = colClues.map((c) => c.join(","));
    const dupRows = rowClueStrs.filter((c, i) => rowClueStrs.indexOf(c) !== i);
    const dupCols = colClueStrs.filter((c, i) => colClueStrs.indexOf(c) !== i);

    if (dupRows.length > 0) {
      const unique = [...new Set(dupRows)];
      for (const dup of unique) {
        const indices = rowClueStrs.map((c, i) => c === dup ? i : -1).filter((i) => i >= 0);
        const labels = indices.map((i) => rowLabels ? rowLabels[i] : `Row ${i + 1}`);
        report += `  - Duplicate row clue [${dup}] in: ${labels.join(", ")}\n`;
      }
    }

    if (dupCols.length > 0) {
      const unique = [...new Set(dupCols)];
      for (const dup of unique) {
        const indices = colClueStrs.map((c, i) => c === dup ? i : -1).filter((i) => i >= 0);
        const labels = indices.map((i) => colLabels ? colLabels[i] : `Col ${i + 1}`);
        report += `  - Duplicate col clue [${dup}] in: ${labels.join(", ")}\n`;
      }
    }

    const cappedLines = result.problematic.filter((p) => p.capped);
    if (cappedLines.length > 0) {
      report += `  - ${cappedLines.length} lines have too many possibilities (${MAX_PLACEMENTS}+ placements) — these need more constraints\n`;
    }

    const fillRate = solution.flat().filter(Boolean).length / result.totalCells;
    if (fillRate < 0.4) {
      report += `  - Fill rate is ${Math.round(fillRate * 100)}% — aim for 40%+ for solvable puzzles\n`;
    }
  }

  return { result, report };
}

/**
 * Make a puzzle playable by iteratively adding "given" cells until solvable.
 *
 * difficulty: 0 (easy, many givens) to 1 (hard, minimum givens)
 *
 * Strategy: run solver, find unsolved cells, reveal one from the most
 * constrained (most ambiguous) line, repeat. Lower difficulty reveals
 * extra cells beyond the minimum needed.
 *
 * Returns the set of cells that must be pre-filled as givens.
 */
export async function makePlayable(
  solution: boolean[][],
  difficulty: number, // 0..1
  onProgress?: ProgressCallback
): Promise<{ givens: [number, number][]; iterations: number }> {
  const rows = solution.length;
  const cols = solution[0]?.length || 0;

  const rowClues = solution.map((row) => computeClues(row));
  const colClues: number[][] = [];
  for (let c = 0; c < cols; c++) {
    colClues.push(computeClues(solution.map((row) => row[c])));
  }

  const givens: [number, number][] = [];
  const givenSet = new Set<string>();
  let round = 0;
  const maxRounds = rows * cols; // safety cap

  while (round < maxRounds) {
    round++;
    onProgress?.(`Round ${round}: ${givens.length} givens so far, solving...`);
    await yieldUI();

    // Build a grid with current givens pre-filled
    const result = await solveWithGivens(rows, cols, rowClues, colClues, solution, givenSet);

    if (result.solved) {
      // Puzzle is solvable! On easy difficulty, add some bonus givens
      // to make it even more accessible
      if (difficulty < 0.5) {
        const bonusCount = Math.floor((1 - difficulty) * rows * 0.5);
        const filledCells: [number, number][] = [];
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            if (solution[r][c] && !givenSet.has(`${r},${c}`)) {
              filledCells.push([r, c]);
            }
          }
        }
        // Shuffle and take bonus
        for (let i = filledCells.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [filledCells[i], filledCells[j]] = [filledCells[j], filledCells[i]];
        }
        const bonus = filledCells.slice(0, Math.min(bonusCount, filledCells.length));
        for (const [r, c] of bonus) {
          givens.push([r, c]);
          givenSet.add(`${r},${c}`);
        }
      }
      break;
    }

    // Find the best cell to reveal as a given.
    // Strategy: pick an unsolved cell in the most ambiguous line.
    // This forces the solver to make progress on the hardest part.
    const unsolved: { r: number; c: number; score: number }[] = [];

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (result.grid[r][c] === 0 && !givenSet.has(`${r},${c}`)) {
          // Score: prefer cells that are at the intersection of two ambiguous lines
          const rowProb = result.problematic.find((p) => p.type === "row" && p.index === r);
          const colProb = result.problematic.find((p) => p.type === "col" && p.index === c);
          const rowScore = rowProb ? rowProb.possiblePlacements : 1;
          const colScore = colProb ? colProb.possiblePlacements : 1;
          unsolved.push({ r, c, score: rowScore + colScore });
        }
      }
    }

    if (unsolved.length === 0) break; // nothing left to reveal

    // Pick the cell with the highest ambiguity score
    unsolved.sort((a, b) => b.score - a.score);

    // On harder difficulty, reveal fewer cells per round (just the top one)
    // On easier difficulty, reveal a batch
    const batchSize = difficulty > 0.7 ? 1 : difficulty > 0.3 ? 3 : 5;
    const toReveal = unsolved.slice(0, Math.min(batchSize, unsolved.length));

    for (const { r, c } of toReveal) {
      givens.push([r, c]);
      givenSet.add(`${r},${c}`);
    }
  }

  onProgress?.(`Done: ${givens.length} givens needed`);
  return { givens, iterations: round };
}

async function solveWithGivens(
  rows: number, cols: number,
  rowClues: number[][], colClues: number[][],
  solution: boolean[][],
  givenSet: Set<string>
): Promise<SolverResult> {
  const grid: Cell[][] = Array.from({ length: rows }, () => Array(cols).fill(0));

  // Pre-fill givens
  for (const key of givenSet) {
    const [r, c] = key.split(",").map(Number);
    grid[r][c] = solution[r][c] ? 1 : -1;
  }

  const rowData = rowClues.map((clue) => generatePlacements(clue, cols));
  const colData = colClues.map((clue) => generatePlacements(clue, rows));

  let changed = true;
  let iterations = 0;
  const maxIterations = 100;
  let contradiction = false;

  while (changed && iterations < maxIterations) {
    changed = false;
    iterations++;

    for (let r = 0; r < rows; r++) {
      const known = grid[r];
      const valid = filterPlacements(rowData[r].placements, known);
      rowData[r].placements = valid;
      if (valid.length === 0 && !rowData[r].capped) { contradiction = true; break; }
      const deduced = deduceLine(valid, cols);
      for (let c = 0; c < cols; c++) {
        if (grid[r][c] === 0 && deduced[c] !== 0) { grid[r][c] = deduced[c]; changed = true; }
      }
    }
    if (contradiction) break;

    for (let c = 0; c < cols; c++) {
      const known: Cell[] = [];
      for (let r = 0; r < rows; r++) known.push(grid[r][c]);
      const valid = filterPlacements(colData[c].placements, known);
      colData[c].placements = valid;
      if (valid.length === 0 && !colData[c].capped) { contradiction = true; break; }
      const deduced = deduceLine(valid, rows);
      for (let r = 0; r < rows; r++) {
        if (grid[r][c] === 0 && deduced[r] !== 0) { grid[r][c] = deduced[r]; changed = true; }
      }
    }
    if (contradiction) break;
  }

  const totalCells = rows * cols;
  const solvedCells = countSolved(grid, rows, cols);

  const problematic: LineDiag[] = [];
  for (let r = 0; r < rows; r++) {
    const unknowns = grid[r].filter((c) => c === 0).length;
    if (unknowns > 0) {
      problematic.push({ index: r, type: "row", clue: rowClues[r],
        possiblePlacements: rowData[r].placements.length, unknownCells: unknowns, capped: rowData[r].capped });
    }
  }
  for (let c = 0; c < cols; c++) {
    let unknowns = 0;
    for (let r = 0; r < rows; r++) { if (grid[r][c] === 0) unknowns++; }
    if (unknowns > 0) {
      problematic.push({ index: c, type: "col", clue: colClues[c],
        possiblePlacements: colData[c].placements.length, unknownCells: unknowns, capped: colData[c].capped });
    }
  }
  problematic.sort((a, b) => b.possiblePlacements - a.possiblePlacements);

  return { solved: solvedCells === totalCells && !contradiction, grid, iterations, totalCells, solvedCells, problematic, contradiction };
}
