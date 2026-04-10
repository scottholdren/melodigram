import * as Tone from "tone";

// --- All available sounds (both kits merged) ---
interface Sound {
  name: string;
  category: string; // "808" or "Boom Bap"
  url: string;
  color: string;
}

const ALL_SOUNDS: Sound[] = [
  // 808 / Trap
  { name: "808 Kick", category: "808", url: "https://raw.githubusercontent.com/edwardhorsey/roland-react-8/master/public/sounds/wa_808tape_kick_09_sat.wav", color: "#ff3355" },
  { name: "808 Snare", category: "808", url: "https://raw.githubusercontent.com/TechSavyElectronics/Roland-TR-808/main/SnareDrum.WAV", color: "#ff8833" },
  { name: "808 Clap", category: "808", url: "https://raw.githubusercontent.com/edwardhorsey/roland-react-8/master/public/sounds/wa_808tape_clap_01_sat.wav", color: "#ffdd33" },
  { name: "808 Closed Hat", category: "808", url: "https://raw.githubusercontent.com/edwardhorsey/roland-react-8/master/public/sounds/wa_808tape_closedhat_09_sat.wav", color: "#33dd77" },
  { name: "808 Open Hat", category: "808", url: "https://raw.githubusercontent.com/edwardhorsey/roland-react-8/master/public/sounds/wa_808tape_openhat_02_sat.wav", color: "#33ccff" },
  { name: "808 Rim", category: "808", url: "https://s3.amazonaws.com/freecodecamp/drums/side_stick_1.mp3", color: "#5566ff" },
  { name: "808 Hi Tom", category: "808", url: "https://raw.githubusercontent.com/edwardhorsey/roland-react-8/master/public/sounds/wa_808tape_hitom_01_sat.wav", color: "#aa44ff" },
  { name: "808 Lo Tom", category: "808", url: "https://raw.githubusercontent.com/edwardhorsey/roland-react-8/master/public/sounds/wa_808tape_lotom_01_sat.wav", color: "#ff44aa" },
  { name: "808 Crash", category: "808", url: "https://raw.githubusercontent.com/edwardhorsey/roland-react-8/master/public/sounds/wa_808tape_crash_02_sat.wav", color: "#44ffaa" },
  // Boom Bap
  { name: "Punchy Kick", category: "Boom Bap", url: "https://s3.amazonaws.com/freecodecamp/drums/punchy_kick_1.mp3", color: "#ff3355" },
  { name: "Break Snare", category: "Boom Bap", url: "https://s3.amazonaws.com/freecodecamp/drums/Brk_Snr.mp3", color: "#ff8833" },
  { name: "BB Clap", category: "Boom Bap", url: "https://raw.githubusercontent.com/wesbos/JavaScript30/master/01%20-%20JavaScript%20Drum%20Kit/sounds/clap.wav", color: "#ffdd33" },
  { name: "LINN Hat", category: "Boom Bap", url: "https://raw.githubusercontent.com/Tonejs/audio/master/drum-samples/LINN/hihat.mp3", color: "#33dd77" },
  { name: "BB Open Hat", category: "Boom Bap", url: "https://raw.githubusercontent.com/wesbos/JavaScript30/master/01%20-%20JavaScript%20Drum%20Kit/sounds/openhat.wav", color: "#33ccff" },
  { name: "BB Snare", category: "Boom Bap", url: "https://raw.githubusercontent.com/wesbos/JavaScript30/master/01%20-%20JavaScript%20Drum%20Kit/sounds/snare.wav", color: "#5566ff" },
  { name: "LINN Kick", category: "Boom Bap", url: "https://raw.githubusercontent.com/Tonejs/audio/master/drum-samples/LINN/kick.mp3", color: "#aa44ff" },
  { name: "BB Tom", category: "Boom Bap", url: "https://raw.githubusercontent.com/wesbos/JavaScript30/master/01%20-%20JavaScript%20Drum%20Kit/sounds/tom.wav", color: "#ff44aa" },
  { name: "BB Ride", category: "Boom Bap", url: "https://raw.githubusercontent.com/wesbos/JavaScript30/master/01%20-%20JavaScript%20Drum%20Kit/sounds/ride.wav", color: "#44ffaa" },
];

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
  <button id="btn-export" class="primary">Export</button>
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
  const categories = ["808", "Boom Bap"];
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

// --- Init ---
loadAllTrackSamples();
renderSequencer();
