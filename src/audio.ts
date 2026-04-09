import * as Tone from "tone";

let sampler: Tone.Sampler | null = null;
let audioStarted = false;
let samplerReady = false;

const SAMPLE_BASE = "https://tonejs.github.io/audio/salamander/";

// Load a subset of Salamander Grand Piano samples — Tone.js interpolates the rest
const SAMPLE_MAP: Record<string, string> = {
  C3: "C3v10.mp3",
  "D#3": "Ds3v10.mp3",
  "F#3": "Fs3v10.mp3",
  A3: "A3v10.mp3",
  C4: "C4v10.mp3",
  "D#4": "Ds4v10.mp3",
  "F#4": "Fs4v10.mp3",
  A4: "A4v10.mp3",
  C5: "C5v10.mp3",
  "D#5": "Ds5v10.mp3",
  "F#5": "Fs5v10.mp3",
};

export function isSamplerReady(): boolean {
  return samplerReady;
}

export function loadPiano(): Promise<void> {
  return new Promise((resolve) => {
    if (sampler) {
      resolve();
      return;
    }
    sampler = new Tone.Sampler({
      urls: SAMPLE_MAP,
      baseUrl: SAMPLE_BASE,
      release: 1.5,
      onload: () => {
        samplerReady = true;
        resolve();
      },
    }).toDestination();
  });
}

export async function ensureAudio(bpm: number): Promise<void> {
  if (!audioStarted) {
    await Tone.start();
    audioStarted = true;
  }
  Tone.getTransport().bpm.value = bpm;
}

export function playNote(note: string): void {
  if (!sampler || !samplerReady) return;
  sampler.triggerAttackRelease(note, "8n");
}

export function getTransport(): typeof Tone.Transport {
  return Tone.getTransport();
}

export function scheduleNote(
  note: string,
  startTime: number,
  duration: number
): void {
  if (!sampler || !samplerReady) return;
  Tone.getTransport().schedule((time) => {
    sampler!.triggerAttackRelease(note, duration, time);
  }, startTime);
}
