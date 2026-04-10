import * as Tone from "tone";
import { loadPiano, ensureAudio, isSamplerReady } from "./audio";
import { importFile, type ImportResult } from "./importers";
import { checkSolvability, makePlayable } from "./solver";
import { type RowSound, pianoRow, drumRow } from "./puzzles/types";
import {
  type InstrumentKey, gmProgramToInstrumentPrecise, preloadInstruments,
  playRow as playInstrumentRow, scheduleRow as scheduleInstrumentRow,
} from "./instruments";

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

// Helper: get program number from a track's instrument info
function getProgramFromInstrument(track: { program: number }): number {
  return track.program;
}

// GM drum names (MIDI note -> human label)
const GM_DRUM_NAMES: Record<number, string> = {
  35: "Acoustic Bass Drum", 36: "Bass Drum 1", 37: "Side Stick",
  38: "Acoustic Snare", 39: "Hand Clap", 40: "Electric Snare",
  41: "Low Floor Tom", 42: "Closed Hi-Hat", 43: "High Floor Tom",
  44: "Pedal Hi-Hat", 45: "Low Tom", 46: "Open Hi-Hat",
  47: "Low-Mid Tom", 48: "Hi-Mid Tom", 49: "Crash Cymbal 1",
  50: "High Tom", 51: "Ride Cymbal 1", 52: "Chinese Cymbal",
  53: "Ride Bell", 54: "Tambourine", 55: "Splash Cymbal",
  56: "Cowbell", 57: "Crash Cymbal 2", 59: "Ride Cymbal 2",
};

// Map GM drum MIDI note to our drum sound name (from drum-sounds.ts)
const GM_DRUM_TO_SOUND: Record<number, string> = {
  35: "808 Kick", 36: "808 Kick", 37: "808 Rim",
  38: "808 Snare", 39: "808 Clap", 40: "Break Snare",
  41: "808 Lo Tom", 42: "808 Closed Hat", 43: "808 Lo Tom",
  44: "808 Closed Hat", 45: "808 Hi Tom", 46: "808 Open Hat",
  47: "808 Lo Tom", 48: "808 Hi Tom", 49: "808 Crash",
  50: "808 Hi Tom", 51: "BB Ride", 52: "808 Crash",
  53: "BB Ride", 54: "808 Rim", 55: "808 Crash",
  56: "808 Rim", 57: "808 Crash", 59: "BB Ride",
};

function gmDrumNoteToSoundName(midi: number): string {
  return GM_DRUM_TO_SOUND[midi] || "808 Kick";
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
// workRows: the rows currently displayed in the piano roll. Each row has a
// label + instrument + pitch/drumSound. Starts as every piano pitch, but
// MIDI import can replace with track-specific rows using other instruments.
let workRows: RowSound[] = ALL_PITCHES.map(pianoRow);
// Track that each row came from (parallel to workRows). -1 = no track (manual/piano default).
let rowTrackIndex: number[] = workRows.map(() => -1);
// Info about the currently loaded tracks (after MIDI import)
let currentTracks: { index: number; name: string; instrument: string; isDrums: boolean; noteCount: number }[] = [];
// Which tracks are muted (wouldn't sound on playback or click)
let mutedTracks: Set<number> = new Set();
// Legacy alias for existing code paths that only need the label
let displayPitches: string[] = [...ALL_PITCHES];

function setRows(rows: RowSound[]) {
  workRows = rows;
  displayPitches = rows.map((r) => r.label);
}

function isRowMuted(rowIndex: number): boolean {
  const ti = rowTrackIndex[rowIndex];
  if (ti === undefined || ti < 0) return false;
  return mutedTracks.has(ti);
}

function renderTrackPanel() {
  trackPanel.innerHTML = "";
  if (currentTracks.length === 0) {
    trackPanel.style.display = "none";
    return;
  }
  trackPanel.style.display = "flex";

  const heading = document.createElement("div");
  heading.className = "track-panel-heading";
  heading.textContent = "Tracks";
  trackPanel.appendChild(heading);

  const row = document.createElement("div");
  row.className = "track-panel-row";
  trackPanel.appendChild(row);

  for (const track of currentTracks) {
    const chip = document.createElement("button");
    chip.className = "track-chip";
    if (mutedTracks.has(track.index)) chip.classList.add("muted");

    const rowCount = rowTrackIndex.filter((i) => i === track.index).length;
    chip.innerHTML = `
      <span class="track-chip-num">${track.index + 1}</span>
      <span class="track-chip-name">${track.name}</span>
      <span class="track-chip-inst">${track.instrument}${track.isDrums ? " · drums" : ""} · ${rowCount} row${rowCount !== 1 ? "s" : ""}</span>
    `;
    chip.addEventListener("click", () => {
      if (mutedTracks.has(track.index)) mutedTracks.delete(track.index);
      else mutedTracks.add(track.index);
      renderTrackPanel();
      updateRowMuteStyling();
    });
    row.appendChild(chip);
  }

  // Global actions
  const actions = document.createElement("div");
  actions.className = "track-panel-actions";
  const unmuteAll = document.createElement("button");
  unmuteAll.textContent = "Unmute all";
  unmuteAll.addEventListener("click", () => {
    mutedTracks.clear();
    renderTrackPanel();
    updateRowMuteStyling();
  });
  actions.appendChild(unmuteAll);
  trackPanel.appendChild(actions);
}

function updateRowMuteStyling() {
  for (let r = 0; r < workRows.length; r++) {
    const muted = isRowMuted(r);
    for (let c = 0; c < (seqCells[r]?.length || 0); c++) {
      seqCells[r]?.[c]?.classList.toggle("muted-row", muted);
    }
  }
}
let steps = 32;
let bpm = 120;
type QuantizeValue = "4n" | "8n" | "16n" | "32n";
let quantize: QuantizeValue = "16n";

function quantizeDivisor(q: QuantizeValue): number {
  return q === "4n" ? 1 : q === "8n" ? 2 : q === "16n" ? 4 : 8;
}
let title = "My Beat";
let grid: boolean[][] = displayPitches.map(() => Array(steps).fill(false));
// attacks[r][c] = true means a new note starts at this cell. Parallel to grid.
// Without this we'd merge adjacent same-row cells into one held note, losing trills.
let attacks: boolean[][] = displayPitches.map(() => Array(steps).fill(false));

function resetAttacksFromGrid() {
  attacks = grid.map((row) => {
    const out = Array(row.length).fill(false);
    for (let c = 0; c < row.length; c++) {
      if (row[c] && (c === 0 || !row[c - 1])) out[c] = true;
    }
    return out;
  });
}

function freshGrid(rows: number, cols: number) {
  grid = Array.from({ length: rows }, () => Array(cols).fill(false));
  attacks = Array.from({ length: rows }, () => Array(cols).fill(false));
}
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
      <option value="8n">1/8 note</option>
      <option value="16n" selected>1/16 note</option>
      <option value="32n">1/32 note</option>
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

// Track mute panel (appears after MIDI import with multiple tracks)
const trackPanel = document.createElement("div");
trackPanel.className = "track-panel";
trackPanel.style.display = "none";
app.appendChild(trackPanel);

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

  for (let r = 0; r < workRows.length; r++) {
    const row = workRows[r];
    const pitch = row.label;
    // Only apply "black/white key" styling if this is a real piano pitch row
    const looksPitched = row.instrument === "piano" && /^[A-G]#?\d$/.test(pitch);
    const black = looksPitched && isBlackKey(pitch);
    const isC = looksPitched && pitch.startsWith("C") && !pitch.startsWith("C#");

    // Left-side label/key
    const key = document.createElement("div");
    key.className = `piano-key ${black ? "black" : "white"} ${isC ? "c-key" : ""}`;
    if (row.instrument === "drums") {
      key.textContent = row.label;
      key.title = `Drum: ${row.drumSound}`;
      key.style.fontSize = "0.45rem";
    } else if (row.instrument !== "piano") {
      // Non-piano melodic instrument — show instrument + pitch
      key.textContent = `${row.instrument.replace("synth-", "")}/${pitch}`;
      key.style.fontSize = "0.45rem";
    } else {
      key.textContent = isC ? pitch : (black ? "" : pitch.replace(/\d/, ""));
    }
    key.addEventListener("click", async () => {
      await ensureAudio(bpm);
      if (row.instrument === "piano" && row.pitch) triggerNote(row.pitch);
      else playInstrumentRow(row.instrument, { pitch: row.pitch, drumSound: row.drumSound });
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
        const cls = row.pitch ? noteColorClass(row.pitch) : "note-C";
        cell.classList.add("active", cls);
      }
      if (isRowMuted(r)) cell.classList.add("muted-row");

      const ri = r, ci = c;
      const thisRow = row;
      cell.addEventListener("click", async () => {
        await ensureAudio(bpm);
        if (!grid[ri]) grid[ri] = Array(steps).fill(false);
        if (!attacks[ri]) attacks[ri] = Array(steps).fill(false);
        grid[ri][ci] = !grid[ri][ci];
        // Manual click = new attack when filling, clear when emptying
        attacks[ri][ci] = grid[ri][ci];
        if (grid[ri][ci]) {
          const cls = thisRow.pitch ? noteColorClass(thisRow.pitch) : "note-C";
          cell.classList.add("active", cls);
          if (!isRowMuted(ri)) {
            playInstrumentRow(thisRow.instrument, { pitch: thisRow.pitch, drumSound: thisRow.drumSound });
          }
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
  const quantVal = (document.getElementById("cfg-quantize") as HTMLSelectElement).value as QuantizeValue;
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
    attacks = attacks.map((row) => {
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
    // For MIDI with multiple tracks, show a picker before importing
    if (result.tracks && result.tracks.length > 1) {
      showTrackPicker(result);
    } else {
      applyImport(result);
    }
  } catch (err: any) {
    status.textContent = `Import error: ${err.message || err}`;
  }
}

// --- Track picker UI ---
let pendingImport: ImportResult | null = null;
let pickerOverlay: HTMLDivElement | null = null;

function showTrackPicker(result: ImportResult) {
  if (!result.tracks) return;
  pendingImport = result;

  // Build overlay
  if (pickerOverlay) pickerOverlay.remove();
  pickerOverlay = document.createElement("div");
  pickerOverlay.className = "track-picker-overlay";

  const panel = document.createElement("div");
  panel.className = "track-picker-panel";

  const heading = document.createElement("h2");
  heading.textContent = `Import tracks from "${result.title}"`;
  panel.appendChild(heading);

  const hint = document.createElement("p");
  hint.className = "track-picker-hint";
  hint.textContent = "Check the tracks you want to import. Drum tracks use our drum samples.";
  panel.appendChild(hint);

  const list = document.createElement("div");
  list.className = "track-picker-list";
  panel.appendChild(list);

  const selected = new Set<number>();

  for (const track of result.tracks) {
    if (track.noteCount === 0) continue;

    const item = document.createElement("label");
    item.className = "track-picker-item";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = true;
    selected.add(track.index);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) selected.add(track.index);
      else selected.delete(track.index);
    });
    item.appendChild(checkbox);

    const info = document.createElement("div");
    info.className = "track-picker-info";

    const nameLine = document.createElement("div");
    nameLine.className = "track-picker-name";
    nameLine.textContent = `${track.index + 1}. ${track.name || "(unnamed)"}`;
    info.appendChild(nameLine);

    const detailLine = document.createElement("div");
    detailLine.className = "track-picker-detail";
    const range = track.lowestNote !== null && track.highestNote !== null
      ? `${midiToNote(track.lowestNote)}–${midiToNote(track.highestNote)}`
      : "empty";
    const drumLabel = track.isDrums ? " · DRUMS" : "";
    const chLabel = track.channel === 9 ? " (ch 10)" : ` (ch ${track.channel + 1})`;
    detailLine.textContent = `${track.instrument}${drumLabel}${chLabel} · ${track.noteCount} notes · ${range}`;
    info.appendChild(detailLine);

    item.appendChild(info);
    list.appendChild(item);
  }

  // Buttons
  const buttons = document.createElement("div");
  buttons.className = "track-picker-buttons";

  const allBtn = document.createElement("button");
  allBtn.textContent = "Select all";
  allBtn.addEventListener("click", () => {
    pickerOverlay?.querySelectorAll<HTMLInputElement>("input[type=checkbox]").forEach((cb) => {
      cb.checked = true;
      cb.dispatchEvent(new Event("change"));
    });
  });
  buttons.appendChild(allBtn);

  const noneBtn = document.createElement("button");
  noneBtn.textContent = "Select none";
  noneBtn.addEventListener("click", () => {
    pickerOverlay?.querySelectorAll<HTMLInputElement>("input[type=checkbox]").forEach((cb) => {
      cb.checked = false;
      cb.dispatchEvent(new Event("change"));
    });
  });
  buttons.appendChild(noneBtn);

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", () => {
    pickerOverlay?.remove();
    pickerOverlay = null;
    pendingImport = null;
    status.textContent = "";
  });
  buttons.appendChild(cancelBtn);

  const importBtn = document.createElement("button");
  importBtn.textContent = "Import selected";
  importBtn.className = "primary";
  importBtn.addEventListener("click", () => {
    if (!pendingImport) return;
    const filtered = filterImportBySelectedTracks(pendingImport, selected);
    pickerOverlay?.remove();
    pickerOverlay = null;
    applyImport(filtered);
    pendingImport = null;
  });
  buttons.appendChild(importBtn);

  panel.appendChild(buttons);
  pickerOverlay.appendChild(panel);
  app.appendChild(pickerOverlay);
}

function filterImportBySelectedTracks(result: ImportResult, selected: Set<number>): ImportResult {
  if (!result.tracks) return result;
  const keptTracks = result.tracks.filter((t) => selected.has(t.index));
  const keptNotes = keptTracks.flatMap((t) => t.notes || []);
  return {
    ...result,
    notes: keptNotes,
    tracks: keptTracks,
  };
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

  // Auto-detect the best quantize based on the finest onset spacing in the MIDI.
  // We need a step size <= the smallest gap between consecutive note onsets, or
  // melodic runs will collapse onto the same step and sound dissonant.
  if (result.tracks && result.tracks.length > 0) {
    const onsetTimes: number[] = [];
    for (const t of result.tracks) {
      if (!t.notes) continue;
      for (const n of t.notes) onsetTimes.push(n.time);
    }
    onsetTimes.sort((a, b) => a - b);
    let minGap = Infinity;
    for (let i = 1; i < onsetTimes.length; i++) {
      const gap = onsetTimes[i] - onsetTimes[i - 1];
      if (gap > 0.001 && gap < minGap) minGap = gap;
    }
    // Pick the coarsest quantize where secPerStep <= minGap * 1.1 (small tolerance)
    const candidates: QuantizeValue[] = ["4n", "8n", "16n", "32n"];
    let chosen: QuantizeValue = "16n";
    for (const q of candidates) {
      const sec = 60 / bpm / quantizeDivisor(q);
      if (sec <= minGap * 1.1) chosen = q;
    }
    // But never coarser than 16n for MIDI (busy music tends to have 16ths)
    if (chosen === "4n" || chosen === "8n") chosen = "16n";
    quantize = chosen;
    (document.getElementById("cfg-quantize") as HTMLSelectElement).value = chosen;
  }

  const secPerStep = 60 / bpm / quantizeDivisor(quantize);

  // Auto-trim: shift so the first note starts at time 0, size the grid
  // to fit from first to last note.
  const minTime = Math.min(...result.notes.map((n) => n.time));
  const maxTime = Math.max(...result.notes.map((n) => n.time + n.duration));
  const contentSpan = maxTime - minTime;
  const neededSteps = Math.ceil(contentSpan / secPerStep) + 1;
  steps = Math.max(16, Math.min(128, neededSteps));
  (document.getElementById("cfg-steps") as HTMLInputElement).value = String(steps);

  // Reset rows. If the importer gave us track info, build rows per track
  // so each instrument is preserved. Otherwise fall back to full keyboard.
  let placed = 0;

  if (result.tracks && result.tracks.length > 0) {
    // Build rows from each track using its own per-track notes
    const newRows: RowSound[] = [];
    const newRowTracks: number[] = [];
    // Map from (trackIndex + midi) → row index
    const rowIndexByTrackMidi = new Map<string, number>();

    for (const t of result.tracks) {
      if (t.noteCount === 0 || !t.notes) continue;

      const isDrums = t.isDrums;
      const inst: InstrumentKey = isDrums ? "drums" : gmProgramToInstrumentPrecise(getProgramFromInstrument(t));

      // Collect unique MIDI notes actually used by this track
      const uniqueMidi = new Set<number>();
      for (const n of t.notes) uniqueMidi.add(n.midi);
      const sortedMidi = [...uniqueMidi].sort((a, b) => b - a); // high to low

      for (const midi of sortedMidi) {
        let row: RowSound;
        if (isDrums) {
          const soundName = gmDrumNoteToSoundName(midi);
          const label = `${soundName} (${GM_DRUM_NAMES[midi] || `note ${midi}`})`;
          row = { label, instrument: "drums", drumSound: soundName };
        } else {
          const pitch = midiToNote(midi);
          row = { label: pitch, instrument: inst, pitch };
        }
        const rowIdx = newRows.length;
        newRows.push(row);
        newRowTracks.push(t.index);
        rowIndexByTrackMidi.set(`${t.index}:${midi}`, rowIdx);
      }
    }

    // Populate track info for the mute panel
    currentTracks = result.tracks
      .filter((t) => t.noteCount > 0 && t.notes && t.notes.length > 0)
      .map((t) => ({
        index: t.index,
        name: t.name || `Track ${t.index + 1}`,
        instrument: t.isDrums ? "Drums" : t.instrument,
        isDrums: t.isDrums,
        noteCount: t.noteCount,
      }));
    mutedTracks = new Set();

    if (newRows.length === 0) {
      setRows(ALL_PITCHES.map(pianoRow));
      rowTrackIndex = workRows.map(() => -1);
      freshGrid(workRows.length, steps);
    } else {
      setRows(newRows);
      rowTrackIndex = newRowTracks;
      freshGrid(workRows.length, steps);

      // Place notes using per-track data — no more pitch-range guessing.
      // Each note's first step is an attack; subsequent steps are sustain.
      for (const t of result.tracks) {
        if (!t.notes) continue;
        for (const note of t.notes) {
          const rowIdx = rowIndexByTrackMidi.get(`${t.index}:${note.midi}`);
          if (rowIdx === undefined) continue;
          const startStep = Math.round((note.time - minTime) / secPerStep);
          const durationSteps = Math.max(1, Math.round(note.duration / secPerStep));
          for (let s = startStep; s < startStep + durationSteps && s < steps; s++) {
            if (s >= 0) {
              grid[rowIdx][s] = true;
              placed++;
            }
          }
          // Mark the first step of this note as an attack (even if the cell
          // was already filled by a sustained previous note — rapid repeats
          // on the same pitch need to re-trigger).
          if (startStep >= 0 && startStep < steps) {
            attacks[rowIdx][startStep] = true;
          }
        }
      }
    }

    // Preload all instruments used
    const instKeys = new Set<InstrumentKey>();
    const drumNames: string[] = [];
    for (const r of workRows) {
      instKeys.add(r.instrument);
      if (r.drumSound) drumNames.push(r.drumSound);
    }
    preloadInstruments([...instKeys], drumNames);
    renderTrackPanel();
  } else {
    // No track info — use full piano keyboard
    setRows(ALL_PITCHES.map(pianoRow));
    rowTrackIndex = workRows.map(() => -1);
    currentTracks = [];
    mutedTracks = new Set();
    freshGrid(workRows.length, steps);
    renderTrackPanel();

    for (const note of result.notes) {
      const pitchName = midiToNote(note.midi);
      const rowIndex = ALL_PITCHES.indexOf(pitchName);
      if (rowIndex < 0) continue;

      const startStep = Math.round((note.time - minTime) / secPerStep);
      const durationSteps = Math.max(1, Math.round(note.duration / secPerStep));
      for (let s = startStep; s < startStep + durationSteps && s < steps; s++) {
        if (s >= 0) {
          grid[rowIndex][s] = true;
          placed++;
        }
      }
      if (startStep >= 0 && startStep < steps) {
        attacks[rowIndex][startStep] = true;
      }
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

  // Show the track breakdown in the export output so user can see what came in
  if (result.tracks && result.tracks.length > 0) {
    let report = `MIDI Import: "${result.title}"\n`;
    report += `${result.tracks.length} track${result.tracks.length > 1 ? "s" : ""} found:\n\n`;
    for (const t of result.tracks) {
      const range = t.lowestNote !== null && t.highestNote !== null
        ? `${midiToNote(t.lowestNote)}–${midiToNote(t.highestNote)}`
        : "empty";
      const drumMark = t.isDrums ? " [DRUMS — notes are drum sounds, not pitches]" : "";
      report += `  Track ${t.index + 1}: "${t.name}"\n`;
      report += `    Channel: ${t.channel + 1}${t.channel === 9 ? " (GM drums)" : ""}\n`;
      report += `    Instrument: ${t.instrument} (${t.family})${drumMark}\n`;
      report += `    ${t.noteCount} notes, range ${range}\n\n`;
    }
    report += `All tracks were imported onto the piano roll. Drum tracks place notes\n`;
    report += `at nonsense pitches (kick=C2, snare=D2, etc.) since drum note numbers\n`;
    report += `don't represent pitches. Delete unwanted rows manually or use Trim Empty\n`;
    report += `after clearing the unwanted areas.\n`;
    exportOutput.style.display = "block";
    exportOutput.textContent = report;
  }
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

  isPlaying = true;
  const secPerStep = 60 / bpm / quantizeDivisor(quantize);

  const transport = Tone.getTransport();
  transport.stop();
  transport.cancel();
  transport.position = 0;

  // Schedule notes using attack markers. Each attack starts a new note that
  // sustains until the next attack or an empty cell. This preserves rapid
  // repeated notes (trills) that would otherwise merge into one held note.
  for (let r = 0; r < workRows.length; r++) {
    if (!grid[r]) continue;
    if (isRowMuted(r)) continue;
    const rowSound = workRows[r];
    const rowAttacks = attacks[r] || [];
    let c = 0;
    while (c < steps) {
      if (grid[r][c] && rowAttacks[c]) {
        let len = 1;
        while (
          c + len < steps &&
          grid[r][c + len] &&
          !rowAttacks[c + len]
        ) len++;
        const startTime = c * secPerStep;
        const dur = len * secPerStep * 0.85;
        scheduleInstrumentRow(
          rowSound.instrument,
          { pitch: rowSound.pitch, drumSound: rowSound.drumSound },
          startTime,
          dur,
        );
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
  setRows(ALL_PITCHES.map(pianoRow));
  rowTrackIndex = workRows.map(() => -1);
  currentTracks = [];
  mutedTracks = new Set();
  renderTrackPanel();
  freshGrid(workRows.length, steps);
  // Reset UI controls
  (document.getElementById("cfg-steps") as HTMLInputElement).value = "32";
  (document.getElementById("cfg-bpm") as HTMLInputElement).value = "120";
  (document.getElementById("cfg-title") as HTMLInputElement).value = "My Beat";
  // Reset quantize
  quantize = "16n";
  (document.getElementById("cfg-quantize") as HTMLSelectElement).value = "16n";
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
  const trimmedRows = usedIndices.map((i) => workRows[i]);
  setRows(trimmedRows);
  grid = usedIndices.map((i) => grid[i]);
  attacks = usedIndices.map((i) => attacks[i]);
  rowTrackIndex = usedIndices.map((i) => rowTrackIndex[i] ?? -1);
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
  attacks = attacks.map((row) => row.slice(4));
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
  attacks = attacks.map((row) => row.slice(0, steps));
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

  // Toolbar
  const toolbar = document.createElement("div");
  toolbar.style.display = "flex";
  toolbar.style.gap = "0.5rem";
  toolbar.style.marginBottom = "0.5rem";
  toolbar.style.alignItems = "center";

  const backBtn = document.createElement("button");
  backBtn.textContent = "← Back to edit";
  backBtn.addEventListener("click", exitTestPlay);
  toolbar.appendChild(backBtn);

  const autoBtn = document.createElement("button");
  autoBtn.textContent = "Auto-solve (step by step)";
  autoBtn.className = "primary";
  autoBtn.addEventListener("click", () => autoSolve(autoBtn));
  toolbar.appendChild(autoBtn);

  const speedLabel = document.createElement("label");
  speedLabel.style.fontSize = "0.7rem";
  speedLabel.style.color = "#666";
  speedLabel.textContent = "Speed:";
  toolbar.appendChild(speedLabel);

  const speedSlider = document.createElement("input");
  speedSlider.type = "range";
  speedSlider.id = "auto-speed";
  speedSlider.min = "50";
  speedSlider.max = "1000";
  speedSlider.value = "300";
  speedSlider.style.width = "80px";
  toolbar.appendChild(speedSlider);

  const autoStatus = document.createElement("span");
  autoStatus.id = "auto-status";
  autoStatus.style.fontSize = "0.7rem";
  autoStatus.style.color = "#888";
  autoStatus.style.marginLeft = "0.5rem";
  toolbar.appendChild(autoStatus);

  playContainer.appendChild(toolbar);

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

// --- Visual auto-solver ---
// Runs the line solver one deduction at a time with visual feedback.
// Highlights the line being analyzed, fills cells it determines, pauses, repeats.
let autoSolving = false;

async function autoSolve(btn: HTMLButtonElement) {
  if (autoSolving) {
    autoSolving = false;
    btn.textContent = "Auto-solve (step by step)";
    return;
  }
  autoSolving = true;
  btn.textContent = "Stop";
  const statusSpan = document.getElementById("auto-status")!;

  const rows = testPlayPitches.length;
  const cols = steps;

  // Compute clues from combined pattern
  const rowClues = testPlayCombined.map((row) => computeCluesLocal(row));
  const colClues: number[][] = [];
  for (let c = 0; c < cols; c++) {
    colClues.push(computeCluesLocal(testPlayCombined.map((row) => row[c])));
  }

  // Working state: 0 = unknown, 1 = filled, -1 = marked empty
  const state: number[][] = Array.from({ length: rows }, () => Array(cols).fill(0));
  // Pre-fill from any existing test play state
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (testPlayGrid[r][c] === "filled") state[r][c] = 1;
      else if (testPlayGrid[r][c] === "marked") state[r][c] = -1;
    }
  }

  // Placements per row and column
  function genPlacements(clues: number[], len: number): boolean[][] {
    const out: boolean[][] = [];
    function place(ci: number, pos: number, cur: boolean[]) {
      if (ci === clues.length) {
        const line = [...cur];
        while (line.length < len) line.push(false);
        out.push(line);
        return;
      }
      const cl = clues[ci];
      const rem = clues.slice(ci + 1).reduce((a, b) => a + b + 1, 0);
      const mx = len - cl - rem;
      for (let s = pos; s <= mx; s++) {
        const line = [...cur];
        while (line.length < s) line.push(false);
        for (let i = 0; i < cl; i++) line.push(true);
        if (ci < clues.length - 1) line.push(false);
        place(ci + 1, line.length, line);
      }
    }
    if (!clues.length) out.push(Array(len).fill(false));
    else place(0, 0, []);
    return out;
  }

  const rowPlacements = rowClues.map((c) => genPlacements(c, cols));
  const colPlacements = colClues.map((c) => genPlacements(c, rows));

  function filterLine(placements: boolean[][], known: number[]): boolean[][] {
    return placements.filter((p) =>
      p.every((v, i) => known[i] === 0 || v === (known[i] === 1))
    );
  }

  function deduceLine(placements: boolean[][], len: number): number[] {
    const result = Array(len).fill(0);
    if (placements.length === 0) return result;
    for (let i = 0; i < len; i++) {
      const allFilled = placements.every((p) => p[i]);
      const allEmpty = placements.every((p) => !p[i]);
      if (allFilled) result[i] = 1;
      else if (allEmpty) result[i] = -1;
    }
    return result;
  }

  function highlightLine(type: "row" | "col", idx: number, on: boolean) {
    if (type === "row") {
      for (let c = 0; c < cols; c++) {
        const cell = testPlayCells[idx]?.[c];
        if (cell) cell.classList.toggle("auto-highlight", on);
      }
    } else {
      for (let r = 0; r < rows; r++) {
        const cell = testPlayCells[r]?.[idx];
        if (cell) cell.classList.toggle("auto-highlight", on);
      }
    }
  }

  function applyToCell(r: number, c: number, val: 1 | -1) {
    const cell = testPlayCells[r]?.[c];
    if (!cell) return;
    if (val === 1) {
      testPlayGrid[r][c] = "filled";
      cell.classList.remove("play-marked");
      cell.classList.add("play-filled", "auto-new");
      cell.textContent = "";
      cell.style.backgroundColor = "#5566ff";
      cell.style.boxShadow = "0 0 10px #5566ff88";
      setTimeout(() => cell.classList.remove("auto-new"), 400);
    } else {
      testPlayGrid[r][c] = "marked";
      cell.classList.remove("play-filled");
      cell.classList.add("play-marked", "auto-new");
      cell.style.backgroundColor = "";
      cell.style.boxShadow = "";
      cell.textContent = "·";
      setTimeout(() => cell.classList.remove("auto-new"), 400);
    }
  }

  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  const getDelay = () => {
    const slider = document.getElementById("auto-speed") as HTMLInputElement;
    return parseInt(slider?.value || "300");
  };

  let changed = true;
  let iter = 0;
  let totalDeductions = 0;

  while (changed && iter < 100 && autoSolving) {
    changed = false;
    iter++;

    // Rows
    for (let r = 0; r < rows && autoSolving; r++) {
      const valid = filterLine(rowPlacements[r], state[r]);
      rowPlacements[r] = valid;
      if (valid.length === 0) {
        statusSpan.textContent = `CONTRADICTION in row ${testPlayPitches[r]}`;
        autoSolving = false;
        btn.textContent = "Auto-solve (step by step)";
        return;
      }
      const deduced = deduceLine(valid, cols);
      const newCells: { c: number; v: 1 | -1 }[] = [];
      for (let c = 0; c < cols; c++) {
        if (state[r][c] === 0 && deduced[c] !== 0) {
          newCells.push({ c, v: deduced[c] as 1 | -1 });
        }
      }
      if (newCells.length > 0) {
        statusSpan.textContent = `Row ${testPlayPitches[r]} [${rowClues[r].join(",")}] → ${newCells.length} cell${newCells.length > 1 ? "s" : ""}`;
        highlightLine("row", r, true);
        await sleep(getDelay());
        for (const { c, v } of newCells) {
          state[r][c] = v;
          applyToCell(r, c, v);
          totalDeductions++;
        }
        await sleep(getDelay());
        highlightLine("row", r, false);
        changed = true;
        if (!autoSolving) break;
      }
    }

    if (!autoSolving) break;

    // Columns
    for (let c = 0; c < cols && autoSolving; c++) {
      const known: number[] = [];
      for (let r = 0; r < rows; r++) known.push(state[r][c]);
      const valid = filterLine(colPlacements[c], known);
      colPlacements[c] = valid;
      if (valid.length === 0) {
        statusSpan.textContent = `CONTRADICTION in column ${c + 1}`;
        autoSolving = false;
        btn.textContent = "Auto-solve (step by step)";
        return;
      }
      const deduced = deduceLine(valid, rows);
      const newCells: { r: number; v: 1 | -1 }[] = [];
      for (let r = 0; r < rows; r++) {
        if (state[r][c] === 0 && deduced[r] !== 0) {
          newCells.push({ r, v: deduced[r] as 1 | -1 });
        }
      }
      if (newCells.length > 0) {
        statusSpan.textContent = `Col ${c + 1} [${colClues[c].join(",")}] → ${newCells.length} cell${newCells.length > 1 ? "s" : ""}`;
        highlightLine("col", c, true);
        await sleep(getDelay());
        for (const { r, v } of newCells) {
          state[r][c] = v;
          applyToCell(r, c, v);
          totalDeductions++;
        }
        await sleep(getDelay());
        highlightLine("col", c, false);
        changed = true;
        if (!autoSolving) break;
      }
    }
  }

  // Check final state
  let unknowns = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (state[r][c] === 0) unknowns++;
    }
  }

  if (unknowns === 0) {
    statusSpan.textContent = `Solved! ${totalDeductions} deductions in ${iter} passes.`;
    if (checkTestPlaySolved()) {
      testPlaySolved = true;
      revealSolution();
      playTestPlayMelody();
    }
  } else {
    statusSpan.textContent = `Stuck — ${unknowns} cells need look-ahead (${totalDeductions} deductions, ${iter} passes)`;
  }

  autoSolving = false;
  btn.textContent = "Auto-solve (step by step)";
}

function computeCluesLocal(line: boolean[]): number[] {
  const clues: number[] = [];
  let run = 0;
  for (const cell of line) {
    if (cell) { run++; } else if (run > 0) { clues.push(run); run = 0; }
  }
  if (run > 0) clues.push(run);
  return clues;
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
  const secPerStep = 60 / bpm / quantizeDivisor(quantize);
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
  // Find used rows only (any row with music or extras)
  const usedRows: number[] = [];
  for (let r = 0; r < displayPitches.length; r++) {
    const hasMusic = grid[r]?.some(Boolean);
    const hasExtra = [...extrasSet].some((k) => {
      const [er] = k.split(",").map(Number);
      // extrasSet uses solution-space row indices; map back through extrasUsedRows
      return extrasUsedRows[er] === r;
    });
    if (hasMusic || hasExtra) usedRows.push(r);
  }

  if (usedRows.length === 0) {
    status.textContent = "Place some notes first!";
    return;
  }

  const usedWorkRows = usedRows.map((i) => workRows[i]);

  // Music grid: the user's notes
  const musicGrid = usedRows.map((i) => grid[i].slice(0, steps).map(Boolean));
  // Attacks grid: where each note starts (preserves trills and repeats)
  const attacksGrid = usedRows.map((i) => (attacks[i] || []).slice(0, steps).map(Boolean));

  // Extras grid: rebuild from extrasSet, remapping indices to usedRows space
  const extrasGrid: boolean[][] = usedRows.map(() => Array(steps).fill(false));
  for (const key of extrasSet) {
    const [exR, exC] = key.split(",").map(Number);
    const origRow = extrasUsedRows[exR];
    if (origRow === undefined) continue;
    const newR = usedRows.indexOf(origRow);
    if (newR >= 0 && exC < steps) extrasGrid[newR][exC] = true;
  }

  const combined = musicGrid.map((row, r) =>
    row.map((m, c) => m || extrasGrid[r][c])
  );
  const rowClues = combined.map((row) => computeClues(row));
  const colClues: number[][] = [];
  for (let c = 0; c < steps; c++) {
    colClues.push(computeClues(combined.map((row) => row[c])));
  }

  const id = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-+$/g, "") || "my-puzzle";
  const musicCount = musicGrid.flat().filter(Boolean).length;
  const extrasCount = extrasGrid.flat().filter(Boolean).length;

  // Format a boolean row as ` true`/`false` for consistency with existing puzzle files
  const fmtRow = (row: boolean[]) =>
    "[" + row.map((v) => (v ? " true" : "false")).join(", ") + "]";

  // Format each row as a RowSound literal
  const fmtRowSound = (r: RowSound) => {
    const parts: string[] = [];
    parts.push(`label: "${r.label.replace(/"/g, '\\"')}"`);
    parts.push(`instrument: "${r.instrument}"`);
    if (r.pitch) parts.push(`pitch: "${r.pitch}"`);
    if (r.drumSound) parts.push(`drumSound: "${r.drumSound.replace(/"/g, '\\"')}"`);
    return `    { ${parts.join(", ")} }`;
  };

  const rowsArr = usedWorkRows.map(fmtRowSound).join(",\n");

  // Only emit attacks if they differ from the implicit "start of each run"
  // rule — no need to write them for simple puzzles
  const derivedAttacks = musicGrid.map((row) => {
    const out = Array(row.length).fill(false);
    for (let c = 0; c < row.length; c++) {
      if (row[c] && (c === 0 || !row[c - 1])) out[c] = true;
    }
    return out;
  });
  const attacksDiffer = attacksGrid.some((row, r) =>
    row.some((v, c) => v !== derivedAttacks[r][c])
  );

  const attacksBlock = attacksDiffer
    ? `  attacks: [\n` +
      attacksGrid.map((row, i) => `    ${fmtRow(row)}, // ${usedWorkRows[i].label}`).join("\n") + "\n" +
      `  ],\n`
    : "";

  const tsCode =
    `import type { Puzzle } from "./types";\n\n` +
    `// ${title} — ${musicCount} music cells${extrasCount > 0 ? ` + ${extrasCount} silent extras` : ""}\n` +
    `const puzzle: Puzzle = {\n` +
    `  id: "${id}",\n` +
    `  title: "${title.replace(/"/g, '\\"')}",\n` +
    `  composer: "",\n` +
    `  category: "",\n` +
    `  difficulty: "easy",\n` +
    `  bpm: ${bpm},\n` +
    `  rows: [\n${rowsArr},\n  ],\n` +
    `  music: [\n` +
    musicGrid.map((row, i) => `    ${fmtRow(row)}, // ${usedWorkRows[i].label}`).join("\n") + "\n" +
    `  ],\n` +
    `  extras: [\n` +
    extrasGrid.map((row, i) => `    ${fmtRow(row)}, // ${usedWorkRows[i].label}`).join("\n") + "\n" +
    `  ],\n` +
    attacksBlock +
    `};\n\n` +
    `export default puzzle;\n`;

  exportOutput.style.display = "block";
  exportOutput.textContent =
    `// Paste this into src/puzzles/${id}.ts\n` +
    `// Then add to src/puzzles/index.ts:\n` +
    `//   import ${id.replace(/-/g, "_")} from "./${id}";\n` +
    `//   export const PUZZLES = [..., ${id.replace(/-/g, "_")}];\n\n` +
    `// ${usedWorkRows.length} rows × ${steps} steps · ${musicCount} music + ${extrasCount} extras\n` +
    `// Row clues: ${rowClues.map((c) => `[${c.join(",")}]`).join(", ")}\n` +
    `// Col clues: ${colClues.map((c) => `[${c.join(",")}]`).join(", ")}\n\n` +
    tsCode;

  status.textContent = `Exported: ${pitches.length} pitches × ${steps} steps, ${musicCount} music, ${extrasCount} extras`;
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Init ---
setInstrument(0);
renderRoll();
