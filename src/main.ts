import { loadPiano, ensureAudio, playNote, scheduleNote, getTransport } from "./audio";
import { PUZZLES, combined, isMusic, isExtra, type Puzzle } from "./puzzles";

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

// --- State ---
type CellState = "empty" | "filled" | "marked";
let currentPuzzle: Puzzle | null = null;
let grid: CellState[][] = [];
let combinedGrid: boolean[][] = [];
let rowClues: number[][] = [];
let colClues: number[][] = [];
let cells: HTMLDivElement[][] = [];
let isPlaying = false;
let isSolved = false;

// --- DOM ---
const app = document.getElementById("app")!;

const title = document.createElement("h1");
title.textContent = "Melodigram";
app.appendChild(title);

const loadingEl = document.createElement("p");
loadingEl.className = "loading";
loadingEl.textContent = "Loading piano...";
app.appendChild(loadingEl);

// Level select container
const levelSelect = document.createElement("div");
levelSelect.className = "level-select";
app.appendChild(levelSelect);

// Game container
const gameContainer = document.createElement("div");
gameContainer.className = "game-container";
gameContainer.style.display = "none";
app.appendChild(gameContainer);

// Game header (title + back button)
const gameHeader = document.createElement("div");
gameHeader.className = "game-header";
gameContainer.appendChild(gameHeader);

const backBtn = document.createElement("button");
backBtn.className = "back-btn";
backBtn.textContent = "← Levels";
backBtn.addEventListener("click", () => showLevelSelect());
gameHeader.appendChild(backBtn);

const subtitle = document.createElement("p");
subtitle.className = "subtitle";
gameHeader.appendChild(subtitle);

const puzzleTable = document.createElement("div");
puzzleTable.className = "puzzle-table";
gameContainer.appendChild(puzzleTable);

const controls = document.createElement("div");
controls.className = "controls";
gameContainer.appendChild(controls);

const playBtn = document.createElement("button");
playBtn.textContent = "Play melody";
controls.appendChild(playBtn);

const clearBtn = document.createElement("button");
clearBtn.textContent = "Clear";
controls.appendChild(clearBtn);

const hint = document.createElement("p");
hint.className = "hint";
hint.textContent = "Click: fill · Again: mark X · Again: clear";
gameContainer.appendChild(hint);

// --- Load piano samples ---
loadPiano().then(() => {
  loadingEl.style.display = "none";
});

// --- Level select ---
function renderLevelSelect() {
  levelSelect.innerHTML = "";
  const heading = document.createElement("h2");
  heading.textContent = "Select a Puzzle";
  levelSelect.appendChild(heading);

  const grid = document.createElement("div");
  grid.className = "level-grid";
  levelSelect.appendChild(grid);

  for (const puzzle of PUZZLES) {
    const card = document.createElement("button");
    card.className = "level-card";
    card.innerHTML = `
      <div class="level-title">${puzzle.title}</div>
      ${puzzle.composer ? `<div class="level-composer">${puzzle.composer}</div>` : ""}
      ${puzzle.difficulty ? `<div class="level-difficulty difficulty-${puzzle.difficulty}">${puzzle.difficulty}</div>` : ""}
    `;
    card.addEventListener("click", () => loadPuzzle(puzzle));
    grid.appendChild(card);
  }
}

function showLevelSelect() {
  if (isPlaying) return;
  currentPuzzle = null;
  gameContainer.style.display = "none";
  levelSelect.style.display = "block";
  location.hash = "";
}

function showGame() {
  levelSelect.style.display = "none";
  gameContainer.style.display = "";
}

// --- Load a puzzle ---
function loadPuzzle(puzzle: Puzzle) {
  if (isPlaying) return;
  currentPuzzle = puzzle;
  isSolved = false;

  const PITCHES = puzzle.pitches;
  const BEATS = puzzle.music[0].length;

  combinedGrid = combined(puzzle);

  rowClues = combinedGrid.map((row) => computeClues(row));
  colClues = [];
  for (let col = 0; col < BEATS; col++) {
    colClues.push(computeClues(combinedGrid.map((row) => row[col])));
  }

  grid = Array.from({ length: PITCHES.length }, () => Array(BEATS).fill("empty"));

  // Cell sizing
  const isLarge = BEATS > 10 || PITCHES.length > 8;
  const cellSize = isLarge ? 32 : 44;
  document.documentElement.style.setProperty("--cell-size", cellSize + "px");

  subtitle.textContent = "Fill in the grid using the clues";
  hint.textContent = "Click: fill · Again: mark X · Again: clear";
  location.hash = puzzle.id;

  showGame();
  renderGrid();
}

function renderGrid() {
  if (!currentPuzzle) return;
  const PITCHES = currentPuzzle.pitches;
  const BEATS = currentPuzzle.music[0].length;

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

      const r = row, c = col;
      cell.addEventListener("click", async () => {
        if (isPlaying || isSolved || !currentPuzzle) return;
        await ensureAudio(currentPuzzle.bpm);
        const note = PITCHES[r];
        const cellIsMusic = isMusic(currentPuzzle, r, c);

        if (grid[r][c] === "empty") {
          grid[r][c] = "filled";
          cell.classList.add("filled");
          cell.classList.remove("marked");
          cell.textContent = "";
          // Generic fill color while solving
          cell.style.backgroundColor = "#5566ff";
          cell.style.boxShadow = "0 0 10px #5566ff66";
          // Music cells play sound, extras are silent
          if (cellIsMusic) playNote(note);
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
          subtitle.textContent = `${currentPuzzle.title}${currentPuzzle.composer ? " — " + currentPuzzle.composer : ""}`;
          hint.textContent = "Solved!";
          revealCells();
          await playMelody();
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

// --- Check win: grid must match combined pattern ---
function checkSolved(): boolean {
  if (!currentPuzzle) return false;
  for (let r = 0; r < combinedGrid.length; r++) {
    for (let c = 0; c < combinedGrid[0].length; c++) {
      const filled = grid[r][c] === "filled";
      if (filled !== combinedGrid[r][c]) return false;
    }
  }
  return true;
}

// --- Reveal: music cells get colored, extras stay gray ---
function revealCells() {
  if (!currentPuzzle) return;
  const PITCHES = currentPuzzle.pitches;
  for (let r = 0; r < PITCHES.length; r++) {
    for (let c = 0; c < cells[r].length; c++) {
      if (!combinedGrid[r][c]) continue;
      const cell = cells[r][c];
      if (isMusic(currentPuzzle, r, c)) {
        const color = getNoteColor(PITCHES[r]);
        cell.style.backgroundColor = color;
        cell.style.boxShadow = `0 0 15px ${color}88`;
      } else {
        cell.style.backgroundColor = "#3a3a4a";
        cell.style.boxShadow = "inset 0 0 6px #00000066";
      }
    }
  }
}

// --- Playback: only music cells play ---
async function playMelody(): Promise<void> {
  if (isPlaying || !currentPuzzle) return;
  await ensureAudio(currentPuzzle.bpm);
  isPlaying = true;
  playBtn.disabled = true;
  clearBtn.disabled = true;

  const PITCHES = currentPuzzle.pitches;
  const BEATS = currentPuzzle.music[0].length;
  const secPerBeat = 60 / currentPuzzle.bpm;

  const transport = getTransport();
  transport.stop();
  transport.cancel();
  transport.position = 0;

  // Schedule only music cells
  for (let r = 0; r < PITCHES.length; r++) {
    let c = 0;
    while (c < BEATS) {
      if (currentPuzzle.music[r][c]) {
        let len = 1;
        while (c + len < BEATS && currentPuzzle.music[r][c + len]) len++;
        scheduleNote(PITCHES[r], c * secPerBeat, len * secPerBeat * 0.9);
        c += len;
      } else {
        c++;
      }
    }
  }

  transport.start();

  // Animate playhead
  for (let col = 0; col < BEATS; col++) {
    for (let row = 0; row < PITCHES.length; row++) {
      const cell = cells[row][col];
      cell.classList.add("active-col");
      if (isMusic(currentPuzzle, row, col)) {
        cell.classList.add("playing");
      }
    }
    await sleep(secPerBeat * 1000);
    for (let row = 0; row < PITCHES.length; row++) {
      const cell = cells[row][col];
      cell.classList.remove("active-col", "playing");
    }
  }

  transport.stop();
  transport.cancel();
  isPlaying = false;
  playBtn.disabled = false;
  clearBtn.disabled = false;
}

playBtn.addEventListener("click", () => playMelody());

clearBtn.addEventListener("click", () => {
  if (isPlaying || !currentPuzzle) return;
  isSolved = false;
  subtitle.textContent = "Fill in the grid using the clues";
  hint.textContent = "Click: fill · Again: mark X · Again: clear";
  const PITCHES = currentPuzzle.pitches;
  const BEATS = currentPuzzle.music[0].length;
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

// --- Init: load puzzle from hash, or show level select ---
renderLevelSelect();
const hashId = location.hash.replace("#", "");
if (hashId) {
  const puzzle = PUZZLES.find((p) => p.id === hashId);
  if (puzzle) loadPuzzle(puzzle);
  else showLevelSelect();
} else {
  showLevelSelect();
}
