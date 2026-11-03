/**
 * Plays the game's sounds with Web Audio. Files that don't exist or don't decode are
 * skipped quietly, so the game never waits on audio. Sound is on by default and the choice,
 * like the music and effects volumes, is remembered in this browser; browsers only start
 * audio after a tap or key, so the first one unlocks it.
 *
 * - Music: one bed at a time. A new cue crossfades from the last (0.8 s, equal power), and
 *   a bed you come back to within a couple of minutes picks up where it left off. Beds loop
 *   seamlessly: near each seam a second pass starts on the loop's last 40 ms, which the
 *   file repeats just before the loop start (scripts/audio/master.py), and the two crossfade.
 * - Stings play once over the bed, which ducks under them; voices duck all the music.
 * - Files load when a cue first plays (or is preloaded for the next stop), never all up front.
 * - The pause sheet ducks the music and the ambience; a hidden tab suspends everything.
 *
 * `?debug=1` or `?autopilot=1` keeps a log of cues, voices and missing files on
 * `window.__wgpAudio` for headless checks.
 */
import { LOOPS } from "./loops";
import { audioPath, type MusicId, type SfxId, type VoiceId } from "./manifest";

type Kind = "sfx" | "music" | "voice";
type Handle = { stop: () => void };
type Loop = { start: number; end: number };

export interface Mix {
  /** 0 to 1: the score. */
  music: number;
  /** 0 to 1: effects, voices and the city's ambience. */
  sfx: number;
}

const SOUND_KEY = "wgp:sound:v1";
const MIX_KEY = "wgp:mix:v1";
/** The files are loudness-matched (music -16 LUFS, the rest -14), so the balance lives here. */
const LEVEL = { music: 0.5, sfx: 0.62, voice: 0.95, ambience: 0.2 } as const;
const DUCK = { voice: 0.42, sting: 0.3, pause: 0.35 } as const;
/** How long a sting holds the bed down, at most (seconds). */
const STING_DUCK = 2.4;
/** The same effect can't stack faster than this, or a flurry turns into noise. */
const MIN_GAP_MS = 70;
/** The crossfade between two passes of a loop, across its seam. */
const SEAM = 0.04;
/** A bed played again within this long resumes where it stopped. */
const RESUME_MS = 150_000;
/** Decoded beds are big (about 20 MB a minute): keep the few most recent. */
const BED_CACHE = 4;

const DEFAULT_MIX: Mix = { music: 1, sfx: 1 };

interface Nodes {
  musicOut: GainNode;
  pauseDuck: GainNode;
  voiceDuck: GainNode;
  bedDuck: GainNode;
  stings: GainNode;
  sfx: GainNode;
  voice: GainNode;
  ambience: GainNode;
  ambienceDuck: GainNode;
}

let ctx: AudioContext | null = null;
let nodes: Nodes | null = null;
let enabled: boolean | null = null;
let mix: Mix | null = null;
const buffers = new Map<string, Promise<AudioBuffer | null>>();
const recentBeds: string[] = [];
const lastPlayed = new Map<string, number>();
const listeners = new Set<() => void>();
const ducks = { voice: 0, sting: 0, pause: false };

let bed: Track | null = null;
/** The bed the game wants, kept while sound is off so turning it on brings it back. */
let wanted: MusicId | null = null;
let ambience: Track | null = null;
let wantedAmbience: SfxId | null = null;
let voice: Handle | null = null;
let queuedVoice: { id: VoiceId; delay: number } | null = null;
const resume = new Map<string, { pos: number; at: number }>();
let ticker: number | null = null;

/* ------------------------------------------------------------------ debug log */

export interface AudioLogEntry {
  t: number;
  type: "music" | "sting" | "voice" | "ambience" | "missing" | "stop";
  id: string;
}

declare global {
  interface Window {
    __wgpAudio?: { log: AudioLogEntry[]; music: () => string | null; position: () => number | null; mix: () => Mix };
  }
}

function note(type: AudioLogEntry["type"], id: string) {
  if (typeof window === "undefined") return;
  const q = new URLSearchParams(window.location.search);
  if (q.get("debug") !== "1" && q.get("autopilot") !== "1") return;
  window.__wgpAudio ??= { log: [], music: () => bed?.id ?? null, position: () => bed?.position() ?? null, mix: getMix };
  window.__wgpAudio.log.push({ t: Math.round(performance.now()), type, id });
}

/* ------------------------------------------------------------------ settings */

const notify = () => listeners.forEach((l) => l());

export function soundEnabled(): boolean {
  if (enabled === null) {
    try {
      enabled = window.localStorage.getItem(SOUND_KEY) !== "off";
    } catch {
      enabled = true;
    }
  }
  return enabled;
}

export function setSoundEnabled(on: boolean) {
  enabled = on;
  try {
    window.localStorage.setItem(SOUND_KEY, on ? "on" : "off");
  } catch {
    // Not remembered, but still applied for this visit.
  }
  if (!on) {
    const keep = { bed: wanted, ambience: wantedAmbience };
    stopMusic({ fade: 0.2 });
    setAmbience(null, { fade: 0.2 });
    wanted = keep.bed;
    wantedAmbience = keep.ambience;
    voice?.stop();
  } else {
    if (wanted) playMusic(wanted);
    if (wantedAmbience) setAmbience(wantedAmbience);
  }
  notify();
}

/** Called when the sound switch or the volumes change. */
export function subscribeSound(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

const clamp01 = (n: unknown, fallback: number) => (typeof n === "number" && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback);

/** The remembered volumes: the same object until they change, for useSyncExternalStore. */
export function getMix(): Mix {
  if (!mix) {
    let saved: Partial<Mix> = {};
    try {
      saved = JSON.parse(window.localStorage.getItem(MIX_KEY) ?? "{}") ?? {};
    } catch {
      // Blocked or corrupt storage: the defaults.
    }
    mix = { music: clamp01(saved.music, DEFAULT_MIX.music), sfx: clamp01(saved.sfx, DEFAULT_MIX.sfx) };
  }
  return mix;
}

/** The volumes on the server render, before the browser's are read. */
export const serverMix = () => DEFAULT_MIX;

export function setMix(next: Partial<Mix>) {
  const prev = getMix();
  mix = { music: clamp01(next.music, prev.music), sfx: clamp01(next.sfx, prev.sfx) };
  try {
    window.localStorage.setItem(MIX_KEY, JSON.stringify(mix));
  } catch {
    // Not remembered, but applied for this visit.
  }
  applyMix(0.05);
  notify();
}

/** A slider's 0..1 as gain: squared, so the low half of the travel stays useful. */
const taper = (v: number) => v * v;

function applyMix(ramp: number) {
  if (!ctx || !nodes) return;
  const m = getMix();
  const t = ctx.currentTime;
  nodes.musicOut.gain.setTargetAtTime(LEVEL.music * taper(m.music), t, ramp);
  nodes.sfx.gain.setTargetAtTime(LEVEL.sfx * taper(m.sfx), t, ramp);
  nodes.voice.gain.setTargetAtTime(LEVEL.voice * taper(m.sfx), t, ramp);
  nodes.ambience.gain.setTargetAtTime(LEVEL.ambience * taper(m.sfx), t, ramp);
}

function applyDucks() {
  if (!ctx || !nodes) return;
  const t = ctx.currentTime;
  // Duck fast, come back slowly.
  const set = (node: GainNode, value: number) => node.gain.setTargetAtTime(value, t, value < node.gain.value ? 0.06 : 0.25);
  set(nodes.voiceDuck, ducks.voice > 0 ? DUCK.voice : 1);
  set(nodes.bedDuck, ducks.sting > 0 ? DUCK.sting : 1);
  set(nodes.pauseDuck, ducks.pause ? DUCK.pause : 1);
  set(nodes.ambienceDuck, ducks.pause ? DUCK.pause : 1);
}

/* ------------------------------------------------------------------ context */

function context(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    const c = new Ctor({ latencyHint: "interactive" });
    ctx = c;
    const gain = (to: AudioNode) => {
      const g = c.createGain();
      g.connect(to);
      return g;
    };
    // A gentle safety limiter on the sum, for the moment everything hits at once.
    const limiter = c.createDynamicsCompressor();
    limiter.threshold.value = -4;
    limiter.knee.value = 4;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.15;
    limiter.connect(c.destination);
    // music: beds → bedDuck (stings) ┐
    //                       stings ──┴→ voiceDuck → pauseDuck → musicOut (volume) → limiter
    const musicOut = gain(limiter);
    const pauseDuck = gain(musicOut);
    const voiceDuck = gain(pauseDuck);
    const ambienceDuck = gain(limiter);
    nodes = {
      musicOut,
      pauseDuck,
      voiceDuck,
      bedDuck: gain(voiceDuck),
      stings: gain(voiceDuck),
      sfx: gain(limiter),
      voice: gain(limiter),
      ambience: gain(ambienceDuck),
      ambienceDuck,
    };
    applyMix(0.001);

    // Browsers start audio only after a gesture; the first tap or key resumes it.
    const unlock = () => {
      if (c.state === "suspended" && !document.hidden) void c.resume().catch(() => {});
    };
    for (const type of ["pointerdown", "keydown", "touchend"]) window.addEventListener(type, unlock, { capture: true, passive: true });
    // A hidden tab goes quiet (the game pauses itself there too).
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) void c.suspend().catch(() => {});
      else if (soundEnabled()) void c.resume().catch(() => {});
    });
  }
  if (ctx.state === "suspended" && !document.hidden) void ctx.resume().catch(() => {});
  return ctx;
}

const isBed = (kind: Kind, id: string) => kind === "music" && !!LOOPS[`music/${id}`];

function load(kind: Kind, id: string): Promise<AudioBuffer | null> {
  const url = audioPath(kind, id);
  let pending = buffers.get(url);
  if (!pending) {
    const c = context();
    if (!c) return Promise.resolve(null);
    pending = fetch(url)
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .then((b) => (b ? c.decodeAudioData(b) : null))
      .catch(() => null)
      .then((buffer) => {
        if (!buffer) {
          note("missing", `${kind}/${id}`);
          buffers.delete(url);
        }
        return buffer;
      });
    buffers.set(url, pending);
  }
  if (isBed(kind, id)) {
    const i = recentBeds.indexOf(url);
    if (i >= 0) recentBeds.splice(i, 1);
    recentBeds.push(url);
    while (recentBeds.length > BED_CACHE) buffers.delete(recentBeds.shift()!);
  }
  return pending;
}

/* ------------------------------------------------------------------ one-shots */

/**
 * A one-shot belongs to its moment: before the page has had a tap or key the context can't
 * run, and queueing would fire the sound on some later, unrelated tap. Beds do wait.
 */
function canPlayNow(c: AudioContext) {
  return c.state === "running" || (navigator.userActivation?.hasBeenActive ?? true);
}

function oneShot(
  kind: Kind,
  id: string,
  out: () => AudioNode | null,
  opts: { volume?: number; rate?: number; delay?: number } = {},
  onEnd?: () => void,
  onStart?: (seconds: number) => void,
): Handle {
  const handle: Handle = { stop: () => {} };
  const c = soundEnabled() ? context() : null;
  if (!c || !canPlayNow(c)) {
    onEnd?.();
    return handle;
  }
  let stopped = false;
  handle.stop = () => {
    stopped = true;
  };
  void load(kind, id).then((buffer) => {
    const dest = out();
    if (!buffer || stopped || !soundEnabled() || !dest) {
      onEnd?.();
      return;
    }
    const src = c.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = opts.rate ?? 1;
    const gain = c.createGain();
    gain.gain.value = opts.volume ?? 1;
    src.connect(gain).connect(dest);
    src.onended = () => {
      src.disconnect();
      gain.disconnect();
      onEnd?.();
    };
    src.start(c.currentTime + (opts.delay ?? 0));
    onStart?.((opts.delay ?? 0) + buffer.duration / (opts.rate ?? 1));
    handle.stop = () => {
      try {
        gain.gain.setTargetAtTime(0, c.currentTime, 0.02);
        src.stop(c.currentTime + 0.1);
      } catch {
        // Already stopped.
      }
    };
  });
  return handle;
}

export function playSfx(id: SfxId, opts?: { volume?: number; rate?: number; delay?: number }) {
  const now = typeof performance === "undefined" ? 0 : performance.now();
  if (now - (lastPlayed.get(id) ?? -Infinity) < MIN_GAP_MS) return;
  lastPlayed.set(id, now);
  oneShot("sfx", id, () => nodes?.sfx ?? null, opts);
}

/**
 * One voice at a time, and nobody talks over anybody: a line asked for while another plays
 * waits for it (only the newest waiting line is kept). `cut` interrupts instead. The music
 * ducks under every line.
 */
export function playVoice(id: VoiceId, opts: { delay?: number; cut?: boolean } = {}) {
  if (!soundEnabled()) return;
  if (voice && !opts.cut) {
    queuedVoice = { id, delay: Math.min(opts.delay ?? 0, 0.2) };
    return;
  }
  voice?.stop();
  queuedVoice = null;
  note("voice", id);
  ducks.voice++;
  applyDucks();
  let handle: Handle | null = null;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    ducks.voice = Math.max(0, ducks.voice - 1);
    applyDucks();
    if (voice === handle) voice = null;
    const next = queuedVoice;
    queuedVoice = null;
    if (next && !voice) playVoice(next.id, { delay: next.delay });
  };
  const line = oneShot("voice", id, () => nodes?.voice ?? null, opts, release);
  // It couldn't play at all (no context yet, or no tap so far): nothing to hold the floor.
  if (released) return;
  handle = {
    stop: () => {
      line.stop();
      release();
    },
  };
  voice = handle;
}

/**
 * A short cue over the bed (a villain's entrance, the Rug's jingle). The bed ducks under its
 * hit, not its whole ringing tail: back up after STING_DUCK at most.
 */
export function playSting(id: MusicId, opts: { delay?: number } = {}) {
  if (!soundEnabled()) return;
  note("sting", id);
  ducks.sting++;
  applyDucks();
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    ducks.sting = Math.max(0, ducks.sting - 1);
    applyDucks();
  };
  oneShot("music", id, () => nodes?.stings ?? null, opts, release, (seconds) => window.setTimeout(release, Math.min(seconds, STING_DUCK) * 1000));
}

/* ------------------------------------------------------------------ beds */

/** Where a loop is after `elapsed` seconds from `offset`, wrapped into the loop. */
export function loopPosition(offset: number, elapsed: number, loop: Loop | null): number {
  const pos = offset + elapsed;
  if (!loop || pos < loop.end) return pos;
  const len = loop.end - loop.start;
  return loop.start + ((pos - loop.start) % len);
}

/**
 * An equal-power fade from the param's current value (two unrelated cues crossfading this
 * way keep their loudness through the middle). It re-anchors first, so it can cut into a fade.
 */
function fadeParam(param: AudioParam, to: number, at: number, dur: number) {
  const from = param.value;
  param.cancelScheduledValues(0);
  param.setValueAtTime(from, at);
  const n = 32;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * (Math.PI / 2);
    curve[i] = to > from ? from + (to - from) * Math.sin(x) : to + (from - to) * Math.cos(x);
  }
  param.setValueCurveAtTime(curve, at + 0.001, Math.max(0.01, dur));
}

/**
 * A looping (or one-shot) file on its own fade gain. Each pass of a loop runs from its
 * offset to the loop end; the next starts SEAM early at loopStart - SEAM, so the two
 * overlap on the same audio and crossfade.
 */
class Track {
  readonly gain: GainNode;
  private passes: { src: AudioBufferSourceNode; when: number; offset: number }[] = [];
  private next = Infinity;
  private buffer: AudioBuffer | null = null;
  stopped = false;

  constructor(
    readonly kind: Kind,
    readonly id: string,
    readonly loop: Loop | null,
    out: AudioNode,
    private readonly c: AudioContext,
  ) {
    this.gain = c.createGain();
    this.gain.gain.value = 0;
    this.gain.connect(out);
  }

  /** Load, then fade in from `offset` (or the start). */
  begin(offset: number, fade: number) {
    void load(this.kind, this.id).then((buffer) => {
      if (!buffer || this.stopped) return;
      this.buffer = buffer;
      const t = this.c.currentTime + 0.02;
      const loop = this.loop;
      const from = loop ? (offset > loop.end - 0.25 ? loop.start : offset) : 0;
      fadeParam(this.gain.gain, 1, t, fade);
      this.pass(t, Math.max(0, from), false);
    });
  }

  private pass(when: number, offset: number, fadeIn: boolean) {
    const { c, buffer, loop } = this;
    if (!buffer) return;
    const src = c.createBufferSource();
    src.buffer = buffer;
    const g = c.createGain();
    src.connect(g).connect(this.gain);
    if (fadeIn) {
      g.gain.setValueAtTime(0, when);
      g.gain.linearRampToValueAtTime(1, when + SEAM);
    }
    src.start(when, offset);
    if (loop) {
      const end = when + (loop.end - offset);
      g.gain.setValueAtTime(1, end - SEAM);
      g.gain.linearRampToValueAtTime(0, end);
      src.stop(end + 0.02);
      this.next = end - SEAM;
    } else {
      this.next = Infinity;
    }
    src.onended = () => {
      this.passes = this.passes.filter((p) => p.src !== src);
      src.disconnect();
      g.disconnect();
    };
    this.passes.push({ src, when, offset });
  }

  /** Schedule the next pass once its seam is close. */
  tick() {
    if (this.stopped || !this.loop || !this.buffer) return;
    if (this.next - this.c.currentTime < 1.5) this.pass(this.next, this.loop.start - SEAM, true);
  }

  /** Where playback is now, in the file. */
  position(): number | null {
    const now = this.c.currentTime;
    const p = this.passes.findLast((x) => x.when <= now);
    return p ? loopPosition(p.offset, now - p.when, this.loop) : null;
  }

  end(fade: number) {
    if (this.stopped) return;
    this.stopped = true;
    const t = this.c.currentTime;
    fadeParam(this.gain.gain, 0, t, fade);
    for (const p of this.passes) {
      try {
        p.src.stop(t + fade + 0.05);
      } catch {
        // Already stopped.
      }
    }
    window.setTimeout(() => this.gain.disconnect(), (fade + 0.3) * 1000);
  }
}

function ensureTicker() {
  if (ticker !== null || typeof window === "undefined") return;
  ticker = window.setInterval(() => {
    bed?.tick();
    ambience?.tick();
  }, 400);
}

/**
 * Crossfade to a bed; asking for the one already playing does nothing. The results'
 * fanfares come through here too with `loop: false`, replacing the bed.
 */
export function playMusic(id: MusicId, opts: { fade?: number; loop?: boolean } = {}) {
  wanted = id;
  if (bed?.id === id && !bed.stopped) return;
  if (!soundEnabled()) return;
  const c = context();
  if (!c || !nodes) return;
  const fade = opts.fade ?? 0.8;
  retire(fade);
  const loop = opts.loop === false ? null : (LOOPS[`music/${id}`] ?? null);
  const saved = resume.get(id);
  const offset = loop && saved && performance.now() - saved.at < RESUME_MS ? saved.pos : 0;
  note("music", id);
  bed = new Track("music", id, loop, nodes.bedDuck, c);
  bed.begin(offset, fade);
  ensureTicker();
}

/** Fade the bed out, remembering where it was for a quick return. */
export function stopMusic(opts: { fade?: number } = {}) {
  wanted = null;
  if (bed) note("stop", bed.id);
  retire(opts.fade ?? 0.8);
}

function retire(fade: number) {
  if (!bed) return;
  const pos = bed.position();
  if (bed.loop && pos !== null) resume.set(bed.id, { pos, at: performance.now() });
  bed.end(fade);
  bed = null;
}

/** The city's ambience: a seamless loop on the effects volume, or silence. */
export function setAmbience(id: SfxId | null, opts: { fade?: number } = {}) {
  wantedAmbience = id;
  if (ambience && ambience.id === id && !ambience.stopped) return;
  ambience?.end(opts.fade ?? 1);
  ambience = null;
  if (!id || !soundEnabled()) return;
  const c = context();
  if (!c || !nodes) return;
  note("ambience", id);
  ambience = new Track("sfx", id, LOOPS[`sfx/${id}`] ?? null, nodes.ambience, c);
  ambience.begin(0, opts.fade ?? 1.5);
  ensureTicker();
}

/** The pause sheet is open: the music and the ambience step back. */
export function setAudioPaused(paused: boolean) {
  if (ducks.pause === paused) return;
  ducks.pause = paused;
  applyDucks();
}

/** Warm the cache so the first hit isn't late (only once sound may play). */
export function preloadSounds(kind: Kind, ids: readonly string[]) {
  if (!soundEnabled() || !context()) return;
  ids.forEach((id) => void load(kind, id));
}
