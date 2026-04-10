import * as Tone from "tone";

interface Sound {
  name: string;
  category: string;
  url: string;
  color: string;
}

const ALL_SOUNDS: Sound[] = [
  // 808 / Trap
  { name: "808 Kick", category: "808 / Trap", url: "https://raw.githubusercontent.com/edwardhorsey/roland-react-8/master/public/sounds/wa_808tape_kick_09_sat.wav", color: "#ff3355" },
  { name: "808 Snare", category: "808 / Trap", url: "https://raw.githubusercontent.com/TechSavyElectronics/Roland-TR-808/main/SnareDrum.WAV", color: "#ff8833" },
  { name: "808 Clap", category: "808 / Trap", url: "https://raw.githubusercontent.com/edwardhorsey/roland-react-8/master/public/sounds/wa_808tape_clap_01_sat.wav", color: "#ffdd33" },
  { name: "808 Closed Hat", category: "808 / Trap", url: "https://raw.githubusercontent.com/edwardhorsey/roland-react-8/master/public/sounds/wa_808tape_closedhat_09_sat.wav", color: "#33dd77" },
  { name: "808 Open Hat", category: "808 / Trap", url: "https://raw.githubusercontent.com/edwardhorsey/roland-react-8/master/public/sounds/wa_808tape_openhat_02_sat.wav", color: "#33ccff" },
  { name: "808 Rim", category: "808 / Trap", url: "https://s3.amazonaws.com/freecodecamp/drums/side_stick_1.mp3", color: "#5566ff" },
  { name: "808 Hi Tom", category: "808 / Trap", url: "https://raw.githubusercontent.com/edwardhorsey/roland-react-8/master/public/sounds/wa_808tape_hitom_01_sat.wav", color: "#aa44ff" },
  { name: "808 Lo Tom", category: "808 / Trap", url: "https://raw.githubusercontent.com/edwardhorsey/roland-react-8/master/public/sounds/wa_808tape_lotom_01_sat.wav", color: "#ff44aa" },
  { name: "808 Crash", category: "808 / Trap", url: "https://raw.githubusercontent.com/edwardhorsey/roland-react-8/master/public/sounds/wa_808tape_crash_02_sat.wav", color: "#44ffaa" },
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

const players: Map<string, Tone.Player> = new Map();

const app = document.getElementById("app")!;

app.innerHTML = `
  <div class="header">
    <h1>Sound Browser</h1>
    <div class="header-links">
      <a href="drums.html">Drum Machine</a>
      <a href="workshop.html">Workshop</a>
      <a href="index.html">Game</a>
    </div>
  </div>
  <p class="hint">Click any sound to hear it.</p>
`;

const categories = [...new Set(ALL_SOUNDS.map((s) => s.category))];

for (const cat of categories) {
  const section = document.createElement("div");
  section.className = "category";

  const heading = document.createElement("h2");
  heading.textContent = cat;
  section.appendChild(heading);

  const grid = document.createElement("div");
  grid.className = "sound-grid";

  const catSounds = ALL_SOUNDS.filter((s) => s.category === cat);
  for (const sound of catSounds) {
    const card = document.createElement("button");
    card.className = "sound-card";
    card.innerHTML = `<span class="dot" style="background:${sound.color}"></span><span class="name">${sound.name}</span>`;

    card.addEventListener("click", async () => {
      await Tone.start();
      card.classList.add("playing");
      setTimeout(() => card.classList.remove("playing"), 300);

      if (players.has(sound.url)) {
        const p = players.get(sound.url)!;
        if (p.loaded) { p.stop(); p.start(); }
        return;
      }

      const player = new Tone.Player({
        url: sound.url,
        onload: () => {
          players.set(sound.url, player);
          player.start();
        },
      }).toDestination();
    });

    grid.appendChild(card);
  }

  section.appendChild(grid);
  app.appendChild(section);
}
