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

/**
 * Count solutions via backtracking with column-prefix pruning.
 * Bails as soon as count reaches maxCount (we usually just need "is it 1?").
 * Returns Infinity if any row has capped placements (can't brute force reliably).
 */
export async function countSolutions(
  rowClues: number[][],
  colClues: number[][],
  rows: number,
  cols: number,
  maxCount: number = 2,
  onProgress?: ProgressCallback
): Promise<number> {
  // Generate placements for each row
  const rowPlacements: boolean[][][] = [];
  for (let r = 0; r < rows; r++) {
    const { placements, capped } = generatePlacements(rowClues[r], cols);
    if (capped) return Infinity; // can't trust brute force
    rowPlacements.push(placements);
  }

  // Quick size check — if total combinations are huge, bail
  let totalCombos = 1;
  for (const p of rowPlacements) {
    totalCombos *= p.length;
    if (totalCombos > 1e9) return Infinity;
  }

  const grid: boolean[][] = Array.from({ length: rows }, () => Array(cols).fill(false));
  let count = 0;
  let attempts = 0;

  // Column partial clue check: given filled cells in rows 0..r, verify
  // the column's runs so far are a valid prefix of the full clue
  function colPrefixValid(c: number, upToRow: number): boolean {
    const target = colClues[c];
    const partial: number[] = [];
    let run = 0;
    let gapAfterLastRun = false;
    for (let r = 0; r <= upToRow; r++) {
      if (grid[r][c]) {
        run++;
        gapAfterLastRun = false;
      } else if (run > 0) {
        partial.push(run);
        run = 0;
        gapAfterLastRun = true;
      }
    }
    // The partial must be consistent with target
    // Complete runs so far must match target prefix
    for (let i = 0; i < partial.length; i++) {
      if (i >= target.length) return false;
      if (partial[i] !== target[i]) return false;
    }
    // Current incomplete run must not exceed the next expected clue
    if (run > 0) {
      if (partial.length >= target.length) return false;
      if (run > target[partial.length]) return false;
    }
    // If we're past the last row, the total must match exactly
    if (upToRow === rows - 1) {
      if (run > 0) partial.push(run);
      if (partial.length !== target.length) return false;
      for (let i = 0; i < partial.length; i++) {
        if (partial[i] !== target[i]) return false;
      }
    }
    // Check remaining capacity: if we still have clues to place,
    // there must be enough rows left
    const rowsLeft = rows - 1 - upToRow;
    const cluesPlaced = partial.length + (run > 0 ? 0 : 0);
    const activeClueIdx = run > 0 ? partial.length : partial.length;
    const remainingClues = target.slice(activeClueIdx + (run > 0 ? 1 : 0));
    // If there's an active run, the remaining needed = target[activeClueIdx] - run
    let needed = 0;
    if (run > 0) {
      needed += target[activeClueIdx] - run;
    }
    for (let i = activeClueIdx + (run > 0 ? 1 : 0); i < target.length; i++) {
      needed += target[i];
      if (i > activeClueIdx + (run > 0 ? 1 : 0) || (run === 0 && i > activeClueIdx)) needed += 1; // gap
    }
    if (needed > rowsLeft + (run > 0 ? 1 : 0)) return false;
    return true;
  }

  async function tryRow(r: number): Promise<void> {
    if (count >= maxCount) return;
    attempts++;
    if (attempts % 1000 === 0) {
      onProgress?.(`Counting solutions: ${count} found, ${attempts} attempts`);
      await yieldUI();
    }

    if (r === rows) {
      count++;
      return;
    }

    for (const placement of rowPlacements[r]) {
      for (let c = 0; c < cols; c++) grid[r][c] = placement[c];

      // Prune: check each column's partial clue validity
      let valid = true;
      for (let c = 0; c < cols; c++) {
        if (!colPrefixValid(c, r)) { valid = false; break; }
      }
      if (valid) await tryRow(r + 1);
      if (count >= maxCount) return;
    }
  }

  await tryRow(0);
  return count;
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

  // Run brute-force uniqueness check to catch puzzles the line solver
  // accepts but that actually have multiple valid solutions.
  onProgress?.("Verifying uniqueness via brute force...");
  await yieldUI();
  const solCount = await countSolutions(rowClues, colClues, rows, cols, 2, onProgress);

  let report = "";

  // Determine overall status from brute-force count
  if (result.contradiction || solCount === 0) {
    report += "NO SOLUTIONS — the clues are contradictory.\n\n";
    return { result, report };
  }

  if (solCount === 1 && result.solved) {
    report += `SOLVABLE & UNIQUE — exactly one solution, reachable by line logic.\n`;
    report += `${result.totalCells} cells resolved in ${result.iterations} iterations.\n`;
    return { result, report };
  }

  if (solCount === 1 && !result.solved) {
    report += `UNIQUE but requires look-ahead.\n`;
    report += `Exactly one solution exists, but line logic alone only resolves ${result.solvedCells}/${result.totalCells} cells (${pct}%).\n`;
    report += `A human solver would need to try a few possibilities to find it.\n\n`;
  } else if (solCount >= 2) {
    report += `NOT UNIQUE — found at least ${solCount} valid solutions.\n`;
    report += `The clues don't uniquely determine a single grid. Multiple fills satisfy all clues.\n\n`;
  } else if (solCount === Infinity) {
    report += `WARNING: puzzle too large for brute-force uniqueness check.\n`;
    if (result.solved) {
      report += `Line logic fully resolves it in ${result.iterations} iterations, which strongly suggests uniqueness.\n`;
      return { result, report };
    }
    report += `Line logic resolves ${result.solvedCells}/${result.totalCells} cells (${pct}%). Remaining ambiguity may or may not have multiple solutions.\n\n`;
  }

  // Continue with problem diagnostics for non-solvable or non-unique cases
  const needsDiagnostics = !result.solved || solCount >= 2;
  if (needsDiagnostics) {
    if (!result.solved) {
      report += `Line logic stuck at ${result.solvedCells}/${result.totalCells} cells (${pct}%).\n`;
      report += `Ran ${result.iterations} iterations.\n\n`;
    }

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
 * Make a puzzle playable by ADDING extra filled cells to the pattern
 * until it's uniquely solvable. These extras become part of the nonogram
 * (they show up in the row/col clues) but they don't play music —
 * they're purely for puzzle solvability.
 *
 * Strategy: try adding random non-music cells, check if the resulting
 * pattern is uniquely line-solvable. Keep trying until one works.
 * Each attempt is cheap compared to guessing single cells.
 */
export async function makePlayable(
  musicGrid: boolean[][],
  difficulty: number, // 0..1 (currently unused; kept for API compat)
  onProgress?: ProgressCallback
): Promise<{ extras: [number, number][]; iterations: number }> {
  const rows = musicGrid.length;
  const cols = musicGrid[0]?.length || 0;

  // First check: maybe the music alone is already solvable
  onProgress?.("Checking if music alone is solvable...");
  await yieldUI();
  if (await isLineSolvable(musicGrid)) {
    onProgress?.("Already solvable, no extras needed");
    return { extras: [], iterations: 0 };
  }

  // List of all cells that could be extras (currently empty)
  const emptyCells: [number, number][] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!musicGrid[r][c]) emptyCells.push([r, c]);
    }
  }

  // Try adding random extras. Binary search on count:
  // - Start with a small number and increase
  // - For each count, try several random patterns
  let bestExtras: [number, number][] | null = null;
  let round = 0;
  const maxExtrasCount = Math.min(emptyCells.length, rows * cols); // upper bound

  // Phase 1: try small numbers of extras first, then grow
  for (let targetExtras = 1; targetExtras <= maxExtrasCount && !bestExtras; ) {
    const attemptsPerSize = Math.max(20, Math.floor(100 / Math.sqrt(targetExtras)));
    for (let attempt = 0; attempt < attemptsPerSize; attempt++) {
      round++;
      if (round % 10 === 0) {
        onProgress?.(`Trying ${targetExtras} extras (attempt ${attempt + 1}/${attemptsPerSize})...`);
        await yieldUI();
      }

      // Shuffle empty cells, pick the first `targetExtras` as candidates
      const shuffled = [...emptyCells];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      const candidate = shuffled.slice(0, targetExtras);

      // Build combined grid
      const combined = musicGrid.map((row) => [...row]);
      for (const [r, c] of candidate) combined[r][c] = true;

      if (await isLineSolvable(combined)) {
        bestExtras = candidate;
        break;
      }
    }

    // Grow target size exponentially, then linearly
    if (!bestExtras) {
      targetExtras = Math.max(targetExtras + 1, Math.ceil(targetExtras * 1.5));
    }
  }

  if (!bestExtras) {
    onProgress?.("Could not find a solvable extras pattern");
    return { extras: [], iterations: round };
  }

  // Phase 2: try to MINIMIZE — remove extras one at a time if still solvable
  onProgress?.(`Found solution with ${bestExtras.length} extras. Minimizing...`);
  await yieldUI();

  let current = [...bestExtras];
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < current.length; i++) {
      round++;
      if (round % 10 === 0) {
        onProgress?.(`Minimizing: ${current.length} extras remaining...`);
        await yieldUI();
      }
      const trial = current.filter((_, j) => j !== i);
      const combined = musicGrid.map((row) => [...row]);
      for (const [r, c] of trial) combined[r][c] = true;
      if (await isLineSolvable(combined)) {
        current = trial;
        changed = true;
        break;
      }
    }
  }

  onProgress?.(`Done: ${current.length} extras needed in ${round} iterations`);
  return { extras: current, iterations: round };
}

/** Check if a pattern is fully line-solvable (no guessing required). */
async function isLineSolvable(pattern: boolean[][]): Promise<boolean> {
  const rows = pattern.length;
  const cols = pattern[0]?.length || 0;
  const rowClues = pattern.map((row) => computeClues(row));
  const colClues: number[][] = [];
  for (let c = 0; c < cols; c++) {
    colClues.push(computeClues(pattern.map((row) => row[c])));
  }

  const grid: Cell[][] = Array.from({ length: rows }, () => Array(cols).fill(0));
  const rowData = rowClues.map((clue) => generatePlacements(clue, cols));
  const colData = colClues.map((clue) => generatePlacements(clue, rows));

  // If any line was capped, bail — we can't trust the check
  for (const d of rowData) if (d.capped) return false;
  for (const d of colData) if (d.capped) return false;

  let changed = true;
  let iter = 0;
  while (changed && iter < 100) {
    changed = false;
    iter++;

    for (let r = 0; r < rows; r++) {
      const known = grid[r];
      const valid = filterPlacements(rowData[r].placements, known);
      rowData[r].placements = valid;
      if (valid.length === 0) return false;
      const deduced = deduceLine(valid, cols);
      for (let c = 0; c < cols; c++) {
        if (grid[r][c] === 0 && deduced[c] !== 0) {
          grid[r][c] = deduced[c];
          changed = true;
        }
      }
    }

    for (let c = 0; c < cols; c++) {
      const known: Cell[] = [];
      for (let r = 0; r < rows; r++) known.push(grid[r][c]);
      const valid = filterPlacements(colData[c].placements, known);
      colData[c].placements = valid;
      if (valid.length === 0) return false;
      const deduced = deduceLine(valid, rows);
      for (let r = 0; r < rows; r++) {
        if (grid[r][c] === 0 && deduced[r] !== 0) {
          grid[r][c] = deduced[r];
          changed = true;
        }
      }
    }
  }

  // Fully resolved?
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] === 0) return false;
    }
  }
  return true;
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
