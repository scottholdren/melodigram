export interface DrumSound {
  name: string;
  category: string;
  url: string;
  color: string;
}

const BASE = import.meta.env.BASE_URL + "samples/";

export const ALL_SOUNDS: DrumSound[] = [
  // 808 / Trap
  { name: "808 Kick",       category: "808 / Trap", url: BASE + "808/kick.wav",      color: "#ff3355" },
  { name: "808 Snare",      category: "808 / Trap", url: BASE + "808/snare.wav",     color: "#ff8833" },
  { name: "808 Clap",       category: "808 / Trap", url: BASE + "808/clap.wav",      color: "#ffdd33" },
  { name: "808 Closed Hat",  category: "808 / Trap", url: BASE + "808/closedhat.wav", color: "#33dd77" },
  { name: "808 Open Hat",   category: "808 / Trap", url: BASE + "808/openhat.wav",   color: "#33ccff" },
  { name: "808 Rim",        category: "808 / Trap", url: BASE + "808/rim.mp3",       color: "#5566ff" },
  { name: "808 Hi Tom",     category: "808 / Trap", url: BASE + "808/hitom.wav",     color: "#aa44ff" },
  { name: "808 Lo Tom",     category: "808 / Trap", url: BASE + "808/lotom.wav",     color: "#ff44aa" },
  { name: "808 Crash",      category: "808 / Trap", url: BASE + "808/crash.wav",     color: "#44ffaa" },
  // Boom Bap
  { name: "Punchy Kick",    category: "Boom Bap",   url: BASE + "boombap/kick.mp3",    color: "#ff3355" },
  { name: "Break Snare",    category: "Boom Bap",   url: BASE + "boombap/snare.mp3",   color: "#ff8833" },
  { name: "BB Clap",        category: "Boom Bap",   url: BASE + "boombap/clap.wav",    color: "#ffdd33" },
  { name: "LINN Hat",       category: "Boom Bap",   url: BASE + "boombap/hihat.mp3",   color: "#33dd77" },
  { name: "BB Open Hat",    category: "Boom Bap",   url: BASE + "boombap/openhat.wav",  color: "#33ccff" },
  { name: "BB Snare",       category: "Boom Bap",   url: BASE + "boombap/snare2.wav",  color: "#5566ff" },
  { name: "LINN Kick",      category: "Boom Bap",   url: BASE + "boombap/kick2.mp3",   color: "#aa44ff" },
  { name: "BB Tom",         category: "Boom Bap",   url: BASE + "boombap/tom.wav",     color: "#ff44aa" },
  { name: "BB Ride",        category: "Boom Bap",   url: BASE + "boombap/ride.wav",    color: "#44ffaa" },
];
