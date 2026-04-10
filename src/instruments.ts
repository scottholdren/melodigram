/**
 * Instrument registry. Each instrument can play a pitch or a drum hit.
 *
 * Piano: Salamander Grand Piano samples (real)
 * Drums: 808/Boom Bap samples (real, loaded on demand)
 * Others: Tone.js synths tuned to approximate the GM family
 *
 * GM program number → instrument family → our instrument key.
 */

import * as Tone from "tone";
import { loadPiano, ensureAudio as ensureAudioBase, playNote as playPianoNote, scheduleNote as schedulePianoNote, getTransport } from "./audio";
import { ALL_SOUNDS, type DrumSound } from "./drum-sounds";

export type InstrumentKey =
  | "piano"
  | "drums"
  | "synth-bass"
  | "synth-pad"
  | "synth-pluck"
  | "synth-organ"
  | "synth-lead"
  | "synth-brass"
  | "synth-strings"
  | "synth-choir";

export const INSTRUMENT_LABELS: Record<InstrumentKey, string> = {
  piano: "Piano",
  drums: "Drums",
  "synth-bass": "Bass",
  "synth-pad": "Pad",
  "synth-pluck": "Pluck / Guitar",
  "synth-organ": "Organ",
  "synth-lead": "Lead",
  "synth-brass": "Brass",
  "synth-strings": "Strings",
  "synth-choir": "Choir",
};

// --- Synth cache (lazy-built) ---
const synthCache = new Map<InstrumentKey, Tone.PolySynth>();

function buildSynth(key: InstrumentKey): Tone.PolySynth {
  if (synthCache.has(key)) return synthCache.get(key)!;

  let synth: Tone.PolySynth;
  switch (key) {
    case "synth-bass":
      synth = new Tone.PolySynth(Tone.Synth, {
        maxPolyphony: 8,
        voice: Tone.Synth,
        options: {
          oscillator: { type: "sawtooth" },
          envelope: { attack: 0.02, decay: 0.2, sustain: 0.6, release: 0.3 },
        },
      });
      break;
    case "synth-pad":
      synth = new Tone.PolySynth(Tone.Synth, {
        maxPolyphony: 16,
        voice: Tone.Synth,
        options: {
          oscillator: { type: "sine" },
          envelope: { attack: 0.4, decay: 0.5, sustain: 0.8, release: 2.0 },
        },
      });
      break;
    case "synth-pluck":
      synth = new Tone.PolySynth(Tone.Synth, {
        maxPolyphony: 16,
        voice: Tone.Synth,
        options: {
          oscillator: { type: "triangle" },
          envelope: { attack: 0.002, decay: 0.3, sustain: 0.0, release: 0.4 },
        },
      });
      break;
    case "synth-organ":
      synth = new Tone.PolySynth(Tone.Synth, {
        maxPolyphony: 16,
        voice: Tone.Synth,
        options: {
          oscillator: { type: "square" },
          envelope: { attack: 0.05, decay: 0.1, sustain: 0.85, release: 0.2 },
        },
      });
      break;
    case "synth-lead":
      synth = new Tone.PolySynth(Tone.Synth, {
        maxPolyphony: 8,
        voice: Tone.Synth,
        options: {
          oscillator: { type: "sawtooth" },
          envelope: { attack: 0.01, decay: 0.2, sustain: 0.5, release: 0.4 },
        },
      });
      break;
    case "synth-brass":
      synth = new Tone.PolySynth(Tone.FMSynth, {
        maxPolyphony: 8,
        voice: Tone.FMSynth,
        options: {
          modulationIndex: 5,
          envelope: { attack: 0.05, decay: 0.3, sustain: 0.6, release: 0.5 },
        },
      });
      break;
    case "synth-strings":
      synth = new Tone.PolySynth(Tone.Synth, {
        maxPolyphony: 16,
        voice: Tone.Synth,
        options: {
          oscillator: { type: "sawtooth" },
          envelope: { attack: 0.25, decay: 0.4, sustain: 0.7, release: 1.2 },
        },
      });
      break;
    case "synth-choir":
      synth = new Tone.PolySynth(Tone.AMSynth, {
        maxPolyphony: 16,
        voice: Tone.AMSynth,
        options: {
          envelope: { attack: 0.3, decay: 0.4, sustain: 0.8, release: 1.5 },
        },
      });
      break;
    default:
      synth = new Tone.PolySynth(Tone.Synth);
  }

  // Connect with a modest volume reduction so synths don't overpower piano
  const gain = new Tone.Gain(0.35).toDestination();
  synth.connect(gain);

  synthCache.set(key, synth);
  return synth;
}

// --- Drum player cache ---
const drumPlayers = new Map<string, Tone.Player>();

function loadDrumSampleByName(name: string): Promise<Tone.Player | null> {
  const sound = ALL_SOUNDS.find((s) => s.name === name);
  if (!sound) return Promise.resolve(null);
  if (drumPlayers.has(sound.url)) return Promise.resolve(drumPlayers.get(sound.url)!);
  return new Promise((resolve) => {
    const p = new Tone.Player({
      url: sound.url,
      onload: () => { drumPlayers.set(sound.url, p); resolve(p); },
      onerror: () => { resolve(p); },
    }).toDestination();
  });
}

function getDrumSound(name: string): DrumSound | undefined {
  return ALL_SOUNDS.find((s) => s.name === name);
}

// --- Public API ---

export async function ensureAudio(bpm: number): Promise<void> {
  await ensureAudioBase(bpm);
}

/** Pre-load samples for all instruments used in a list of rows. */
export async function preloadInstruments(keys: InstrumentKey[], drumNames: string[] = []): Promise<void> {
  const tasks: Promise<any>[] = [];
  if (keys.includes("piano")) tasks.push(loadPiano());
  for (const name of drumNames) tasks.push(loadDrumSampleByName(name));
  // Synths are lazy-built on first use; no preload
  await Promise.all(tasks);
}

/** Play a single hit for a row at the current time. */
export function playRow(key: InstrumentKey, spec: { pitch?: string; drumSound?: string }): void {
  if (key === "piano" && spec.pitch) {
    playPianoNote(spec.pitch);
    return;
  }
  if (key === "drums" && spec.drumSound) {
    const sound = getDrumSound(spec.drumSound);
    if (!sound) return;
    const player = drumPlayers.get(sound.url);
    if (player?.loaded) { player.stop(); player.start(); }
    return;
  }
  if (spec.pitch) {
    const synth = buildSynth(key);
    synth.triggerAttackRelease(spec.pitch, "8n");
  }
}

/** Schedule a hit on the transport at startTime seconds. */
export function scheduleRow(
  key: InstrumentKey,
  spec: { pitch?: string; drumSound?: string },
  startTime: number,
  duration: number
): void {
  if (key === "piano" && spec.pitch) {
    schedulePianoNote(spec.pitch, startTime, duration);
    return;
  }
  if (key === "drums" && spec.drumSound) {
    const sound = getDrumSound(spec.drumSound);
    if (!sound) return;
    const player = drumPlayers.get(sound.url);
    if (!player?.loaded) return;
    Tone.getTransport().schedule((t) => {
      player.stop(t);
      player.start(t);
    }, startTime);
    return;
  }
  if (spec.pitch) {
    const synth = buildSynth(key);
    const pitch = spec.pitch;
    Tone.getTransport().schedule((t) => {
      synth.triggerAttackRelease(pitch, duration, t);
    }, startTime);
  }
}

/** Color for a row based on its instrument + pitch/sound. */
export function getRowColor(key: InstrumentKey, spec: { pitch?: string; drumSound?: string }): string {
  if (key === "drums" && spec.drumSound) {
    const sound = getDrumSound(spec.drumSound);
    return sound?.color || "#888";
  }
  // For pitched instruments, color by note letter
  if (spec.pitch) {
    const letter = spec.pitch.replace(/[0-9#b]/g, "");
    const colors: Record<string, string> = {
      C: "#ff3355", D: "#ff8833", E: "#ffdd33",
      F: "#33dd77", G: "#33ccff", A: "#5566ff", B: "#aa44ff",
    };
    // Slightly darker for non-piano synths to hint at the different instrument
    return colors[letter] || "#888";
  }
  return "#888";
}

// --- GM program → our instrument mapping ---
/** Map a General MIDI program number (0-127) to our instrument key. */
export function gmProgramToInstrument(program: number): InstrumentKey {
  if (program <= 7) return "piano";           // piano family
  if (program <= 15) return "synth-pluck";    // chromatic percussion
  if (program <= 23) return "synth-organ";    // organ
  if (program <= 31) return "synth-pluck";    // guitar
  if (program <= 39) return "synth-bass";     // bass
  if (program <= 47) return "synth-strings";  // strings
  if (program <= 55) return "synth-strings";  // ensemble (includes choir etc.)
  if (program <= 63) return "synth-brass";    // brass
  if (program <= 71) return "synth-lead";     // reed
  if (program <= 79) return "synth-lead";     // pipe
  if (program <= 87) return "synth-lead";     // synth lead
  if (program <= 95) return "synth-pad";      // synth pad
  if (program <= 103) return "synth-pad";     // synth effects
  if (program <= 111) return "synth-pluck";   // ethnic (includes banjo)
  if (program <= 119) return "synth-pluck";   // percussive
  return "synth-lead";                         // sfx
}

/** More granular mapping for ensemble/choir distinction. */
export function gmProgramToInstrumentPrecise(program: number): InstrumentKey {
  // Special cases: choir aahs (52), voice oohs (53), synth voice (54)
  if (program === 52 || program === 53 || program === 54) return "synth-choir";
  return gmProgramToInstrument(program);
}
