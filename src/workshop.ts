import * as Tone from "tone";
import { loadPiano, ensureAudio, playNote, scheduleNote, getTransport, isSamplerReady } from "./audio";

// --- All available notes (C2 to C6) ---
const ALL_NOTES: { note: string; isBlack: boolean }[] = [];
for (let octave = 2; octave <= 6; octave++) {
  const notes = [
    { n: "C", b: false }, { n: "C#", b: true }, { n: "D", b: false },
    { n: "D#", b: true }, { n: "E", b: false }, { n: "F", b: false },
    { n: "F#", b: true }, { n: "G", b: false }, { n: "G#", b: true },
    { n: "A", b: false }, { n: "A#", b: true }, { n: "B", b: false },
  ];
  for (const { n, b } of notes) {
    if (octave === 6 && n !== "C") break;
    ALL_NOTES.push({ note: `${n}${octave}`, isBlack: b });
  }
}

// --- State ---
let selectedPitches: string[] = ["E5", "D5", "C5", "A4", "G4", "E4", "C4", "A3"];
let steps = 16;
let bpm = 120;
let title = "My Beat";
let grid: boolean[][] = [];
let seqCells: HTMLDivElement[][] = [];
let isPlaying = false;
let looping = false;

// --- DOM ---
const app = document.getElementById("app")!;

// Header
const header = document.createElement("div");
header.className = "header";
header.innerHTML = `<h1>Workshop</h1><a href="index.html">← Back to game</a>`;
app.appendChild(header);

// Config
const config = document.createElement("div");
config.className = "config";
config.innerHTML = `
  <div class="config-group">
    <label>Title</label>
    <input type="text" id="cfg-title" value="My Beat" style="width:160px">
  </div>
  <div class="config-group">
    <label>Steps</label>
    <input type="number" id="cfg-steps" value="16" min="4" max="64" step="1">
  </div>
  <div class="config-group">
    <label>BPM</label>
    <input type="number" id="cfg-bpm" value="120" min="40" max="300" step="1">
  </div>
  <div class="config-group">
    <label>&nbsp;</label>
    <button id="cfg-apply">Apply</button>
  </div>
`;
app.appendChild(config);

// Pitch selector
const pitchSel = document.createElement("div");
pitchSel.className = "pitch-selector";
pitchSel.innerHTML = `<h3>Select pitches (click to toggle)</h3>`;

const pianoKeys = document.createElement("div");
pianoKeys.className = "piano-keys";
pitchSel.appendChild(pianoKeys);

function renderPianoKeys() {
  pianoKeys.innerHTML = "";
  // Render in reverse (high to low) so it reads naturally
  for (let i = ALL_NOTES.length - 1; i >= 0; i--) {
    const { note, isBlack } = ALL_NOTES[i];
    const key = document.createElement("div");
    key.className = `piano-key ${isBlack ? "black" : "white"}`;
    if (selectedPitches.includes(note)) key.classList.add("selected");
    key.textContent = note;
    key.addEventListener("click", async () => {
      await ensureAudio(bpm);
      if (selectedPitches.includes(note)) {
        selectedPitches = selectedPitches.filter((n) => n !== note);
        key.classList.remove("selected");
      } else {
        selectedPitches.push(note);
        selectedPitches.sort((a, b) => noteToMidi(b) - noteToMidi(a));
        key.classList.add("selected");
        if (isSamplerReady()) playNote(note);
      }
      rebuildGrid();
    });
    pianoKeys.appendChild(key);
  }
}

app.appendChild(pitchSel);

// Sequencer
const sequencerWrap = document.createElement("div");
sequencerWrap.className = "sequencer-wrap";
app.appendChild(sequencerWrap);

// Controls
const controls = document.createElement("div");
controls.className = "controls";
controls.innerHTML = `
  <button id="btn-play">▶ Play once</button>
  <button id="btn-loop" class="primary">⟳ Loop</button>
  <button id="btn-stop">■ Stop</button>
  <button id="btn-clear">Clear</button>
  <button id="btn-export" class="primary">Export as puzzle</button>
`;
app.appendChild(controls);

const status = document.createElement("p");
status.className = "status";
app.appendChild(status);

const exportOutput = document.createElement("pre");
exportOutput.className = "export-output";
app.appendChild(exportOutput);

// --- Loading ---
const loadingEl = document.createElement("p");
loadingEl.className = "status";
loadingEl.textContent = "Loading piano...";
loadingEl.style.animation = "pulse 1.5s ease infinite";
app.insertBefore(loadingEl, config);

loadPiano().then(() => {
  loadingEl.remove();
});

// --- Helpers ---
function noteToMidi(note: string): number {
  const match = note.match(/^([A-G]#?)(\d+)$/);
  if (!match) return 0;
  const names: Record<string, number> = {
    C: 0, "C#": 1, D: 2, "D#": 3, E: 4, F: 5, "F#": 6, G: 7, "G#": 8, A: 9, "A#": 10, B: 11,
  };
  return (parseInt(match[2]) + 1) * 12 + (names[match[1]] || 0);
}

function noteColor(note: string): string {
  const letter = note.replace(/[0-9#]/g, "");
  const colors: Record<string, string> = {
    C: "#ff3355", D: "#ff8833", E: "#ffdd33", F: "#33dd77",
    G: "#33ccff", A: "#5566ff", B: "#aa44ff",
  };
  return colors[letter] || "#888";
}

function noteColorClass(note: string): string {
  return "note-" + note.replace(/[0-9#]/g, "");
}

// --- Build/rebuild grid ---
function rebuildGrid() {
  // Preserve existing data where possible
  const oldGrid = grid;
  const oldPitches = [...selectedPitches];
  grid = selectedPitches.map((pitch, r) => {
    const oldRow = oldGrid[r];
    if (oldRow && oldRow.length === steps) return oldRow;
    return Array(steps).fill(false);
  });
  // If pitch count changed, reset
  if (grid.length !== oldPitches.length || selectedPitches.some((p, i) => oldPitches[i] !== p)) {
    grid = selectedPitches.map(() => Array(steps).fill(false));
  }
  renderSequencer();
}

function renderSequencer() {
  sequencerWrap.innerHTML = "";

  const seq = document.createElement("div");
  seq.className = "sequencer";

  // Beat numbers
  const beatNums = document.createElement("div");
  beatNums.className = "beat-numbers";
  for (let c = 0; c < steps; c++) {
    const num = document.createElement("div");
    num.className = "beat-num";
    num.textContent = c % 4 === 0 ? `${Math.floor(c / 4) + 1}` : "";
    beatNums.appendChild(num);
  }
  seq.appendChild(beatNums);

  seqCells = [];

  for (let r = 0; r < selectedPitches.length; r++) {
    seqCells[r] = [];
    const row = document.createElement("div");
    row.className = "seq-row";

    const label = document.createElement("div");
    label.className = "seq-label";
    label.textContent = selectedPitches[r];
    row.appendChild(label);

    for (let c = 0; c < steps; c++) {
      const cell = document.createElement("div");
      cell.className = "seq-cell";
      if (c % 2 === 0) cell.classList.add("even");
      if (c % 4 === 0) cell.classList.add("beat-start");

      if (grid[r][c]) {
        cell.classList.add("active", noteColorClass(selectedPitches[r]));
      }

      const row_i = r, col_i = c;
      cell.addEventListener("click", async () => {
        await ensureAudio(bpm);
        grid[row_i][col_i] = !grid[row_i][col_i];
        if (grid[row_i][col_i]) {
          cell.classList.add("active", noteColorClass(selectedPitches[row_i]));
          if (isSamplerReady()) playNote(selectedPitches[row_i]);
        } else {
          cell.classList.remove("active", noteColorClass(selectedPitches[row_i]));
        }
      });

      row.appendChild(cell);
      seqCells[r][c] = cell;
    }

    seq.appendChild(row);
  }

  sequencerWrap.appendChild(seq);
}

// --- Config apply ---
document.getElementById("cfg-apply")!.addEventListener("click", () => {
  const stepsInput = document.getElementById("cfg-steps") as HTMLInputElement;
  const bpmInput = document.getElementById("cfg-bpm") as HTMLInputElement;
  const titleInput = document.getElementById("cfg-title") as HTMLInputElement;
  steps = Math.max(4, Math.min(64, parseInt(stepsInput.value) || 16));
  bpm = Math.max(40, Math.min(300, parseInt(bpmInput.value) || 120));
  title = titleInput.value || "My Beat";
  stepsInput.value = String(steps);
  bpmInput.value = String(bpm);
  grid = selectedPitches.map(() => Array(steps).fill(false));
  renderSequencer();
});

// --- Playback ---
async function playOnce(): Promise<void> {
  if (isPlaying) return;
  await ensureAudio(bpm);
  if (!isSamplerReady()) return;

  isPlaying = true;
  const secPerStep = 60 / bpm;

  const transport = getTransport();
  transport.stop();
  transport.cancel();
  transport.position = 0;

  // Schedule notes
  for (let r = 0; r < selectedPitches.length; r++) {
    let c = 0;
    while (c < steps) {
      if (grid[r][c]) {
        let len = 1;
        while (c + len < steps && grid[r][c + len]) len++;
        scheduleNote(selectedPitches[r], c * secPerStep, len * secPerStep * 0.85);
        c += len;
      } else {
        c++;
      }
    }
  }

  transport.start();

  // Animate
  for (let col = 0; col < steps; col++) {
    // Highlight column
    for (let r = 0; r < selectedPitches.length; r++) {
      seqCells[r][col].classList.add("playhead");
    }

    await sleep(secPerStep * 1000);

    for (let r = 0; r < selectedPitches.length; r++) {
      seqCells[r][col].classList.remove("playhead");
    }
  }

  transport.stop();
  transport.cancel();
  isPlaying = false;
}

async function startLoop(): Promise<void> {
  looping = true;
  status.textContent = "Looping... click Stop to end";
  while (looping) {
    await playOnce();
    if (!looping) break;
  }
  status.textContent = "";
}

function stopPlayback() {
  looping = false;
  isPlaying = false;
  const transport = getTransport();
  transport.stop();
  transport.cancel();
  // Clear playheads
  for (let r = 0; r < seqCells.length; r++) {
    for (let c = 0; c < (seqCells[r]?.length || 0); c++) {
      seqCells[r][c].classList.remove("playhead");
    }
  }
  status.textContent = "";
}

document.getElementById("btn-play")!.addEventListener("click", () => {
  if (isPlaying) return;
  playOnce();
});

document.getElementById("btn-loop")!.addEventListener("click", () => {
  if (looping) {
    stopPlayback();
  } else {
    startLoop();
  }
});

document.getElementById("btn-stop")!.addEventListener("click", stopPlayback);

document.getElementById("btn-clear")!.addEventListener("click", () => {
  stopPlayback();
  grid = selectedPitches.map(() => Array(steps).fill(false));
  renderSequencer();
});

// --- Export ---
function computeClues(line: boolean[]): number[] {
  const clues: number[] = [];
  let run = 0;
  for (const cell of line) {
    if (cell) { run++; } else if (run > 0) { clues.push(run); run = 0; }
  }
  if (run > 0) clues.push(run);
  return clues;
}

document.getElementById("btn-export")!.addEventListener("click", () => {
  const filledCount = grid.flat().filter(Boolean).length;
  if (filledCount === 0) {
    status.textContent = "Place some notes first!";
    return;
  }

  // Trim unused pitch rows
  const usedRows: number[] = [];
  grid.forEach((row, i) => { if (row.some(Boolean)) usedRows.push(i); });

  const pitches = usedRows.map((i) => selectedPitches[i]);
  const solution = usedRows.map((i) => grid[i]);

  const rowClues = solution.map((row) => computeClues(row));
  const colClues: number[][] = [];
  for (let c = 0; c < steps; c++) {
    colClues.push(computeClues(solution.map((row) => row[c])));
  }

  const puzzle = {
    id: title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    title: `Can you hear it?`,
    revealTitle: title,
    pitches,
    bpm,
    solution,
  };

  // Format as TypeScript
  const tsCode = `export const ${puzzle.id.toUpperCase().replace(/-/g, "_")}: Puzzle = ${JSON.stringify(puzzle, null, 2)};`;

  // Also create a shareable URL with the puzzle encoded
  const compressed = {
    t: title,
    p: pitches,
    b: bpm,
    s: solution.map((row) => row.map((v) => v ? 1 : 0)),
  };
  const encoded = btoa(JSON.stringify(compressed));
  const shareUrl = `${location.origin}${location.pathname.replace("workshop.html", "")}#puzzle=${encoded}`;

  exportOutput.style.display = "block";
  exportOutput.textContent =
    `// --- Puzzle: ${title} ---\n` +
    `// ${pitches.length} pitches × ${steps} steps, ${filledCount} notes\n` +
    `// Row clues: ${rowClues.map((c) => `[${c.join(",")}]`).join(", ")}\n` +
    `// Col clues: ${colClues.map((c) => `[${c.join(",")}]`).join(", ")}\n\n` +
    tsCode +
    `\n\n// --- Shareable URL ---\n// ${shareUrl}`;

  status.textContent = `Exported! ${pitches.length} pitches × ${steps} steps, ${filledCount} notes filled.`;
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Init ---
renderPianoKeys();
rebuildGrid();
