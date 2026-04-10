import * as Tone from "tone";
import { ALL_SOUNDS } from "./drum-sounds";

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
