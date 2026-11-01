/**
 * Plays the game's sounds with Web Audio. Files that don't exist yet (not generated) are
 * skipped quietly, so the game never waits on audio. Sound is on by default and the
 * choice is remembered in this browser; browsers only start audio after a tap or key.
 */
import { audioPath, type MusicId, type SfxId, type VoiceId } from "./manifest";

type Kind = "sfx" | "music" | "voice";
type Handle = { stop: () => void };

const KEY = "wgp:sound:v1";
const VOLUME: Record<Kind, number> = { sfx: 0.7, music: 0.32, voice: 1 };
/** The same effect can't stack faster than this, or a flurry turns into noise. */
const MIN_GAP_MS = 70;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let enabled: boolean | null = null;
let music: { id: MusicId; handle: Handle } | null = null;
let voice: Handle | null = null;
const buffers = new Map<string, Promise<AudioBuffer | null>>();
const lastPlayed = new Map<string, number>();
const listeners = new Set<() => void>();

export function soundEnabled(): boolean {
  if (enabled === null) {
    try {
      enabled = window.localStorage.getItem(KEY) !== "off";
    } catch {
      enabled = true;
    }
  }
  return enabled;
}

export function setSoundEnabled(on: boolean) {
  enabled = on;
  try {
    window.localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    // Not remembered, but still applied for this visit.
  }
  if (!on) {
    stopMusic();
    voice?.stop();
  }
  listeners.forEach((l) => l());
}

export function subscribeSound(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function context(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function load(kind: Kind, id: string): Promise<AudioBuffer | null> {
  const url = audioPath(kind, id);
  let pending = buffers.get(url);
  if (!pending) {
    const c = context();
    if (!c) return Promise.resolve(null);
    pending = fetch(url)
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .then((b) => (b ? c.decodeAudioData(b) : null))
      .catch(() => null);
    buffers.set(url, pending);
  }
  return pending;
}

function play(kind: Kind, id: string, opts: { volume?: number; rate?: number; loop?: boolean } = {}): Handle {
  const handle: Handle = { stop: () => {} };
  if (!soundEnabled()) return handle;
  const now = typeof performance === "undefined" ? 0 : performance.now();
  const key = `${kind}/${id}`;
  if (kind === "sfx" && now - (lastPlayed.get(key) ?? -Infinity) < MIN_GAP_MS) return handle;
  lastPlayed.set(key, now);
  const c = context();
  if (!c || !master) return handle;
  let stopped = false;
  handle.stop = () => {
    stopped = true;
  };
  void load(kind, id).then((buffer) => {
    if (!buffer || stopped || !soundEnabled() || !master) return;
    const src = c.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = opts.rate ?? 1;
    src.loop = !!opts.loop;
    const gain = c.createGain();
    gain.gain.value = (opts.volume ?? 1) * VOLUME[kind];
    src.connect(gain).connect(master);
    src.start();
    handle.stop = () => {
      try {
        src.stop();
      } catch {
        // Already stopped.
      }
    };
  });
  return handle;
}

export function playSfx(id: SfxId, opts?: { volume?: number; rate?: number }) {
  play("sfx", id, opts);
}

/** One voice at a time: a new line cuts the last one off. */
export function playVoice(id: VoiceId) {
  voice?.stop();
  voice = play("voice", id);
}

/** Loops a track; asking for the one already playing does nothing. */
export function playMusic(id: MusicId, opts: { loop?: boolean } = {}) {
  if (music?.id === id) return;
  stopMusic();
  music = { id, handle: play("music", id, { loop: opts.loop ?? true }) };
}

export function stopMusic() {
  music?.handle.stop();
  music = null;
}

/** Warm the cache after the first tap so the first hit isn't late. */
export function preloadSounds(kind: Kind, ids: string[]) {
  if (!soundEnabled() || !context()) return;
  ids.forEach((id) => void load(kind, id));
}
