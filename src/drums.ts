import * as Tone from "tone";
import { Midi } from "@tonejs/midi";
import { ALL_SOUNDS } from "./drum-sounds";
import { checkSolvability, makePlayable } from "./solver";

// Default track assignments (mix of both kits)
const DEFAULT_SOUNDS = [
  "808 Kick", "Break Snare", "808 Clap", "808 Closed Hat",
  "BB Open Hat", "808 Rim", "Punchy Kick", "BB Ride",
];

const NUM_TRACKS = 8;

// --- State ---
let trackSounds: number[] = DEFAULT_SOUNDS.map((name) =>
  Math.max(0, ALL_SOUNDS.findIndex((s) => s.name === name))
);
let steps = 16;
let bpm = 140;
let swing = 0;
let grid: boolean[][] = Array.from({ length: NUM_TRACKS }, () => Array(steps).fill(false));
let players: Map<string, Tone.Player> = new Map(); // keyed by URL
let isPlaying = false;
let looping = false;
let cellEls: HTMLDivElement[][] = [];

// --- DOM ---
const app = document.getElementById("app")!;

const header = document.createElement("div");
header.className = "header";
header.innerHTML = `<h1>Drum Machine</h1><div class="header-links"><a href="workshop.html">Workshop</a><a href="index.html">Game</a></div>`;
app.appendChild(header);

// Steps: increments of 4 from 4 to 128
const stepsOptions: number[] = [];
for (let s = 4; s <= 128; s += 4) stepsOptions.push(s);

const config = document.createElement("div");
config.className = "config";
config.innerHTML = `
  <div class="config-group">
    <label>BPM</label>
    <input type="number" id="cfg-bpm" value="${bpm}" min="60" max="300">
  </div>
  <div class="config-group">
    <label>Steps</label>
    <select id="cfg-steps">
      ${stepsOptions.map((s) => `<option value="${s}" ${s === 16 ? "selected" : ""}>${s} (${s / 4} bar${s / 4 !== 1 ? "s" : ""})</option>`).join("")}
    </select>
  </div>
  <div class="config-group">
    <label>Swing</label>
    <input type="range" id="cfg-swing" min="0" max="80" value="0" style="width:100px">
    <span id="swing-val" style="font-size:0.7rem;color:#666">0%</span>
  </div>
  <div class="config-group">
    <label>&nbsp;</label>
    <button id="btn-add-track">+ Track</button>
  </div>
`;
app.appendChild(config);

// MIDI drop zone
const midiDrop = document.createElement("div");
midiDrop.className = "midi-drop";
midiDrop.innerHTML = `<span>Drop a drum MIDI file here or <label class="midi-browse">browse<input type="file" id="midi-file" accept=".mid,.midi" hidden></label></span>`;
app.appendChild(midiDrop);

const loadStatus = document.createElement("p");
loadStatus.className = "load-status";
loadStatus.textContent = "Loading samples...";
app.appendChild(loadStatus);

const seqWrap = document.createElement("div");
seqWrap.className = "seq-wrap";
app.appendChild(seqWrap);

const controls = document.createElement("div");
controls.className = "controls";
controls.innerHTML = `
  <button id="btn-play">&#9654; Play</button>
  <button id="btn-loop" class="primary">&#8635; Loop</button>
  <button id="btn-stop">&#9632; Stop</button>
  <button id="btn-clear">Clear</button>
  <button id="btn-trim">Trim empty</button>
  <button id="btn-check">Check solvability</button>
  <button id="btn-make-solvable" class="primary">Make solvable</button>
  <button id="btn-export" class="primary">Export</button>
</span>
<div class="config-inline" id="difficulty-wrap" style="display:none;gap:0.5rem;align-items:center;margin-top:0.3rem">
  <label style="font-size:0.6rem;color:#555;text-transform:uppercase">Difficulty</label>
  <input type="range" id="cfg-difficulty" min="0" max="100" value="50" style="width:120px;accent-color:#5566ff">
  <span id="diff-label" style="font-size:0.7rem;color:#666">Medium</span>
</div>
`;
app.appendChild(controls);

const statusEl = document.createElement("p");
statusEl.className = "status";
app.appendChild(statusEl);

const exportOutput = document.createElement("pre");
exportOutput.className = "export-output";
app.appendChild(exportOutput);

// --- Sample loading ---
// Load samples on demand, cache by URL
function loadSample(url: string): Promise<Tone.Player> {
  if (players.has(url)) return Promise.resolve(players.get(url)!);

  return new Promise((resolve) => {
    const player = new Tone.Player({
      url,
      onload: () => {
        players.set(url, player);
        updateLoadStatus();
        resolve(player);
      },
      onerror: () => {
        console.warn("Failed to load:", url);
        updateLoadStatus();
        resolve(player); // resolve anyway so we don't block
      },
    }).toDestination();
  });
}

function updateLoadStatus() {
  const needed = new Set(trackSounds.map((i) => ALL_SOUNDS[i].url));
  const loaded = [...needed].filter((url) => players.has(url) && players.get(url)!.loaded).length;
  if (loaded >= needed.size) {
    loadStatus.style.display = "none";
  } else {
    loadStatus.style.display = "block";
    loadStatus.textContent = `Loading samples... ${loaded}/${needed.size}`;
  }
}

async function loadAllTrackSamples() {
  const urls = new Set(trackSounds.map((i) => ALL_SOUNDS[i].url));
  await Promise.all([...urls].map((url) => loadSample(url)));
}

function getPlayer(trackIndex: number): Tone.Player | null {
  const sound = ALL_SOUNDS[trackSounds[trackIndex]];
  if (!sound) return null;
  return players.get(sound.url) || null;
}

async function previewTrack(trackIndex: number) {
  await Tone.start();
  const player = getPlayer(trackIndex);
  if (player?.loaded) {
    player.stop();
    player.start();
  }
}

// --- Build sound selector dropdown HTML ---
function soundSelectHTML(selectedIndex: number): string {
  let html = "";
  const categories = [...new Set(ALL_SOUNDS.map((s) => s.category))];
  for (const cat of categories) {
    html += `<optgroup label="${cat}">`;
    ALL_SOUNDS.forEach((s, i) => {
      if (s.category === cat) {
        html += `<option value="${i}" ${i === selectedIndex ? "selected" : ""}>${s.name}</option>`;
      }
    });
    html += `</optgroup>`;
  }
  return html;
}

// --- Render sequencer ---
function renderSequencer() {
  seqWrap.innerHTML = "";
  cellEls = [];

  const table = document.createElement("div");
  table.className = "seq-table";

  // Beat numbers row
  const beatRow = document.createElement("div");
  beatRow.className = "seq-row beat-header";
  const labelSpacer = document.createElement("div");
  labelSpacer.className = "track-controls";
  beatRow.appendChild(labelSpacer);
  for (let c = 0; c < steps; c++) {
    const num = document.createElement("div");
    num.className = "seq-cell beat-num";
    num.textContent = c % 4 === 0 ? `${Math.floor(c / 4) + 1}` : "";
    beatRow.appendChild(num);
  }
  table.appendChild(beatRow);

  // Track rows
  for (let r = 0; r < trackSounds.length; r++) {
    cellEls[r] = [];
    const sound = ALL_SOUNDS[trackSounds[r]];
    const row = document.createElement("div");
    row.className = "seq-row";

    // Track controls: sound selector + preview button + remove
    const trackCtrl = document.createElement("div");
    trackCtrl.className = "track-controls";

    const preview = document.createElement("button");
    preview.className = "preview-btn";
    preview.style.background = sound.color;
    preview.textContent = "▶";
    preview.title = "Preview sound";
    const ri = r;
    preview.addEventListener("click", () => previewTrack(ri));
    trackCtrl.appendChild(preview);

    const select = document.createElement("select");
    select.className = "sound-select";
    select.innerHTML = soundSelectHTML(trackSounds[r]);
    select.addEventListener("change", async () => {
      trackSounds[ri] = parseInt(select.value);
      const newSound = ALL_SOUNDS[trackSounds[ri]];
      preview.style.background = newSound.color;
      await loadSample(newSound.url);
      // Update cell colors for this row
      for (let c = 0; c < steps; c++) {
        const cell = cellEls[ri][c];
        if (grid[ri]?.[c]) {
          cell.style.background = newSound.color + "66";
          cell.style.boxShadow = `inset 0 0 8px ${newSound.color}44`;
        }
      }
      previewTrack(ri);
    });
    trackCtrl.appendChild(select);

    if (trackSounds.length > 1) {
      const removeBtn = document.createElement("button");
      removeBtn.className = "remove-btn";
      removeBtn.textContent = "×";
      removeBtn.title = "Remove track";
      removeBtn.addEventListener("click", () => {
        trackSounds.splice(ri, 1);
        grid.splice(ri, 1);
        renderSequencer();
      });
      trackCtrl.appendChild(removeBtn);
    }

    row.appendChild(trackCtrl);

    // Step cells
    for (let c = 0; c < steps; c++) {
      const cell = document.createElement("div");
      cell.className = "seq-cell";
      if (c % 4 === 0) cell.classList.add("bar-start");
      if (c % 2 === 0) cell.classList.add("even-step");

      if (grid[r]?.[c]) {
        cell.classList.add("active");
        cell.style.background = sound.color + "66";
        cell.style.boxShadow = `inset 0 0 8px ${sound.color}44`;
      }

      const trackI = r, colI = c;
      cell.addEventListener("click", async () => {
        await Tone.start();
        grid[trackI][colI] = !grid[trackI][colI];
        const s = ALL_SOUNDS[trackSounds[trackI]];
        if (grid[trackI][colI]) {
          cell.classList.add("active");
          cell.style.background = s.color + "66";
          cell.style.boxShadow = `inset 0 0 8px ${s.color}44`;
          previewTrack(trackI);
        } else {
          cell.classList.remove("active");
          cell.style.background = "";
          cell.style.boxShadow = "";
        }
      });

      row.appendChild(cell);
      cellEls[r][c] = cell;
    }

    table.appendChild(row);
  }

  seqWrap.appendChild(table);
}

// --- Config ---
document.getElementById("cfg-bpm")!.addEventListener("change", (e) => {
  bpm = Math.max(60, Math.min(300, parseInt((e.target as HTMLInputElement).value) || 140));
});

document.getElementById("cfg-steps")!.addEventListener("change", (e) => {
  steps = parseInt((e.target as HTMLSelectElement).value);
  grid = grid.map((row) => {
    const newRow = Array(steps).fill(false);
    for (let c = 0; c < Math.min(row.length, steps); c++) newRow[c] = row[c];
    return newRow;
  });
  renderSequencer();
});

document.getElementById("cfg-swing")!.addEventListener("input", (e) => {
  swing = parseInt((e.target as HTMLInputElement).value);
  document.getElementById("swing-val")!.textContent = `${swing}%`;
});

document.getElementById("btn-add-track")!.addEventListener("click", () => {
  // Add a new track with the first unused sound, or default to 808 Kick
  const used = new Set(trackSounds);
  let newSound = 0;
  for (let i = 0; i < ALL_SOUNDS.length; i++) {
    if (!used.has(i)) { newSound = i; break; }
  }
  trackSounds.push(newSound);
  grid.push(Array(steps).fill(false));
  loadSample(ALL_SOUNDS[newSound].url).then(() => renderSequencer());
  renderSequencer();
});

// --- Playback ---
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function playOnce() {
  if (isPlaying) return;
  await Tone.start();
  isPlaying = true;

  const secPerStep = (60 / bpm) / 4;
  const swingAmount = (swing / 100) * secPerStep * 0.7;

  for (let col = 0; col < steps; col++) {
    if (!isPlaying) break;

    const isSwung = col % 2 === 1;
    const stepDelay = isSwung ? swingAmount : 0;

    for (let r = 0; r < trackSounds.length; r++) {
      if (cellEls[r]?.[col]) cellEls[r][col].classList.add("playhead");
    }

    for (let r = 0; r < trackSounds.length; r++) {
      if (grid[r]?.[col]) {
        const player = getPlayer(r);
        if (player?.loaded) {
          player.stop();
          player.start(Tone.now() + stepDelay);
        }
      }
    }

    await sleep(secPerStep * 1000);

    for (let r = 0; r < trackSounds.length; r++) {
      if (cellEls[r]?.[col]) cellEls[r][col].classList.remove("playhead");
    }
  }

  isPlaying = false;
}

async function startLoop() {
  looping = true;
  statusEl.textContent = "Looping...";
  while (looping) {
    await playOnce();
    if (!looping) break;
  }
  statusEl.textContent = "";
}

function stopPlayback() {
  looping = false;
  isPlaying = false;
  for (const [, p] of players) p.stop();
  for (let r = 0; r < cellEls.length; r++) {
    for (let c = 0; c < (cellEls[r]?.length || 0); c++) {
      cellEls[r]?.[c]?.classList.remove("playhead");
    }
  }
  statusEl.textContent = "";
}

document.getElementById("btn-play")!.addEventListener("click", () => { if (!isPlaying) playOnce(); });
document.getElementById("btn-loop")!.addEventListener("click", () => { looping ? stopPlayback() : startLoop(); });
document.getElementById("btn-stop")!.addEventListener("click", stopPlayback);
document.getElementById("btn-clear")!.addEventListener("click", () => {
  stopPlayback();
  grid = grid.map(() => Array(steps).fill(false));
  renderSequencer();
});

document.getElementById("btn-trim")!.addEventListener("click", () => {
  if (isPlaying) return;
  const keep: number[] = [];
  for (let r = 0; r < grid.length; r++) {
    if (grid[r]?.some(Boolean)) keep.push(r);
  }
  if (keep.length === grid.length) {
    statusEl.textContent = "No empty rows to remove";
    return;
  }
  if (keep.length === 0) {
    statusEl.textContent = "All rows are empty — nothing to keep";
    return;
  }
  const removed = grid.length - keep.length;
  trackSounds = keep.map((i) => trackSounds[i]);
  grid = keep.map((i) => grid[i]);
  renderSequencer();
  statusEl.textContent = `Removed ${removed} empty row${removed > 1 ? "s" : ""}`;
});

// --- Check solvability ---
document.getElementById("btn-check")!.addEventListener("click", async () => {
  const usedRows: number[] = [];
  for (let r = 0; r < grid.length; r++) {
    if (grid[r]?.some(Boolean)) usedRows.push(r);
  }
  if (usedRows.length === 0) {
    statusEl.textContent = "Place some hits first!";
    return;
  }

  const solution = usedRows.map((i) => grid[i].slice(0, steps));
  const rowLabels = usedRows.map((i) => ALL_SOUNDS[trackSounds[i]].name);
  const colLabels = Array.from({ length: steps }, (_, i) => `Beat ${i + 1}`);

  exportOutput.style.display = "block";
  exportOutput.textContent = "Checking...";
  statusEl.textContent = "Checking solvability...";

  const { report } = await checkSolvability(solution, rowLabels, colLabels, (msg) => {
    exportOutput.textContent = msg;
  });

  exportOutput.textContent = report;
  statusEl.textContent = report.startsWith("SOLVABLE") ? "Puzzle is solvable!" : "Not solvable yet — see details below";
  document.getElementById("difficulty-wrap")!.style.display = report.startsWith("SOLVABLE") ? "none" : "flex";
});

document.getElementById("cfg-difficulty")!.addEventListener("input", (e) => {
  const val = parseInt((e.target as HTMLInputElement).value);
  const labels = ["Easy", "Easy", "Medium", "Hard", "Expert"];
  document.getElementById("diff-label")!.textContent = labels[Math.floor(val / 25)] || "Medium";
});

document.getElementById("btn-make-solvable")!.addEventListener("click", async () => {
  const usedRows: number[] = [];
  for (let r = 0; r < grid.length; r++) {
    if (grid[r]?.some(Boolean)) usedRows.push(r);
  }
  if (usedRows.length === 0) {
    statusEl.textContent = "Place some hits first!";
    return;
  }

  const solution = usedRows.map((i) => grid[i].slice(0, steps));
  const difficulty = parseInt((document.getElementById("cfg-difficulty") as HTMLInputElement).value) / 100;

  exportOutput.style.display = "block";
  exportOutput.textContent = "Finding minimum givens...";
  statusEl.textContent = "Making puzzle solvable...";

  const { givens, iterations } = await makePlayable(solution, difficulty, (msg) => {
    exportOutput.textContent = msg;
  });

  const filledCells = solution.flat().filter(Boolean).length;
  const givenPct = Math.round((givens.length / filledCells) * 100);

  let report = `SOLVABLE with ${givens.length} given cells (${givenPct}% of ${filledCells} hits revealed).\n`;
  report += `Difficulty: ${difficulty < 0.3 ? "Easy" : difficulty < 0.7 ? "Medium" : "Hard"}\n`;
  report += `Found in ${iterations} rounds.\n\n`;

  const byRow = new Map<number, number[]>();
  for (const [r, c] of givens) {
    if (!byRow.has(r)) byRow.set(r, []);
    byRow.get(r)!.push(c);
  }
  report += `Given cells:\n`;
  for (const [r, cols] of [...byRow.entries()].sort((a, b) => a[0] - b[0])) {
    const label = ALL_SOUNDS[trackSounds[usedRows[r]]].name;
    report += `  ${label}: beats ${cols.sort((a, b) => a - b).map((c) => c + 1).join(", ")}\n`;
  }

  // Highlight givens
  for (const [solR, solC] of givens) {
    const gridR = usedRows[solR];
    if (cellEls[gridR]?.[solC]) {
      cellEls[gridR][solC].style.outline = "2px solid #ffaa00";
      cellEls[gridR][solC].style.outlineOffset = "-2px";
    }
  }

  exportOutput.textContent = report;
  statusEl.textContent = `Solvable! ${givens.length} given cells needed (highlighted in orange)`;
});

// --- Export ---
function computeClues(line: boolean[]): number[] {
  const clues: number[] = [];
  let run = 0;
  for (const cell of line) {
    if (cell) run++; else if (run > 0) { clues.push(run); run = 0; }
  }
  if (run > 0) clues.push(run);
  return clues;
}

document.getElementById("btn-export")!.addEventListener("click", () => {
  const usedRows: number[] = [];
  for (let r = 0; r < grid.length; r++) {
    if (grid[r]?.some(Boolean)) usedRows.push(r);
  }
  if (usedRows.length === 0) {
    statusEl.textContent = "Place some hits first!";
    return;
  }

  const names = usedRows.map((i) => ALL_SOUNDS[trackSounds[i]].name);
  const solution = usedRows.map((i) => grid[i]);
  const filled = solution.flat().filter(Boolean).length;

  const rowClues = solution.map((row) => computeClues(row));
  const colClues: number[][] = [];
  for (let c = 0; c < steps; c++) {
    colClues.push(computeClues(solution.map((row) => row[c])));
  }

  exportOutput.style.display = "block";
  exportOutput.textContent =
    `// Drum pattern\n` +
    `// ${names.length} sounds × ${steps} steps (${steps / 4} bars), ${filled} hits\n` +
    `// BPM: ${bpm}, Swing: ${swing}%\n` +
    `// Sounds: ${names.join(", ")}\n` +
    `// Row clues: ${rowClues.map((c) => `[${c.join(",")}]`).join(", ")}\n` +
    `// Col clues: ${colClues.map((c) => `[${c.join(",")}]`).join(", ")}\n\n` +
    JSON.stringify({
      bpm, swing, steps,
      tracks: usedRows.map((i) => ({ sound: ALL_SOUNDS[trackSounds[i]].name, pattern: grid[i] })),
    }, null, 2);

  statusEl.textContent = `Exported: ${names.length} sounds × ${steps} steps, ${filled} hits`;
});

// --- MIDI Import ---
// GM drum names for display (MIDI note -> human-readable name)
const GM_DRUM_NAMES: Record<number, string> = {
  27: "High Q", 28: "Slap", 29: "Scratch Push", 30: "Scratch Pull",
  31: "Sticks", 32: "Square Click", 33: "Metronome Click", 34: "Metronome Bell",
  35: "Acoustic Bass Drum", 36: "Bass Drum 1", 37: "Side Stick", 38: "Acoustic Snare",
  39: "Hand Clap", 40: "Electric Snare", 41: "Low Floor Tom", 42: "Closed Hi-Hat",
  43: "High Floor Tom", 44: "Pedal Hi-Hat", 45: "Low Tom", 46: "Open Hi-Hat",
  47: "Low-Mid Tom", 48: "Hi-Mid Tom", 49: "Crash Cymbal 1", 50: "High Tom",
  51: "Ride Cymbal 1", 52: "Chinese Cymbal", 53: "Ride Bell", 54: "Tambourine",
  55: "Splash Cymbal", 56: "Cowbell", 57: "Crash Cymbal 2", 58: "Vibraslap",
  59: "Ride Cymbal 2", 60: "Hi Bongo", 61: "Low Bongo", 62: "Mute Hi Conga",
  63: "Open Hi Conga", 64: "Low Conga", 65: "High Timbale", 66: "Low Timbale",
  67: "High Agogo", 68: "Low Agogo", 69: "Cabasa", 70: "Maracas",
  71: "Short Whistle", 72: "Long Whistle", 73: "Short Guiro", 74: "Long Guiro",
  75: "Claves", 76: "Hi Wood Block", 77: "Low Wood Block", 78: "Mute Cuica",
  79: "Open Cuica", 80: "Mute Triangle", 81: "Open Triangle",
};

// Best-match mapping from GM drum type to our sounds
const GM_SOUND_MAP: Record<number, string> = {
  35: "808 Kick", 36: "808 Kick",
  37: "808 Rim", 38: "808 Snare", 39: "808 Clap", 40: "Break Snare",
  41: "808 Lo Tom", 42: "808 Closed Hat", 43: "808 Lo Tom", 44: "808 Closed Hat",
  45: "808 Hi Tom", 46: "808 Open Hat", 47: "808 Lo Tom", 48: "808 Hi Tom",
  49: "808 Crash", 50: "808 Hi Tom", 51: "BB Ride", 52: "808 Crash",
  53: "BB Ride", 54: "808 Rim", 55: "808 Crash", 56: "808 Rim",
  57: "808 Crash", 58: "808 Rim", 59: "BB Ride",
  60: "808 Hi Tom", 61: "808 Lo Tom", 62: "808 Hi Tom", 63: "808 Hi Tom",
  64: "808 Lo Tom", 65: "808 Hi Tom", 66: "808 Lo Tom",
  67: "808 Rim", 68: "808 Rim", 69: "808 Closed Hat", 70: "808 Closed Hat",
  75: "808 Rim", 76: "808 Rim", 77: "808 Rim",
  80: "808 Open Hat", 81: "808 Open Hat",
};

function findSoundIndex(name: string): number {
  const idx = ALL_SOUNDS.findIndex((s) => s.name === name);
  return idx >= 0 ? idx : 0;
}

async function handleMidiFile(file: File) {
  statusEl.textContent = `Importing ${file.name}...`;
  try {
    const buffer = await file.arrayBuffer();
    const midi = new Midi(buffer);
    importDrumMidi(midi);
  } catch (err: any) {
    statusEl.textContent = `MIDI error: ${err.message || err}`;
  }
}

function importDrumMidi(midi: Midi) {
  if (midi.header.tempos.length > 0) {
    bpm = Math.round(midi.header.tempos[0].bpm);
    (document.getElementById("cfg-bpm") as HTMLInputElement).value = String(bpm);
  }

  const secPerStep = (60 / bpm) / 4;

  // Collect ALL notes from ALL tracks
  const allNotes: { midi: number; time: number; channel: number }[] = [];
  for (const track of midi.tracks) {
    for (const note of track.notes) {
      allNotes.push({ midi: note.midi, time: note.time, channel: note.midi });
    }
  }

  if (allNotes.length === 0) {
    statusEl.textContent = "No notes found in MIDI file";
    return;
  }

  // Group notes by MIDI note number — each unique note number becomes a track
  const noteGroups = new Map<number, { midi: number; time: number }[]>();
  for (const note of allNotes) {
    if (!noteGroups.has(note.midi)) noteGroups.set(note.midi, []);
    noteGroups.get(note.midi)!.push(note);
  }

  // Sort groups by MIDI note (low to high)
  const sortedNotes = [...noteGroups.keys()].sort((a, b) => a - b);

  // Determine steps needed
  const maxTime = Math.max(...allNotes.map((n) => n.time));
  const neededSteps = Math.ceil(maxTime / secPerStep) + 1;
  steps = Math.min(128, Math.max(4, Math.ceil(neededSteps / 4) * 4));
  (document.getElementById("cfg-steps") as HTMLSelectElement).value = String(steps);

  // Create one track per unique MIDI note
  trackSounds = sortedNotes.map((midiNote) => {
    const soundName = GM_SOUND_MAP[midiNote];
    return soundName ? findSoundIndex(soundName) : findSoundIndex("808 Kick");
  });
  grid = trackSounds.map(() => Array(steps).fill(false));

  // Place notes
  let placed = 0;
  sortedNotes.forEach((midiNote, trackIdx) => {
    const notes = noteGroups.get(midiNote)!;
    for (const note of notes) {
      const step = Math.round(note.time / secPerStep);
      if (step >= 0 && step < steps) {
        grid[trackIdx][step] = true;
        placed++;
      }
    }
  });

  // Build a readable summary of the mapping
  const mapping = sortedNotes.map((midiNote, i) => {
    const gmName = GM_DRUM_NAMES[midiNote] || `Note ${midiNote}`;
    const assignedSound = ALL_SOUNDS[trackSounds[i]].name;
    const hitCount = noteGroups.get(midiNote)!.length;
    return `  MIDI ${midiNote} (${gmName}) → ${assignedSound} [${hitCount} hits]`;
  });

  loadAllTrackSamples();
  renderSequencer();
  statusEl.textContent = `Imported ${allNotes.length} hits across ${sortedNotes.length} tracks. Change sounds with the dropdowns.`;

  // Show mapping in export area so user can see what happened
  exportOutput.style.display = "block";
  exportOutput.textContent = `MIDI Import Mapping:\n${mapping.join("\n")}\n\nChange any track's sound using the dropdown to the left of the grid.`;
}

// MIDI drag and drop
midiDrop.addEventListener("dragover", (e) => {
  e.preventDefault();
  midiDrop.classList.add("dragover");
});
midiDrop.addEventListener("dragleave", () => midiDrop.classList.remove("dragover"));
midiDrop.addEventListener("drop", (e) => {
  e.preventDefault();
  midiDrop.classList.remove("dragover");
  const file = e.dataTransfer?.files[0];
  if (file) handleMidiFile(file);
});
document.getElementById("midi-file")!.addEventListener("change", (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) handleMidiFile(file);
});

// --- Init ---
loadAllTrackSamples();
renderSequencer();
