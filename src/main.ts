import * as Tone from "tone";
import { solve } from "./solver";

// --- Ode to Joy (first phrase) with harmony ---
// Melody: E4 E4 F4 G4 G4 F4 E4 D4
// Plus bass (C3, G3) and harmony (C4) for nonogram solvability
const PITCHES = ["G4", "F4", "E4", "D4", "C4", "G3", "C3"];
const BEATS = 8;
const BPM = 92; // quarter note tempo, stately

const SOLUTION: boolean[][] = [
  [ true, false, false,  true,  true, false,  true,  true], // G4: [1, 2, 2]
  [false, false,  true, false, false,  true, false,  true], // F4: [1, 1, 1]
  [ true,  true, false, false, false, false,  true, false], // E4: [2, 1]
  [false, false, false, false, false,  true, false,  true], // D4: [1, 1]
  [false, false, false,  true,  true,  true, false, false], // C4: [3]
  [ true,  true, false,  true,  true, false,  true,  true], // G3: [2, 2, 2]
  [ true, false, false,  true, false,  true, false,  true], // C3: [1, 1, 1, 1]
];

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

const rowClues = SOLUTION.map((row) => computeClues(row));
const colClues: number[][] = [];
for (let col = 0; col < BEATS; col++) {
  colClues.push(computeClues(SOLUTION.map((row) => row[col])));
}

// Verify
const verification = solve(PITCHES.length, BEATS, rowClues, colClues);
console.log(verification.solved ? "Puzzle verified: uniquely solvable" : "WARNING: not solvable");

// --- Colors by note letter ---
const NOTE_COLORS: Record<string, string> = {
  C: "#ff3355", D: "#ff8833", E: "#ffdd33",
  F: "#33dd77", G: "#33ccff", A: "#5566ff", B: "#aa44ff",
};

function getNoteColor(note: string): string {
  return NOTE_COLORS[note.replace(/[0-9#b]/g, "")] || "#888";
}

// --- State ---
type CellState = "empty" | "filled" | "marked";
const grid: CellState[][] = Array.from({ length: PITCHES.length }, () =>
  Array(BEATS).fill("empty")
);
let isPlaying = false;
let audioStarted = false;
let isSolved = false;

// --- Synth ---
let synth: Tone.PolySynth | null = null;

function getSynth(): Tone.PolySynth {
  if (!synth) {
    synth = new Tone.PolySynth(Tone.Synth, {
      maxPolyphony: 16,
      voice: Tone.Synth,
      options: {
        oscillator: { type: "triangle" },
        envelope: { attack: 0.02, decay: 0.3, sustain: 0.4, release: 1.0 },
      },
    }).toDestination();
  }
  return synth;
}

async function ensureAudio(): Promise<void> {
  if (!audioStarted) {
    await Tone.start();
    Tone.getTransport().bpm.value = BPM;
    audioStarted = true;
  }
}

// --- Check win ---
function checkSolved(): boolean {
  for (let r = 0; r < PITCHES.length; r++) {
    for (let c = 0; c < BEATS; c++) {
      if ((grid[r][c] === "filled") !== SOLUTION[r][c]) return false;
    }
  }
  return true;
}

// --- Build UI ---
const app = document.getElementById("app")!;

const title = document.createElement("h1");
title.textContent = "Melodigram";
app.appendChild(title);

const subtitle = document.createElement("p");
subtitle.className = "subtitle";
subtitle.textContent = "Can you hear it?";
app.appendChild(subtitle);

const puzzleTable = document.createElement("div");
puzzleTable.className = "puzzle-table";
app.appendChild(puzzleTable);

const maxColClueLen = Math.max(...colClues.map((c) => c.length || 1));

// Column clues (top)
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
const cells: HTMLDivElement[][] = [];

for (let row = 0; row < PITCHES.length; row++) {
  cells[row] = [];
  const rowEl = document.createElement("div");
  rowEl.className = "puzzle-row";

  const rowClueEl = document.createElement("div");
  rowClueEl.className = "row-clue";
  const clue = rowClues[row];
  rowClueEl.textContent = clue.length === 0 ? "0" : clue.join("  ");
  rowEl.appendChild(rowClueEl);

  for (let col = 0; col < BEATS; col++) {
    const cell = document.createElement("div");
    cell.className = "cell";
    if (col % 2 === 0) cell.classList.add("even-beat");

    cell.addEventListener("click", async () => {
      if (isPlaying || isSolved) return;
      await ensureAudio();
      const note = PITCHES[row];

      if (grid[row][col] === "empty") {
        grid[row][col] = "filled";
        cell.classList.add("filled");
        cell.classList.remove("marked");
        cell.textContent = "";
        cell.style.backgroundColor = getNoteColor(note);
        cell.style.boxShadow = `0 0 15px ${getNoteColor(note)}66`;
        getSynth().triggerAttackRelease(note, "8n");
      } else if (grid[row][col] === "filled") {
        grid[row][col] = "marked";
        cell.classList.remove("filled");
        cell.classList.add("marked");
        cell.style.backgroundColor = "";
        cell.style.boxShadow = "";
        cell.textContent = "X";
      } else {
        grid[row][col] = "empty";
        cell.classList.remove("filled", "marked");
        cell.style.backgroundColor = "";
        cell.style.boxShadow = "";
        cell.textContent = "";
      }

      if (!isSolved && checkSolved()) {
        isSolved = true;
        subtitle.textContent = "Ode to Joy — Beethoven";
        hint.textContent = "Solved!";
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

// Controls
const controls = document.createElement("div");
controls.className = "controls";
app.appendChild(controls);

const playBtn = document.createElement("button");
playBtn.textContent = "Play";
controls.appendChild(playBtn);

const clearBtn = document.createElement("button");
clearBtn.textContent = "Clear";
controls.appendChild(clearBtn);

const hint = document.createElement("p");
hint.className = "hint";
hint.textContent = "Click: fill · Again: mark X · Again: clear";
app.appendChild(hint);

// --- Duration-aware playback ---
async function playMelody(): Promise<void> {
  if (isPlaying) return;
  await ensureAudio();
  isPlaying = true;
  playBtn.disabled = true;
  clearBtn.disabled = true;

  const secPerBeat = 60 / BPM;

  Tone.getTransport().stop();
  Tone.getTransport().cancel();
  Tone.getTransport().position = 0;

  // Schedule sustained notes
  for (let r = 0; r < PITCHES.length; r++) {
    let c = 0;
    while (c < BEATS) {
      if (grid[r][c] === "filled") {
        let len = 1;
        while (c + len < BEATS && grid[r][c + len] === "filled") len++;
        const note = PITCHES[r];
        const startTime = c * secPerBeat;
        const duration = len * secPerBeat * 0.9;
        Tone.getTransport().schedule((time) => {
          getSynth().triggerAttackRelease(note, duration, time);
        }, startTime);
        c += len;
      } else {
        c++;
      }
    }
  }

  Tone.getTransport().start();

  for (let col = 0; col < BEATS; col++) {
    for (let row = 0; row < PITCHES.length; row++) {
      const cell = cells[row][col];
      cell.classList.add("active-col");
      if (grid[row][col] === "filled") {
        cell.classList.add("playing");
        cell.style.boxShadow = `0 0 30px ${getNoteColor(PITCHES[row])}, 0 0 60px ${getNoteColor(PITCHES[row])}44`;
      }
    }

    await sleep(secPerBeat * 1000);

    for (let row = 0; row < PITCHES.length; row++) {
      const cell = cells[row][col];
      cell.classList.remove("active-col", "playing");
      if (grid[row][col] === "filled") {
        cell.style.boxShadow = `0 0 15px ${getNoteColor(PITCHES[row])}66`;
      }
    }
  }

  Tone.getTransport().stop();
  Tone.getTransport().cancel();
  isPlaying = false;
  playBtn.disabled = false;
  clearBtn.disabled = false;
}

playBtn.addEventListener("click", () => playMelody());

clearBtn.addEventListener("click", () => {
  if (isPlaying) return;
  isSolved = false;
  subtitle.textContent = "Can you hear it?";
  hint.textContent = "Click: fill · Again: mark X · Again: clear";
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
