import * as Tone from "tone";

let sampler: Tone.Sampler | null = null;
let fallbackSynth: Tone.PolySynth | null = null;
let audioStarted = false;
let ready = false;
let useFallback = false;

const SAMPLE_BASE = import.meta.env.BASE_URL + "samples/piano/";

const SAMPLE_MAP: Record<string, string> = {
  C3: "C3.mp3",
  "D#3": "Ds3.mp3",
  "F#3": "Fs3.mp3",
  A3: "A3.mp3",
  C4: "C4.mp3",
  "D#4": "Ds4.mp3",
  "F#4": "Fs4.mp3",
  A4: "A4.mp3",
  C5: "C5.mp3",
  "D#5": "Ds5.mp3",
  "F#5": "Fs5.mp3",
};

function getFallbackSynth(): Tone.PolySynth {
  if (!fallbackSynth) {
    fallbackSynth = new Tone.PolySynth(Tone.Synth, {
      maxPolyphony: 16,
      voice: Tone.Synth,
      options: {
        oscillator: { type: "triangle" },
        envelope: { attack: 0.01, decay: 0.3, sustain: 0.2, release: 0.8 },
      },
    }).toDestination();
  }
  return fallbackSynth;
}

export function isSamplerReady(): boolean {
  return ready;
}

export function loadPiano(): Promise<void> {
  return new Promise((resolve) => {
    if (ready) {
      resolve();
      return;
    }

    // Timeout: if samples don't load in 8 seconds, fall back to synth
    const timeout = setTimeout(() => {
      console.warn("Piano samples timed out, using synth fallback");
      useFallback = true;
      ready = true;
      resolve();
    }, 8000);

    try {
      sampler = new Tone.Sampler({
        urls: SAMPLE_MAP,
        baseUrl: SAMPLE_BASE,
        release: 1.5,
        onload: () => {
          clearTimeout(timeout);
          useFallback = false;
          ready = true;
          console.log("Piano samples loaded");
          resolve();
        },
      }).toDestination();
    } catch (e) {
      clearTimeout(timeout);
      console.warn("Failed to create sampler, using synth fallback", e);
      useFallback = true;
      ready = true;
      resolve();
    }
  });
}

export async function ensureAudio(bpm: number): Promise<void> {
  if (!audioStarted) {
    await Tone.start();
    audioStarted = true;
  }
  Tone.getTransport().bpm.value = bpm;
  // If piano hasn't loaded yet, ensure fallback is ready
  if (!ready) {
    useFallback = true;
    ready = true;
  }
}

export function playNote(note: string): void {
  if (!ready) return;
  if (!useFallback && sampler?.loaded) {
    sampler.triggerAttackRelease(note, "8n");
  } else {
    getFallbackSynth().triggerAttackRelease(note, "8n");
  }
}

export function getTransport(): typeof Tone.Transport {
  return Tone.getTransport();
}

export function scheduleNote(
  note: string,
  startTime: number,
  duration: number
): void {
  if (!useFallback && sampler?.loaded) {
    Tone.getTransport().schedule((time) => {
      sampler!.triggerAttackRelease(note, duration, time);
    }, startTime);
  } else {
    const synth = getFallbackSynth();
    Tone.getTransport().schedule((time) => {
      synth.triggerAttackRelease(note, duration, time);
    }, startTime);
  }
}
