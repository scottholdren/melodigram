import * as Tone from "tone";
import { loadPiano, ensureAudio, isSamplerReady } from "./audio";
import { importFile, type ImportResult } from "./importers";
import { checkSolvability, makePlayable } from "./solver";

// --- Constants ---
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const MIN_OCTAVE = 2;
const MAX_OCTAVE = 6;

// Build full pitch list (high to low for piano roll)
const ALL_PITCHES: string[] = [];
for (let oct = MAX_OCTAVE; oct >= MIN_OCTAVE; oct--) {
  for (let i = NOTE_NAMES.length - 1; i >= 0; i--) {
    ALL_PITCHES.push(`${NOTE_NAMES[i]}${oct}`);
  }
}

function isBlackKey(note: string): boolean {
  return note.includes("#");
}

function noteToMidi(note: string): number {
  const match = note.match(/^([A-G]#?)(\d+)$/);
  if (!match) return 0;
  const idx = NOTE_NAMES.indexOf(match[1]);
  return (parseInt(match[2]) + 1) * 12 + idx;
}

function midiToNote(midi: number): string {
  const oct = Math.floor(midi / 12) - 1;
  const idx = midi % 12;
  return `${NOTE_NAMES[idx]}${oct}`;
}

const NOTE_COLORS: Record<string, string> = {
  C: "#ff3355", D: "#ff8833", E: "#ffdd33", F: "#33dd77",
  G: "#33ccff", A: "#5566ff", B: "#aa44ff",
};

function noteColorClass(note: string): string {
  return "note-" + note.replace(/[0-9#]/g, "");
}

// --- Instruments ---
interface Instrument {
  name: string;
  create: () => Tone.PolySynth | null;
}

const INSTRUMENTS: Instrument[] = [
  {
    name: "Piano",
    create: () => null, // uses the sampler from audio.ts
  },
  {
    name: "Warm Pad",
    create: () =>
      new Tone.PolySynth(Tone.Synth, {
        maxPolyphony: 16,
        voice: Tone.Synth,
        options: {
          oscillator: { type: "sine" },
          envelope: { attack: 0.1, decay: 0.4, sustain: 0.6, release: 1.5 },
        },
      }).toDestination(),
  },
  {
    name: "Bright Synth",
    create: () =>
      new Tone.PolySynth(Tone.Synth, {
        maxPolyphony: 16,
        voice: Tone.Synth,
        options: {
          oscillator: { type: "sawtooth" },
          envelope: { attack: 0.01, decay: 0.2, sustain: 0.3, release: 0.4 },
        },
      }).toDestination(),
  },
  {
    name: "Electric Piano",
    create: () =>
      new Tone.PolySynth(Tone.FMSynth, {
        maxPolyphony: 16,
        voice: Tone.FMSynth,
        options: {
          modulationIndex: 3,
          envelope: { attack: 0.01, decay: 0.5, sustain: 0.2, release: 0.8 },
        },
      }).toDestination(),
  },
  {
    name: "Pluck",
    create: () =>
      new Tone.PolySynth(Tone.Synth, {
        maxPolyphony: 16,
        voice: Tone.Synth,
        options: {
          oscillator: { type: "triangle" },
          envelope: { attack: 0.001, decay: 0.3, sustain: 0.0, release: 0.3 },
        },
      }).toDestination(),
  },
  {
    name: "Organ",
    create: () =>
      new Tone.PolySynth(Tone.Synth, {
        maxPolyphony: 16,
        voice: Tone.Synth,
        options: {
          oscillator: { type: "square" },
          envelope: { attack: 0.05, decay: 0.1, sustain: 0.8, release: 0.3 },
        },
      }).toDestination(),
  },
];

// --- State ---
let displayPitches: string[] = [...ALL_PITCHES];
let steps = 32;
let bpm = 120;
let quantize: "4n" | "8n" | "16n" = "8n";
let title = "My Beat";
let grid: boolean[][] = displayPitches.map(() => Array(steps).fill(false));
let seqCells: HTMLDivElement[][] = [];
let isPlaying = false;
let looping = false;
let currentInstrument = 0;
let synthInstance: Tone.PolySynth | null = null;
let usePiano = true;

// Sampler reference from audio.ts
let pianoSampler: Tone.Sampler | null = null;

// --- DOM ---
const app = document.getElementById("app")!;

// Header
const header = document.createElement("div");
header.className = "header";
header.innerHTML = `<h1>Workshop</h1><div style="display:flex;gap:1rem"><a href="drums.html" style="color:#5566ff;text-decoration:none;font-size:0.75rem">Drums</a><a href="index.html" style="color:#5566ff;text-decoration:none;font-size:0.75rem">Game</a></div>`;
app.appendChild(header);

// Top config bar
const config = document.createElement("div");
config.className = "config";
config.innerHTML = `
  <div class="config-group">
    <label>Title</label>
    <input type="text" id="cfg-title" value="My Beat" style="width:160px">
  </div>
  <div class="config-group">
    <label>Steps</label>
    <input type="number" id="cfg-steps" value="32" min="4" max="128" step="1">
  </div>
  <div class="config-group">
    <label>BPM</label>
    <input type="number" id="cfg-bpm" value="120" min="40" max="300" step="1">
  </div>
  <div class="config-group">
    <label>Quantize</label>
    <select id="cfg-quantize">
      <option value="4n">1/4 note</option>
      <option value="8n" selected>1/8 note</option>
      <option value="16n">1/16 note</option>
    </select>
  </div>
  <div class="config-group">
    <label>Instrument</label>
    <select id="cfg-instrument">
      ${INSTRUMENTS.map((inst, i) => `<option value="${i}">${inst.name}</option>`).join("")}
    </select>
  </div>
  <div class="config-group">
    <label>&nbsp;</label>
    <button id="cfg-apply">Apply</button>
  </div>
`;
app.appendChild(config);

// MIDI import
const midiDrop = document.createElement("div");
midiDrop.className = "midi-drop";
midiDrop.innerHTML = `<span>Drop sheet music here — MIDI, MusicXML, ABC notation, or <label class="midi-browse">browse<input type="file" id="midi-file" accept=".mid,.midi,.xml,.musicxml,.mxl,.abc" hidden></label></span>`;
app.appendChild(midiDrop);

// Piano roll container
const rollContainer = document.createElement("div");
rollContainer.className = "roll-container";
app.appendChild(rollContainer);

// Test play container (hidden by default)
const playContainer = document.createElement("div");
playContainer.className = "play-container";
playContainer.style.display = "none";
app.appendChild(playContainer);

// Controls
const controls = document.createElement("div");
controls.className = "controls";
controls.innerHTML = `
  <button id="btn-play">&#9654; Play</button>
  <button id="btn-loop" class="primary">&#8635; Loop</button>
  <button id="btn-stop">&#9632; Stop</button>
  <button id="btn-clear">Clear</button>
  <button id="btn-trim">Trim empty rows</button>
  <button id="btn-del-first">Delete first bar</button>
  <button id="btn-del-last">Delete last bar</button>
  <button id="btn-check">Check solvability</button>
  <button id="btn-make-solvable" class="primary">Make solvable</button>
  <button id="btn-test-play" class="primary">Test play</button>
  <button id="btn-export" class="primary">Export puzzle</button>
</span>
<div class="config-inline" id="difficulty-wrap" style="display:none">
  <label style="font-size:0.6rem;color:#555;text-transform:uppercase">Difficulty</label>
  <input type="range" id="cfg-difficulty" min="0" max="100" value="50" style="width:120px;accent-color:#5566ff">
  <span id="diff-label" style="font-size:0.7rem;color:#666">Medium</span>
</div>
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

// --- Instrument switching ---
function setInstrument(index: number) {
  currentInstrument = index;
  if (synthInstance) {
    synthInstance.dispose();
    synthInstance = null;
  }
  if (index === 0) {
    usePiano = true;
  } else {
    usePiano = false;
    synthInstance = INSTRUMENTS[index].create();
  }
}

function triggerNote(note: string, duration: string = "16n") {
  if (usePiano) {
    // Access the sampler via audio module — play a quick note
    import("./audio").then((mod) => mod.playNote(note));
  } else if (synthInstance) {
    synthInstance.triggerAttackRelease(note, duration);
  }
}

function scheduleNotePlay(note: string, time: number, duration: number) {
  if (usePiano) {
    Tone.getTransport().schedule((t) => {
      import("./audio").then((mod) => {
        // Direct sampler access for scheduled playback
        const s = (globalThis as any).__melodigramSampler;
        if (s) s.triggerAttackRelease(note, duration, t);
      });
    }, time);
  } else if (synthInstance) {
    const synth = synthInstance;
    Tone.getTransport().schedule((t) => {
      synth.triggerAttackRelease(note, duration, t);
    }, time);
  }
}

// --- Render piano roll ---
function renderRoll() {
  rollContainer.innerHTML = "";

  const roll = document.createElement("div");
  roll.className = "piano-roll";

  // Beat numbers header
  const beatHeader = document.createElement("div");
  beatHeader.className = "roll-header";
  const keySpacer = document.createElement("div");
  keySpacer.className = "key-spacer";
  beatHeader.appendChild(keySpacer);
  const beatNums = document.createElement("div");
  beatNums.className = "beat-nums";
  for (let c = 0; c < steps; c++) {
    const num = document.createElement("div");
    num.className = "beat-num";
    if (c % 4 === 0) num.textContent = `${Math.floor(c / 4) + 1}`;
    beatNums.appendChild(num);
  }
  beatHeader.appendChild(beatNums);
  roll.appendChild(beatHeader);

  // Scrollable body
  const body = document.createElement("div");
  body.className = "roll-body";

  // Piano keys column
  const keys = document.createElement("div");
  keys.className = "piano-keys-col";

  // Grid
  const gridEl = document.createElement("div");
  gridEl.className = "roll-grid";

  seqCells = [];

  for (let r = 0; r < displayPitches.length; r++) {
    const pitch = displayPitches[r];
    const black = isBlackKey(pitch);
    const isC = pitch.startsWith("C") && !pitch.startsWith("C#");

    // Piano key
    const key = document.createElement("div");
    key.className = `piano-key ${black ? "black" : "white"} ${isC ? "c-key" : ""}`;
    key.textContent = isC ? pitch : (black ? "" : pitch.replace(/\d/, ""));
    key.addEventListener("click", async () => {
      await ensureAudio(bpm);
      triggerNote(pitch);
    });
    keys.appendChild(key);

    // Grid row
    seqCells[r] = [];
    const rowEl = document.createElement("div");
    rowEl.className = `roll-row ${black ? "black-row" : "white-row"} ${isC ? "c-row" : ""}`;

    for (let c = 0; c < steps; c++) {
      const cell = document.createElement("div");
      cell.className = "roll-cell";
      if (c % 4 === 0) cell.classList.add("bar-line");
      if (c % 2 === 0) cell.classList.add("even-step");

      if (grid[r] && grid[r][c]) {
        cell.classList.add("active", noteColorClass(pitch));
      }

      const ri = r, ci = c;
      cell.addEventListener("click", async () => {
        await ensureAudio(bpm);
        if (!grid[ri]) grid[ri] = Array(steps).fill(false);
        grid[ri][ci] = !grid[ri][ci];
        if (grid[ri][ci]) {
          cell.classList.add("active", noteColorClass(displayPitches[ri]));
          triggerNote(displayPitches[ri]);
        } else {
          cell.className = "roll-cell";
          if (ci % 4 === 0) cell.classList.add("bar-line");
          if (ci % 2 === 0) cell.classList.add("even-step");
        }
      });

      rowEl.appendChild(cell);
      seqCells[r][ci] = cell;
    }

    gridEl.appendChild(rowEl);
  }

  body.appendChild(keys);
  body.appendChild(gridEl);
  roll.appendChild(body);
  rollContainer.appendChild(roll);

  // Scroll to middle C area
  const middleCIndex = displayPitches.indexOf("C4");
  if (middleCIndex > 0) {
    const scrollTarget = middleCIndex * 16 - body.clientHeight / 2;
    requestAnimationFrame(() => {
      body.scrollTop = scrollTarget;
    });
  }
}

// --- Config ---
document.getElementById("cfg-apply")!.addEventListener("click", applyConfig);

function applyConfig() {
  const stepsVal = parseInt((document.getElementById("cfg-steps") as HTMLInputElement).value) || 32;
  const bpmVal = parseInt((document.getElementById("cfg-bpm") as HTMLInputElement).value) || 120;
  const quantVal = (document.getElementById("cfg-quantize") as HTMLSelectElement).value as "4n" | "8n" | "16n";
  const instVal = parseInt((document.getElementById("cfg-instrument") as HTMLSelectElement).value) || 0;
  title = (document.getElementById("cfg-title") as HTMLInputElement).value || "My Beat";

  const oldSteps = steps;
  steps = Math.max(4, Math.min(128, stepsVal));
  bpm = Math.max(40, Math.min(300, bpmVal));
  quantize = quantVal;
  setInstrument(instVal);

  // Resize grid columns if steps changed
  if (steps !== oldSteps) {
    grid = grid.map((row) => {
      const newRow = Array(steps).fill(false);
      for (let c = 0; c < Math.min(row.length, steps); c++) newRow[c] = row[c];
      return newRow;
    });
  }

  renderRoll();
}

// --- Universal sheet music import ---
async function handleFile(file: File) {
  status.textContent = `Importing ${file.name}...`;
  try {
    const result = await importFile(file);
    applyImport(result);
  } catch (err: any) {
    status.textContent = `Import error: ${err.message || err}`;
  }
}

function applyImport(result: ImportResult) {
  if (result.notes.length === 0) {
    status.textContent = "No notes found in file";
    return;
  }

  // Update BPM if the file provided one
  if (result.bpm) {
    bpm = result.bpm;
    (document.getElementById("cfg-bpm") as HTMLInputElement).value = String(bpm);
  }

  const secPerStep = 60 / bpm / (quantize === "4n" ? 1 : quantize === "8n" ? 2 : 4);

  // Auto-set steps from content
  const maxTime = Math.max(...result.notes.map((n) => n.time + n.duration));
  const neededSteps = Math.ceil(maxTime / secPerStep) + 1;
  steps = Math.max(16, Math.min(128, neededSteps));
  (document.getElementById("cfg-steps") as HTMLInputElement).value = String(steps);

  // Reset grid to full keyboard
  displayPitches = [...ALL_PITCHES];
  grid = displayPitches.map(() => Array(steps).fill(false));

  // Place notes
  let placed = 0;
  for (const note of result.notes) {
    const pitchName = midiToNote(note.midi);
    const rowIndex = ALL_PITCHES.indexOf(pitchName);
    if (rowIndex < 0) continue;

    const startStep = Math.round(note.time / secPerStep);
    const durationSteps = Math.max(1, Math.round(note.duration / secPerStep));

    for (let s = startStep; s < startStep + durationSteps && s < steps; s++) {
      grid[rowIndex][s] = true;
      placed++;
    }
  }

  title = result.title;
  (document.getElementById("cfg-title") as HTMLInputElement).value = title;

  renderRoll();

  // Scroll to the first note
  const firstRow = displayPitches.findIndex((_, r) => grid[r]?.some(Boolean));
  if (firstRow >= 0) {
    const body = rollContainer.querySelector(".roll-body") as HTMLElement;
    if (body) {
      requestAnimationFrame(() => {
        body.scrollTop = firstRow * 14 - body.clientHeight / 2;
      });
    }
  }

  status.textContent = `Imported ${result.notes.length} notes (${placed} cells) from ${result.format} — "${result.title}"`;
}

// Drag and drop
midiDrop.addEventListener("dragover", (e) => {
  e.preventDefault();
  midiDrop.classList.add("dragover");
});
midiDrop.addEventListener("dragleave", () => midiDrop.classList.remove("dragover"));
midiDrop.addEventListener("drop", (e) => {
  e.preventDefault();
  midiDrop.classList.remove("dragover");
  const file = e.dataTransfer?.files[0];
  if (file) handleFile(file);
});
document.getElementById("midi-file")!.addEventListener("change", (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) handleFile(file);
  input.value = ""; // reset so same file can be re-imported
});

// --- Playback ---
async function playOnce(): Promise<void> {
  if (isPlaying) return;
  await ensureAudio(bpm);
  if (usePiano && !isSamplerReady()) return;

  isPlaying = true;
  const secPerStep = 60 / bpm / (quantize === "4n" ? 1 : quantize === "8n" ? 2 : 4);

  const transport = Tone.getTransport();
  transport.stop();
  transport.cancel();
  transport.position = 0;

  // Schedule notes with duration awareness
  for (let r = 0; r < displayPitches.length; r++) {
    if (!grid[r]) continue;
    let c = 0;
    while (c < steps) {
      if (grid[r][c]) {
        let len = 1;
        while (c + len < steps && grid[r][c + len]) len++;
        const note = displayPitches[r];
        const startTime = c * secPerStep;
        const dur = len * secPerStep * 0.85;

        if (usePiano) {
          import("./audio").then((mod) => {
            mod.scheduleNote(note, startTime, dur);
          });
        } else if (synthInstance) {
          const synth = synthInstance;
          const st = startTime, d = dur, n = note;
          transport.schedule((t) => synth.triggerAttackRelease(n, d, t), st);
        }

        c += len;
      } else {
        c++;
      }
    }
  }

  // Small delay to let async schedules land
  await new Promise((r) => setTimeout(r, 50));
  transport.start();

  // Animate playhead
  for (let col = 0; col < steps; col++) {
    for (let r = 0; r < seqCells.length; r++) {
      if (seqCells[r]?.[col]) seqCells[r][col].classList.add("playhead");
    }

    await sleep(secPerStep * 1000);

    for (let r = 0; r < seqCells.length; r++) {
      if (seqCells[r]?.[col]) seqCells[r][col].classList.remove("playhead");
    }

    if (!isPlaying) break;
  }

  transport.stop();
  transport.cancel();
  isPlaying = false;
}

async function startLoop(): Promise<void> {
  looping = true;
  status.textContent = "Looping...";
  while (looping) {
    await playOnce();
    if (!looping) break;
  }
  status.textContent = "";
}

function stopPlayback() {
  looping = false;
  isPlaying = false;
  Tone.getTransport().stop();
  Tone.getTransport().cancel();
  for (let r = 0; r < seqCells.length; r++) {
    for (let c = 0; c < (seqCells[r]?.length || 0); c++) {
      seqCells[r]?.[c]?.classList.remove("playhead");
    }
  }
  status.textContent = "";
}

document.getElementById("btn-play")!.addEventListener("click", () => { if (!isPlaying) playOnce(); });
document.getElementById("btn-loop")!.addEventListener("click", () => { looping ? stopPlayback() : startLoop(); });
document.getElementById("btn-stop")!.addEventListener("click", stopPlayback);
document.getElementById("btn-clear")!.addEventListener("click", () => {
  stopPlayback();
  // Reset everything to defaults
  steps = 32;
  bpm = 120;
  title = "My Beat";
  displayPitches = [...ALL_PITCHES];
  grid = displayPitches.map(() => Array(steps).fill(false));
  // Reset UI controls
  (document.getElementById("cfg-steps") as HTMLInputElement).value = "32";
  (document.getElementById("cfg-bpm") as HTMLInputElement).value = "120";
  (document.getElementById("cfg-title") as HTMLInputElement).value = "My Beat";
  // Reset quantize
  quantize = "8n";
  (document.getElementById("cfg-quantize") as HTMLSelectElement).value = "8n";
  // Reset file input so same file can be re-imported
  const fileInput = document.getElementById("midi-file") as HTMLInputElement;
  if (fileInput) fileInput.value = "";
  // Hide difficulty slider
  document.getElementById("difficulty-wrap")!.style.display = "none";
  // Clear status and export
  status.textContent = "";
  exportOutput.style.display = "none";
  exportOutput.textContent = "";
  renderRoll();
});

document.getElementById("btn-trim")!.addEventListener("click", () => {
  if (isPlaying) return;
  const usedIndices: number[] = [];
  for (let r = 0; r < displayPitches.length; r++) {
    if (grid[r]?.some(Boolean)) usedIndices.push(r);
  }
  if (usedIndices.length === 0) {
    status.textContent = "All rows are empty — nothing to trim";
    return;
  }
  if (usedIndices.length === displayPitches.length) {
    status.textContent = "No empty rows to remove";
    return;
  }
  const removed = displayPitches.length - usedIndices.length;
  displayPitches = usedIndices.map((i) => displayPitches[i]);
  grid = usedIndices.map((i) => grid[i]);
  renderRoll();
  status.textContent = `Removed ${removed} empty row${removed > 1 ? "s" : ""} — ${displayPitches.length} rows remaining. Clear to restore full keyboard.`;
});

document.getElementById("btn-del-first")!.addEventListener("click", () => {
  if (isPlaying) return;
  if (steps <= 4) {
    status.textContent = "Already at minimum (4 steps / 1 bar)";
    return;
  }
  steps -= 4;
  grid = grid.map((row) => row.slice(4));
  (document.getElementById("cfg-steps") as HTMLInputElement).value = String(steps);
  renderRoll();
  status.textContent = `Removed first bar — now ${steps} steps (${steps / 4} bar${steps / 4 !== 1 ? "s" : ""})`;
});

document.getElementById("btn-del-last")!.addEventListener("click", () => {
  if (isPlaying) return;
  if (steps <= 4) {
    status.textContent = "Already at minimum (4 steps / 1 bar)";
    return;
  }
  steps -= 4;
  grid = grid.map((row) => row.slice(0, steps));
  (document.getElementById("cfg-steps") as HTMLInputElement).value = String(steps);
  renderRoll();
  status.textContent = `Removed last bar — now ${steps} steps (${steps / 4} bar${steps / 4 !== 1 ? "s" : ""})`;
});

// --- Check solvability ---
document.getElementById("btn-check")!.addEventListener("click", async () => {
  const usedRows: number[] = [];
  for (let r = 0; r < displayPitches.length; r++) {
    if (grid[r]?.some(Boolean)) usedRows.push(r);
  }
  if (usedRows.length === 0) {
    status.textContent = "Place some notes first!";
    return;
  }

  const solution = usedRows.map((i) => grid[i].slice(0, steps));
  const rowLabels = usedRows.map((i) => displayPitches[i]);
  const colLabels = Array.from({ length: steps }, (_, i) => `Step ${i + 1}`);

  exportOutput.style.display = "block";
  exportOutput.textContent = "Checking...";
  status.textContent = "Checking solvability...";

  const { report } = await checkSolvability(solution, rowLabels, colLabels, (msg) => {
    exportOutput.textContent = msg;
  });

  exportOutput.textContent = report;
  status.textContent = report.startsWith("SOLVABLE") ? "Puzzle is solvable!" : "Not solvable yet — see details below";

  // Show difficulty slider if not solvable
  document.getElementById("difficulty-wrap")!.style.display = report.startsWith("SOLVABLE") ? "none" : "flex";
});

// Difficulty slider label
document.getElementById("cfg-difficulty")!.addEventListener("input", (e) => {
  const val = parseInt((e.target as HTMLInputElement).value);
  const labels = ["Easy", "Easy", "Medium", "Hard", "Expert"];
  document.getElementById("diff-label")!.textContent = labels[Math.floor(val / 25)] || "Medium";
});

// --- Make solvable ---
// Extras are non-music filled cells added to the puzzle pattern for solvability.
// They show up in the clues but don't play sound. Stored as a set of "r,c" keys
// in the space of used-rows (i.e. the compacted solution grid).
let extrasSet: Set<string> = new Set();
let extrasUsedRows: number[] = [];

function clearExtras() {
  extrasSet = new Set();
  extrasUsedRows = [];
  // Remove visual markers from workshop cells
  for (let r = 0; r < seqCells.length; r++) {
    for (let c = 0; c < (seqCells[r]?.length || 0); c++) {
      const cell = seqCells[r]?.[c];
      if (!cell) continue;
      cell.classList.remove("extra-cell");
    }
  }
}

document.getElementById("btn-make-solvable")!.addEventListener("click", async () => {
  const usedRows: number[] = [];
  for (let r = 0; r < displayPitches.length; r++) {
    if (grid[r]?.some(Boolean)) usedRows.push(r);
  }
  if (usedRows.length === 0) {
    status.textContent = "Place some notes first!";
    return;
  }

  const musicGrid = usedRows.map((i) => grid[i].slice(0, steps));

  exportOutput.style.display = "block";
  exportOutput.textContent = "Finding extras to make it solvable...";
  status.textContent = "Adding extras to make puzzle solvable...";

  // Reset any previous extras
  clearExtras();

  const { extras, iterations } = await makePlayable(musicGrid, 0.5, (msg) => {
    exportOutput.textContent = msg;
  });

  extrasUsedRows = usedRows;
  extrasSet = new Set(extras.map(([r, c]) => `${r},${c}`));

  const musicCount = musicGrid.flat().filter(Boolean).length;

  let report = `SOLVABLE with ${extras.length} extras added.\n`;
  report += `(${musicCount} music cells + ${extras.length} silent extras = ${musicCount + extras.length} filled cells total)\n`;
  report += `Found in ${iterations} iterations.\n\n`;

  if (extras.length === 0) {
    report += `The music alone is already uniquely line-solvable — no extras needed.\n`;
  } else {
    report += `Extras added (gray cells — silent, for puzzle structure):\n`;
    const byRow = new Map<number, number[]>();
    for (const [r, c] of extras) {
      if (!byRow.has(r)) byRow.set(r, []);
      byRow.get(r)!.push(c);
    }
    for (const [r, cs] of [...byRow.entries()].sort((a, b) => a[0] - b[0])) {
      const label = displayPitches[usedRows[r]] || `Row ${r}`;
      report += `  ${label}: steps ${cs.sort((a, b) => a - b).map((c) => c + 1).join(", ")}\n`;
    }
  }

  // Mark extra cells visually in the workshop roll
  for (const [solR, solC] of extras) {
    const gridR = usedRows[solR];
    if (seqCells[gridR]?.[solC]) {
      seqCells[gridR][solC].classList.add("extra-cell");
    }
  }

  exportOutput.textContent = report;
  status.textContent = extras.length === 0
    ? "Already solvable — no extras needed."
    : `Solvable! Added ${extras.length} extras (gray). Click "Test play" to try it.`;
});

// --- Test Play Mode ---
// Renders the puzzle as a player would see it: cleared grid with clues
// for the combined (music + extras) pattern. Player fills in to solve.
// When solved, music cells glow in color, extras stay gray.
let testPlayMode = false;
let testPlayGrid: ("empty" | "filled" | "marked")[][] = [];
let testPlayCells: HTMLDivElement[][] = [];
let testPlayPitches: string[] = [];
let testPlayMusic: boolean[][] = []; // music cells only
let testPlayCombined: boolean[][] = []; // music + extras (the puzzle solution)
let testPlayExtrasSet: Set<string> = new Set(); // which cells are extras
let testPlaySolved = false;

function enterTestPlay() {
  const usedRows: number[] = [];
  for (let r = 0; r < displayPitches.length; r++) {
    if (grid[r]?.some(Boolean)) usedRows.push(r);
  }
  if (usedRows.length === 0) {
    status.textContent = "Place some notes first!";
    return;
  }

  testPlayPitches = usedRows.map((i) => displayPitches[i]);
  testPlayMusic = usedRows.map((i) => grid[i].slice(0, steps));

  // Apply extras if they match the current used rows
  const extrasMatch = extrasUsedRows.length === usedRows.length &&
    extrasUsedRows.every((r, i) => r === usedRows[i]);

  testPlayExtrasSet = new Set();
  if (extrasMatch) {
    for (const key of extrasSet) testPlayExtrasSet.add(key);
  }

  // Combined pattern = music OR extras
  testPlayCombined = testPlayMusic.map((row, r) =>
    row.map((isMusic, c) => isMusic || testPlayExtrasSet.has(`${r},${c}`))
  );

  // Start with empty grid (nothing pre-filled)
  testPlayGrid = testPlayCombined.map((row) => row.map(() => "empty"));

  testPlaySolved = false;
  testPlayMode = true;
  rollContainer.style.display = "none";
  playContainer.style.display = "block";
  renderTestPlay();
  const extrasCount = testPlayExtrasSet.size;
  status.textContent = extrasCount > 0
    ? `Test play — ${testPlayCombined.flat().filter(Boolean).length} cells to fill (${extrasCount} are silent extras). Click cells to solve.`
    : "Test play mode — click cells to solve.";
}

function exitTestPlay() {
  testPlayMode = false;
  playContainer.style.display = "none";
  rollContainer.style.display = "";
  status.textContent = "";
}

function renderTestPlay() {
  playContainer.innerHTML = "";
  testPlayCells = [];

  const rows = testPlayPitches.length;
  const cols = steps;

  // Compute clues from combined pattern (music + extras)
  const rowClues = testPlayCombined.map((row) => computeClues(row));
  const colClues: number[][] = [];
  for (let c = 0; c < cols; c++) {
    colClues.push(computeClues(testPlayCombined.map((row) => row[c])));
  }

  const maxColClueLen = Math.max(...colClues.map((c) => c.length || 1));

  // Back button
  const backBtn = document.createElement("button");
  backBtn.textContent = "← Back to edit";
  backBtn.style.marginBottom = "0.5rem";
  backBtn.addEventListener("click", exitTestPlay);
  playContainer.appendChild(backBtn);

  const table = document.createElement("div");
  table.className = "play-table";
  playContainer.appendChild(table);

  // Column clue row
  const colClueRow = document.createElement("div");
  colClueRow.className = "play-col-clue-row";
  const corner = document.createElement("div");
  corner.className = "play-corner";
  colClueRow.appendChild(corner);

  for (let c = 0; c < cols; c++) {
    const clueCell = document.createElement("div");
    clueCell.className = "play-col-clue";
    const clue = colClues[c];
    const padding = maxColClueLen - (clue.length || 1);
    let html = "";
    for (let i = 0; i < padding; i++) html += '<span class="play-clue-pad">&nbsp;</span>';
    if (clue.length === 0) html += '<span class="play-clue-zero">0</span>';
    else html += clue.map((n) => `<span>${n}</span>`).join("");
    clueCell.innerHTML = html;
    colClueRow.appendChild(clueCell);
  }

  const pitchSpacer = document.createElement("div");
  pitchSpacer.className = "play-pitch-spacer";
  colClueRow.appendChild(pitchSpacer);
  table.appendChild(colClueRow);

  // Rows
  for (let r = 0; r < rows; r++) {
    testPlayCells[r] = [];
    const rowEl = document.createElement("div");
    rowEl.className = "play-row";

    const rowClueEl = document.createElement("div");
    rowClueEl.className = "play-row-clue";
    const clue = rowClues[r];
    rowClueEl.textContent = clue.length === 0 ? "0" : clue.join(" ");
    rowEl.appendChild(rowClueEl);

    for (let c = 0; c < cols; c++) {
      const cell = document.createElement("div");
      cell.className = "play-cell";
      if (c % 2 === 0) cell.classList.add("play-even");

      const ri = r, ci = c;
      cell.addEventListener("click", async () => {
        if (testPlaySolved) return;
        await ensureAudio(bpm);
        const note = testPlayPitches[ri];
        const state = testPlayGrid[ri][ci];
        const isMusic = testPlayMusic[ri][ci];
        const isExtra = testPlayExtrasSet.has(`${ri},${ci}`);

        if (state === "empty") {
          testPlayGrid[ri][ci] = "filled";
          cell.classList.remove("play-marked");
          cell.textContent = "";
          // Color based on whether it's a music cell or extra
          // (player doesn't know initially — they see all as same until solved)
          // For feedback, show a generic "filled" color
          cell.classList.add("play-filled");
          cell.style.backgroundColor = "#5566ff";
          cell.style.boxShadow = "0 0 10px #5566ff66";
          // Play the note — music cells sound, extras are silent
          if (isMusic) triggerNote(note);
        } else if (state === "filled") {
          testPlayGrid[ri][ci] = "marked";
          cell.classList.remove("play-filled");
          cell.classList.add("play-marked");
          cell.style.backgroundColor = "";
          cell.style.boxShadow = "";
          cell.textContent = "X";
        } else {
          testPlayGrid[ri][ci] = "empty";
          cell.classList.remove("play-filled", "play-marked");
          cell.style.backgroundColor = "";
          cell.style.boxShadow = "";
          cell.textContent = "";
        }

        // Check win
        if (checkTestPlaySolved()) {
          testPlaySolved = true;
          status.textContent = "Solved! 🎵";
          // Reveal: music cells bright, extras gray
          revealSolution();
          playTestPlayMelody();
        }
      });

      rowEl.appendChild(cell);
      testPlayCells[r][c] = cell;
    }

    // Pitch label on right
    const pitchLabel = document.createElement("div");
    pitchLabel.className = "play-pitch-label";
    pitchLabel.textContent = testPlayPitches[r];
    rowEl.appendChild(pitchLabel);

    table.appendChild(rowEl);
  }
}

function getNoteColorFor(note: string): string {
  const letter = note.replace(/[0-9#]/g, "");
  const colors: Record<string, string> = {
    C: "#ff3355", D: "#ff8833", E: "#ffdd33", F: "#33dd77",
    G: "#33ccff", A: "#5566ff", B: "#aa44ff",
  };
  return colors[letter] || "#888";
}

function checkTestPlaySolved(): boolean {
  for (let r = 0; r < testPlaySolution.length; r++) {
    for (let c = 0; c < testPlayCombined[0].length; c++) {
      const isFilled = testPlayGrid[r][c] === "filled";
      if (isFilled !== testPlayCombined[r][c]) return false;
    }
  }
  return true;
}

function revealSolution() {
  // After solving, recolor cells: music cells bright, extras gray
  for (let r = 0; r < testPlayCells.length; r++) {
    for (let c = 0; c < (testPlayCells[r]?.length || 0); c++) {
      const cell = testPlayCells[r][c];
      if (!cell) continue;
      if (!testPlayCombined[r][c]) continue;
      if (testPlayMusic[r][c]) {
        const note = testPlayPitches[r];
        cell.style.backgroundColor = getNoteColorFor(note);
        cell.style.boxShadow = `0 0 15px ${getNoteColorFor(note)}88`;
      } else {
        // Extra: muted gray
        cell.style.backgroundColor = "#3a3a4a";
        cell.style.boxShadow = "inset 0 0 6px #00000066";
      }
    }
  }
}

async function playTestPlayMelody() {
  await ensureAudio(bpm);
  const secPerStep = 60 / bpm / (quantize === "4n" ? 1 : quantize === "8n" ? 2 : 4);
  const transport = Tone.getTransport();
  transport.stop();
  transport.cancel();
  transport.position = 0;

  // Only play music cells, not extras
  for (let r = 0; r < testPlayPitches.length; r++) {
    let c = 0;
    while (c < steps) {
      if (testPlayMusic[r][c]) {
        let len = 1;
        while (c + len < steps && testPlayMusic[r][c + len]) len++;
        const note = testPlayPitches[r];
        const startTime = c * secPerStep;
        const dur = len * secPerStep * 0.85;
        if (usePiano) {
          import("./audio").then((mod) => mod.scheduleNote(note, startTime, dur));
        } else if (synthInstance) {
          const synth = synthInstance;
          transport.schedule((t) => synth.triggerAttackRelease(note, dur, t), startTime);
        }
        c += len;
      } else {
        c++;
      }
    }
  }

  transport.start();
  setTimeout(() => { transport.stop(); transport.cancel(); }, steps * secPerStep * 1000 + 500);
}

document.getElementById("btn-test-play")!.addEventListener("click", enterTestPlay);

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
  // Find used rows only
  const usedRows: number[] = [];
  for (let r = 0; r < displayPitches.length; r++) {
    if (grid[r]?.some(Boolean)) usedRows.push(r);
  }

  if (usedRows.length === 0) {
    status.textContent = "Place some notes first!";
    return;
  }

  const pitches = usedRows.map((i) => displayPitches[i]);
  const solution = usedRows.map((i) => grid[i].slice(0, steps));
  const filledCount = solution.flat().filter(Boolean).length;

  const rowClues = solution.map((row) => computeClues(row));
  const colClues: number[][] = [];
  for (let c = 0; c < steps; c++) {
    colClues.push(computeClues(solution.map((row) => row[c])));
  }

  const id = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, "");

  const puzzle = { id, title: "Can you hear it?", revealTitle: title, pitches, bpm, solution };

  const tsCode = JSON.stringify(puzzle, null, 2);

  // Shareable URL
  const compressed = { t: title, p: pitches, b: bpm, s: solution.map((row) => row.map((v) => v ? 1 : 0)) };
  const encoded = btoa(JSON.stringify(compressed));
  const shareUrl = `${location.origin}${location.pathname.replace("workshop.html", "")}#puzzle=${encoded}`;

  exportOutput.style.display = "block";
  exportOutput.textContent =
    `// ${title}\n` +
    `// ${pitches.length} pitches × ${steps} steps, ${filledCount} notes\n` +
    `// Row clues: ${rowClues.map((c) => `[${c.join(",")}]`).join(", ")}\n` +
    `// Col clues: ${colClues.map((c) => `[${c.join(",")}]`).join(", ")}\n\n` +
    tsCode +
    `\n\n// Shareable URL:\n// ${shareUrl}`;

  status.textContent = `Exported: ${pitches.length} pitches × ${steps} steps, ${filledCount} notes`;
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Init ---
setInstrument(0);
renderRoll();
