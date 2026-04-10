import * as Tone from "tone";

// --- Drum kits ---
interface DrumSound {
  name: string;
  url: string;
  color: string;
  short?: boolean; // true = one-shot, don't sustain
}

interface DrumKit {
  id: string;
  name: string;
  sounds: DrumSound[];
}

const TRAP_KIT: DrumKit = {
  id: "trap",
  name: "808 / Trap",
  sounds: [
    { name: "808 Kick", url: "https://raw.githubusercontent.com/edwardhorsey/roland-react-8/master/public/sounds/wa_808tape_kick_09_sat.wav", color: "#ff3355" },
    { name: "808 Snare", url: "https://raw.githubusercontent.com/TechSavyElectronics/Roland-TR-808/main/SnareDrum.WAV", color: "#ff8833" },
    { name: "Clap", url: "https://raw.githubusercontent.com/edwardhorsey/roland-react-8/master/public/sounds/wa_808tape_clap_01_sat.wav", color: "#ffdd33" },
    { name: "Closed Hat", url: "https://raw.githubusercontent.com/edwardhorsey/roland-react-8/master/public/sounds/wa_808tape_closedhat_09_sat.wav", color: "#33dd77", short: true },
    { name: "Open Hat", url: "https://raw.githubusercontent.com/edwardhorsey/roland-react-8/master/public/sounds/wa_808tape_openhat_02_sat.wav", color: "#33ccff" },
    { name: "Rim", url: "https://s3.amazonaws.com/freecodecamp/drums/side_stick_1.mp3", color: "#5566ff", short: true },
    { name: "Hi Tom", url: "https://raw.githubusercontent.com/edwardhorsey/roland-react-8/master/public/sounds/wa_808tape_hitom_01_sat.wav", color: "#aa44ff" },
    { name: "Lo Tom", url: "https://raw.githubusercontent.com/edwardhorsey/roland-react-8/master/public/sounds/wa_808tape_lotom_01_sat.wav", color: "#ff44aa" },
    { name: "Crash", url: "https://raw.githubusercontent.com/edwardhorsey/roland-react-8/master/public/sounds/wa_808tape_crash_02_sat.wav", color: "#44ffaa" },
  ],
};

const BOOMBAP_KIT: DrumKit = {
  id: "boombap",
  name: "Boom Bap",
  sounds: [
    { name: "Punchy Kick", url: "https://s3.amazonaws.com/freecodecamp/drums/punchy_kick_1.mp3", color: "#ff3355" },
    { name: "Break Snare", url: "https://s3.amazonaws.com/freecodecamp/drums/Brk_Snr.mp3", color: "#ff8833" },
    { name: "Clap", url: "https://raw.githubusercontent.com/wesbos/JavaScript30/master/01%20-%20JavaScript%20Drum%20Kit/sounds/clap.wav", color: "#ffdd33" },
    { name: "Hi-Hat", url: "https://raw.githubusercontent.com/Tonejs/audio/master/drum-samples/LINN/hihat.mp3", color: "#33dd77", short: true },
    { name: "Open Hat", url: "https://raw.githubusercontent.com/wesbos/JavaScript30/master/01%20-%20JavaScript%20Drum%20Kit/sounds/openhat.wav", color: "#33ccff" },
    { name: "Snare 2", url: "https://raw.githubusercontent.com/wesbos/JavaScript30/master/01%20-%20JavaScript%20Drum%20Kit/sounds/snare.wav", color: "#5566ff" },
    { name: "Kick 2", url: "https://raw.githubusercontent.com/Tonejs/audio/master/drum-samples/LINN/kick.mp3", color: "#aa44ff" },
    { name: "Tom", url: "https://raw.githubusercontent.com/wesbos/JavaScript30/master/01%20-%20JavaScript%20Drum%20Kit/sounds/tom.wav", color: "#ff44aa" },
    { name: "Ride", url: "https://raw.githubusercontent.com/wesbos/JavaScript30/master/01%20-%20JavaScript%20Drum%20Kit/sounds/ride.wav", color: "#44ffaa" },
  ],
};

const KITS = [TRAP_KIT, BOOMBAP_KIT];

// --- State ---
let currentKit = TRAP_KIT;
let steps = 16;
let bpm = 140;
let swing = 0; // 0-100
let grid: boolean[][] = [];
let players: Tone.Player[] = [];
let isPlaying = false;
let looping = false;
let loadedCount = 0;
let totalToLoad = 0;
let cellEls: HTMLDivElement[][] = [];

// --- DOM ---
const app = document.getElementById("app")!;

// Header
const header = document.createElement("div");
header.className = "header";
header.innerHTML = `<h1>Drum Machine</h1><div class="header-links"><a href="workshop.html">Workshop</a><a href="index.html">Game</a></div>`;
app.appendChild(header);

// Kit tabs
const kitTabs = document.createElement("div");
kitTabs.className = "kit-tabs";
app.appendChild(kitTabs);

function renderKitTabs() {
  kitTabs.innerHTML = "";
  for (const kit of KITS) {
    const tab = document.createElement("button");
    tab.className = `kit-tab ${kit.id === currentKit.id ? "active" : ""}`;
    tab.textContent = kit.name;
    tab.addEventListener("click", () => switchKit(kit));
    kitTabs.appendChild(tab);
  }
}

// Config
const config = document.createElement("div");
config.className = "config";
config.innerHTML = `
  <div class="config-group">
    <label>BPM</label>
    <input type="number" id="cfg-bpm" value="140" min="60" max="300">
  </div>
  <div class="config-group">
    <label>Steps</label>
    <select id="cfg-steps">
      <option value="8">8</option>
      <option value="16" selected>16</option>
      <option value="32">32</option>
      <option value="64">64</option>
    </select>
  </div>
  <div class="config-group">
    <label>Swing</label>
    <input type="range" id="cfg-swing" min="0" max="80" value="0" style="width:100px">
    <span id="swing-val" style="font-size:0.7rem;color:#666">0%</span>
  </div>
`;
app.appendChild(config);

// Loading status
const loadStatus = document.createElement("p");
loadStatus.className = "load-status";
loadStatus.textContent = "Loading samples...";
app.appendChild(loadStatus);

// Sequencer
const seqWrap = document.createElement("div");
seqWrap.className = "seq-wrap";
app.appendChild(seqWrap);

// Controls
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

// --- Load samples ---
async function loadKit(kit: DrumKit) {
  // Dispose old players
  for (const p of players) p.dispose();
  players = [];
  loadedCount = 0;
  totalToLoad = kit.sounds.length;
  loadStatus.textContent = `Loading ${kit.name}... 0/${totalToLoad}`;
  loadStatus.style.display = "block";

  const newPlayers: Tone.Player[] = [];

  for (let i = 0; i < kit.sounds.length; i++) {
    const sound = kit.sounds[i];
    const player = new Tone.Player({
      url: sound.url,
      onload: () => {
        loadedCount++;
        loadStatus.textContent = `Loading ${kit.name}... ${loadedCount}/${totalToLoad}`;
        if (loadedCount >= totalToLoad) {
          loadStatus.style.display = "none";
        }
      },
      onerror: () => {
        loadedCount++;
        console.warn(`Failed to load: ${sound.name}`);
        if (loadedCount >= totalToLoad) {
          loadStatus.style.display = "none";
        }
      },
    }).toDestination();
    newPlayers.push(player);
  }

  players = newPlayers;
}

function switchKit(kit: DrumKit) {
  if (isPlaying) stopPlayback();
  currentKit = kit;
  grid = currentKit.sounds.map(() => Array(steps).fill(false));
  renderKitTabs();
  loadKit(kit);
  renderSequencer();
}

// --- Render sequencer ---
function renderSequencer() {
  seqWrap.innerHTML = "";
  cellEls = [];

  const table = document.createElement("div");
  table.className = "seq-table";

  // Beat numbers
  const beatRow = document.createElement("div");
  beatRow.className = "seq-row beat-header";
  const labelSpacer = document.createElement("div");
  labelSpacer.className = "sound-label";
  beatRow.appendChild(labelSpacer);
  for (let c = 0; c < steps; c++) {
    const num = document.createElement("div");
    num.className = "seq-cell beat-num";
    num.textContent = c % 4 === 0 ? `${Math.floor(c / 4) + 1}` : "";
    beatRow.appendChild(num);
  }
  table.appendChild(beatRow);

  // Sound rows
  for (let r = 0; r < currentKit.sounds.length; r++) {
    cellEls[r] = [];
    const sound = currentKit.sounds[r];
    const row = document.createElement("div");
    row.className = "seq-row";

    // Label (clickable to preview)
    const label = document.createElement("div");
    label.className = "sound-label";
    label.innerHTML = `<span class="sound-dot" style="background:${sound.color}"></span>${sound.name}`;
    label.addEventListener("click", async () => {
      await Tone.start();
      if (players[r]?.loaded) {
        players[r].stop();
        players[r].start();
      }
    });
    row.appendChild(label);

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

      const ri = r, ci = c;
      cell.addEventListener("click", async () => {
        await Tone.start();
        if (!grid[ri]) grid[ri] = Array(steps).fill(false);
        grid[ri][ci] = !grid[ri][ci];
        if (grid[ri][ci]) {
          cell.classList.add("active");
          cell.style.background = currentKit.sounds[ri].color + "66";
          cell.style.boxShadow = `inset 0 0 8px ${currentKit.sounds[ri].color}44`;
          if (players[ri]?.loaded) {
            players[ri].stop();
            players[ri].start();
          }
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

// --- Config handlers ---
document.getElementById("cfg-bpm")!.addEventListener("change", (e) => {
  bpm = Math.max(60, Math.min(300, parseInt((e.target as HTMLInputElement).value) || 140));
});

document.getElementById("cfg-steps")!.addEventListener("change", (e) => {
  const newSteps = parseInt((e.target as HTMLSelectElement).value);
  const oldSteps = steps;
  steps = newSteps;
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

// --- Playback ---
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function playOnce() {
  if (isPlaying) return;
  await Tone.start();
  isPlaying = true;

  const secPerStep = (60 / bpm) / 4; // 16th note grid
  const swingAmount = (swing / 100) * secPerStep * 0.7;

  for (let col = 0; col < steps; col++) {
    if (!isPlaying) break;

    // Swing: delay odd-numbered steps
    const isSwung = col % 2 === 1;
    const stepDelay = isSwung ? swingAmount : 0;

    // Highlight column
    for (let r = 0; r < currentKit.sounds.length; r++) {
      if (cellEls[r]?.[col]) cellEls[r][col].classList.add("playhead");
    }

    // Play sounds
    for (let r = 0; r < currentKit.sounds.length; r++) {
      if (grid[r]?.[col] && players[r]?.loaded) {
        players[r].stop();
        players[r].start(Tone.now() + stepDelay);
      }
    }

    await sleep(secPerStep * 1000);

    // Remove highlight
    for (let r = 0; r < currentKit.sounds.length; r++) {
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
  for (const p of players) p.stop();
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
  grid = currentKit.sounds.map(() => Array(steps).fill(false));
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

  const names = usedRows.map((i) => currentKit.sounds[i].name);
  const solution = usedRows.map((i) => grid[i]);
  const filled = solution.flat().filter(Boolean).length;

  const rowClues = solution.map((row) => computeClues(row));
  const colClues: number[][] = [];
  for (let c = 0; c < steps; c++) {
    colClues.push(computeClues(solution.map((row) => row[c])));
  }

  exportOutput.style.display = "block";
  exportOutput.textContent =
    `// Drum pattern: ${currentKit.name}\n` +
    `// ${names.length} sounds × ${steps} steps, ${filled} hits\n` +
    `// Sounds: ${names.join(", ")}\n` +
    `// BPM: ${bpm}, Swing: ${swing}%\n` +
    `// Row clues: ${rowClues.map((c) => `[${c.join(",")}]`).join(", ")}\n` +
    `// Col clues: ${colClues.map((c) => `[${c.join(",")}]`).join(", ")}\n\n` +
    JSON.stringify({ kit: currentKit.id, bpm, swing, steps, sounds: names, solution }, null, 2);

  statusEl.textContent = `Exported: ${names.length} sounds × ${steps} steps, ${filled} hits`;
});

// --- Init ---
renderKitTabs();
grid = currentKit.sounds.map(() => Array(steps).fill(false));
loadKit(currentKit);
renderSequencer();
