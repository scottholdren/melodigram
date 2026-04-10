import { solve } from "./solver";
import { loadPiano, ensureAudio, playNote, scheduleNote, getTransport, isSamplerReady } from "./audio";
import { ALL_PUZZLES, type Puzzle } from "./puzzles";

// --- Clue computation ---
function computeClues(line: boolean[]): number[] {
  const clues: number[] = [];
  let run = 0;
  for (const cell of line) {
    if (cell) { run++; } else if (run > 0) { clues.push(run); run = 0; }
  }
  if (run > 0) clues.push(run);
  return clues;
}

// --- Color mapping ---
const NOTE_COLORS: Record<string, string> = {
  C: "#ff3355", D: "#ff8833", E: "#ffdd33",
  F: "#33dd77", G: "#33ccff", A: "#5566ff", B: "#aa44ff",
};

function getNoteColor(note: string): string {
  return NOTE_COLORS[note.replace(/[0-9#b]/g, "")] || "#888";
}

// --- Game state ---
type CellState = "empty" | "filled" | "marked";
let currentPuzzle: Puzzle;
let grid: CellState[][];
let rowClues: number[][];
let colClues: number[][];
let cells: HTMLDivElement[][];
let isPlaying = false;
let isSolved = false;

// DOM elements
const app = document.getElementById("app")!;

// --- Puzzle selector ---
const nav = document.createElement("div");
nav.className = "nav";
app.appendChild(nav);

ALL_PUZZLES.forEach((puzzle) => {
  const btn = document.createElement("button");
  btn.className = "nav-btn";
  btn.textContent = puzzle.id === "ode-to-joy" ? "Ode to Joy" : "The Entertainer";
  btn.addEventListener("click", () => loadPuzzle(puzzle));
  nav.appendChild(btn);
});

const workshopLink = document.createElement("a");
workshopLink.href = "workshop.html";
workshopLink.className = "nav-btn";
workshopLink.textContent = "Workshop";
workshopLink.style.textDecoration = "none";
nav.appendChild(workshopLink);

const drumsLink = document.createElement("a");
drumsLink.href = "drums.html";
drumsLink.className = "nav-btn";
drumsLink.textContent = "Drums";
drumsLink.style.textDecoration = "none";
nav.appendChild(drumsLink);

// --- Main containers ---
const title = document.createElement("h1");
title.textContent = "Melodigram";
app.appendChild(title);

const subtitle = document.createElement("p");
subtitle.className = "subtitle";
app.appendChild(subtitle);

const loadingEl = document.createElement("p");
loadingEl.className = "loading";
loadingEl.textContent = "Loading piano...";
app.appendChild(loadingEl);

const puzzleTable = document.createElement("div");
puzzleTable.className = "puzzle-table";
app.appendChild(puzzleTable);

const controls = document.createElement("div");
controls.className = "controls";
app.appendChild(controls);

const playBtn = document.createElement("button");
playBtn.textContent = "Play";
controls.appendChild(playBtn);

const hearBtn = document.createElement("button");
hearBtn.textContent = "Hear Solution";
controls.appendChild(hearBtn);

const clearBtn = document.createElement("button");
clearBtn.textContent = "Clear";
controls.appendChild(clearBtn);

const hint = document.createElement("p");
hint.className = "hint";
hint.textContent = "Click: fill · Again: mark X · Again: clear";
app.appendChild(hint);

// --- Load piano samples on start ---
loadPiano().then(() => {
  loadingEl.style.display = "none";
});

// --- Load a puzzle ---
function loadPuzzle(puzzle: Puzzle) {
  if (isPlaying) return;
  currentPuzzle = puzzle;
  isSolved = false;

  const PITCHES = puzzle.pitches;
  const BEATS = puzzle.solution[0].length;

  // Compute clues
  rowClues = puzzle.solution.map((row) => computeClues(row));
  colClues = [];
  for (let col = 0; col < BEATS; col++) {
    colClues.push(computeClues(puzzle.solution.map((row) => row[col])));
  }

  // Verify
  const v = solve(PITCHES.length, BEATS, rowClues, colClues);
  console.log(puzzle.id, v.solved ? "✓ uniquely solvable" : "⚠ not line-solvable (ok for large puzzles)");

  // Reset state
  grid = Array.from({ length: PITCHES.length }, () => Array(BEATS).fill("empty"));

  // Update subtitle
  subtitle.textContent = puzzle.title;
  hint.textContent = "Click: fill · Again: mark X · Again: clear";

  // Update nav active state
  nav.querySelectorAll(".nav-btn").forEach((btn, i) => {
    btn.classList.toggle("active", ALL_PUZZLES[i].id === puzzle.id);
  });

  // Size cells based on grid size
  const isLarge = BEATS > 10 || PITCHES.length > 8;
  const cellSize = isLarge ? 32 : 44;
  document.documentElement.style.setProperty("--cell-size", cellSize + "px");

  // Render
  renderGrid();
}

function renderGrid() {
  const PITCHES = currentPuzzle.pitches;
  const BEATS = currentPuzzle.solution[0].length;

  puzzleTable.innerHTML = "";
  cells = [];

  const maxColClueLen = Math.max(...colClues.map((c) => c.length || 1));

  // Column clues
  const colClueRow = document.createElement("div");
  colClueRow.className = "col-clue-row";
  const corner = document.createElement("div");
  corner.className = "corner";
  colClueRow.appendChild(corner);

  for (let col = 0; col < BEATS; col++) {
    const clueCell = document.createElement("div");
    clueCell.className = "col-clue";
    const clue = colClues[col];
    const padding = maxColClueLen - (clue.length || 1);
    let html = "";
    for (let i = 0; i < padding; i++) html += '<span class="clue-pad">&nbsp;</span>';
    if (clue.length === 0) {
      html += '<span class="clue-zero">0</span>';
    } else {
      html += clue.map((n) => `<span>${n}</span>`).join("");
    }
    clueCell.innerHTML = html;
    colClueRow.appendChild(clueCell);
  }

  const cornerRight = document.createElement("div");
  cornerRight.className = "corner-right";
  colClueRow.appendChild(cornerRight);
  puzzleTable.appendChild(colClueRow);

  // Grid rows
  for (let row = 0; row < PITCHES.length; row++) {
    cells[row] = [];
    const rowEl = document.createElement("div");
    rowEl.className = "puzzle-row";

    const rowClueEl = document.createElement("div");
    rowClueEl.className = "row-clue";
    const clue = rowClues[row];
    rowClueEl.textContent = clue.length === 0 ? "0" : clue.join(" ");
    rowEl.appendChild(rowClueEl);

    for (let col = 0; col < BEATS; col++) {
      const cell = document.createElement("div");
      cell.className = "cell";
      if (col % 2 === 0) cell.classList.add("even-beat");

      const r = row, c = col; // capture for closure
      cell.addEventListener("click", async () => {
        if (isPlaying || isSolved) return;
        await ensureAudio(currentPuzzle.bpm);
        const note = PITCHES[r];

        if (grid[r][c] === "empty") {
          grid[r][c] = "filled";
          cell.classList.add("filled");
          cell.classList.remove("marked");
          cell.textContent = "";
          cell.style.backgroundColor = getNoteColor(note);
          cell.style.boxShadow = `0 0 12px ${getNoteColor(note)}66`;
          if (isSamplerReady()) playNote(note);
        } else if (grid[r][c] === "filled") {
          grid[r][c] = "marked";
          cell.classList.remove("filled");
          cell.classList.add("marked");
          cell.style.backgroundColor = "";
          cell.style.boxShadow = "";
          cell.textContent = "X";
        } else {
          grid[r][c] = "empty";
          cell.classList.remove("filled", "marked");
          cell.style.backgroundColor = "";
          cell.style.boxShadow = "";
          cell.textContent = "";
        }

        if (!isSolved && checkSolved()) {
          isSolved = true;
          subtitle.textContent = currentPuzzle.revealTitle;
          hint.textContent = "Solved!";
          await playBack("solution");
        }
      });

      rowEl.appendChild(cell);
      cells[row][col] = cell;
    }

    const pitchLabel = document.createElement("div");
    pitchLabel.className = "pitch-label";
    pitchLabel.textContent = PITCHES[row];
    rowEl.appendChild(pitchLabel);

    puzzleTable.appendChild(rowEl);
  }
}

// --- Check win ---
function checkSolved(): boolean {
  const sol = currentPuzzle.solution;
  for (let r = 0; r < sol.length; r++) {
    for (let c = 0; c < sol[0].length; c++) {
      if ((grid[r][c] === "filled") !== sol[r][c]) return false;
    }
  }
  return true;
}

// --- Duration-aware playback ---
// source: "grid" plays user's fills, "solution" plays the answer
async function playBack(source: "grid" | "solution"): Promise<void> {
  if (isPlaying) return;
  await ensureAudio(currentPuzzle.bpm);

  isPlaying = true;
  playBtn.disabled = true;
  hearBtn.disabled = true;
  clearBtn.disabled = true;

  const PITCHES = currentPuzzle.pitches;
  const BEATS = currentPuzzle.solution[0].length;
  const secPerBeat = 60 / currentPuzzle.bpm;
  const sol = currentPuzzle.solution;

  const isFilled = (r: number, c: number): boolean =>
    source === "solution" ? sol[r][c] : grid[r][c] === "filled";

  const transport = getTransport();
  transport.stop();
  transport.cancel();
  transport.position = 0;

  // Schedule sustained notes
  for (let r = 0; r < PITCHES.length; r++) {
    let c = 0;
    while (c < BEATS) {
      if (isFilled(r, c)) {
        let len = 1;
        while (c + len < BEATS && isFilled(r, c + len)) len++;
        scheduleNote(PITCHES[r], c * secPerBeat, len * secPerBeat * 0.9);
        c += len;
      } else {
        c++;
      }
    }
  }

  transport.start();

  // Animate column by column
  for (let col = 0; col < BEATS; col++) {
    for (let row = 0; row < PITCHES.length; row++) {
      const cell = cells[row][col];
      cell.classList.add("active-col");
      if (isFilled(row, col)) {
        cell.classList.add("playing");
        cell.style.boxShadow = `0 0 25px ${getNoteColor(PITCHES[row])}, 0 0 50px ${getNoteColor(PITCHES[row])}44`;
      }
    }

    await sleep(secPerBeat * 1000);

    for (let row = 0; row < PITCHES.length; row++) {
      const cell = cells[row][col];
      cell.classList.remove("active-col", "playing");
      // Restore glow only for user-filled cells
      if (grid[row][col] === "filled") {
        cell.style.boxShadow = `0 0 12px ${getNoteColor(PITCHES[row])}66`;
      } else {
        cell.style.boxShadow = "";
      }
    }
  }

  transport.stop();
  transport.cancel();
  isPlaying = false;
  playBtn.disabled = false;
  hearBtn.disabled = false;
  clearBtn.disabled = false;
}

playBtn.addEventListener("click", () => playBack("grid"));
hearBtn.addEventListener("click", () => playBack("solution"));

clearBtn.addEventListener("click", () => {
  if (isPlaying) return;
  isSolved = false;
  subtitle.textContent = currentPuzzle.title;
  hint.textContent = "Click: fill · Again: mark X · Again: clear";
  const PITCHES = currentPuzzle.pitches;
  const BEATS = currentPuzzle.solution[0].length;
  for (let r = 0; r < PITCHES.length; r++) {
    for (let c = 0; c < BEATS; c++) {
      grid[r][c] = "empty";
      const cell = cells[r][c];
      cell.classList.remove("filled", "marked", "active-col", "playing");
      cell.style.backgroundColor = "";
      cell.style.boxShadow = "";
      cell.textContent = "";
    }
  }
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Init: load first puzzle from hash or default ---
const hashId = location.hash.replace("#", "");
const initial = ALL_PUZZLES.find((p) => p.id === hashId) || ALL_PUZZLES[0];
loadPuzzle(initial);
