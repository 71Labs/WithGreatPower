/**
 * The night's sound, for the 2D and the 3D game alike: turns the sim's event stream into
 * effects, voice lines, ambience and the score. Listens on the loop's bus next to the
 * renderer and never touches game state.
 *
 * The cue map:
 *   countdown            the city's ambience fades in; the travel bed preloads
 *   go                   "patrol" (travel) and the narrator
 *   arrive at an errand  "errand", and the ally's hello
 *   swing off an errand  back to "patrol", where it left off; Aunt Mainnet says thanks
 *   encounter            the bed fades, the villain's sting hits, then the taunt
 *   fight-live           "fight", or "boss" for the boss
 *   fight won            webbed, the villain's defeat line, loot; back to "patrol" (after
 *                        the last stop the bed fades out for the fanfare)
 *   knocked out          the bed fades; Aunt Mainnet patches you up
 *   night over           "victory" or "defeat", once
 *   paused               the music and ambience duck under the pause sheet
 * While swinging to a stop, its bed, sting and lines load in the background.
 */
import type { Stop, VillainId } from "@wgp/game-core/types";

import type { LoopEvent3D } from "@/game3d/session/loop3d";
import type { LoopEvent } from "@/sim/loop";

import type { MusicId, SfxId, VoiceId } from "./manifest";
import * as player from "./player";

/** Where the score's decisions go: the player, or a recorder in tests. */
export interface ScoreOut {
  music(id: MusicId, opts?: { fade?: number; loop?: boolean }): void;
  stopMusic(opts?: { fade?: number }): void;
  sting(id: MusicId, opts?: { delay?: number }): void;
  voice(id: VoiceId, opts?: { delay?: number }): void;
  sfx(id: SfxId, opts?: { volume?: number; rate?: number; delay?: number }): void;
  ambience(id: SfxId | null): void;
  paused(on: boolean): void;
  preload(kind: "sfx" | "music" | "voice", ids: readonly string[]): void;
}

export const playerOut: ScoreOut = {
  music: player.playMusic,
  stopMusic: player.stopMusic,
  sting: player.playSting,
  voice: player.playVoice,
  sfx: player.playSfx,
  ambience: (id) => player.setAmbience(id),
  paused: player.setAudioPaused,
  preload: player.preloadSounds,
};

const TAUNT: Record<VillainId, VoiceId> = {
  "gas-goblin": "gas-goblin-taunt",
  "sandwich-man": "sandwich-man-taunt",
  "doc-octochain": "doc-octochain-taunt",
  sybil: "sybil-taunt",
};

const DEFEAT: Record<VillainId, VoiceId> = {
  "gas-goblin": "gas-goblin-defeat",
  "sandwich-man": "sandwich-man-defeat",
  "doc-octochain": "doc-octochain-defeat",
  sybil: "sybil-defeat",
};

export const STING: Record<VillainId, MusicId> = {
  "gas-goblin": "sting-gas-goblin",
  "sandwich-man": "sting-sandwich-man",
  "doc-octochain": "sting-doc-octochain",
  sybil: "sting-sybil",
};

/** What an ally says when you swing up to them. */
const GREETING: Partial<Record<string, VoiceId>> = {
  "aunt-mainnet": "aunt-mainnet-hello",
  "mary-jpeg": "mary-jpeg-selfie",
  "uncle-gen": "uncle-gen-power",
  bearson: "bearson-menace",
  gwei: "gwei-backup",
};

const HOT_SFX: SfxId[] = ["thwip", "swing", "release-perfect", "street-thud", "pow", "villain-hit", "hurt", "webbed", "loot"];

/** A little pitch variety from the event's position, so repeats don't sound identical. */
const vary = (x: number) => 0.94 + (Math.abs(Math.round(x)) % 13) / 100;
const depth = (ev: object) => ("z" in ev && typeof ev.z === "number" ? ev.z : 0);

/** What a stop will need, to load while swinging there. */
function stopCues(stop: Stop | undefined): { music: MusicId[]; voice: VoiceId[] } {
  if (!stop) return { music: [], voice: [] };
  if (stop.kind === "errand") {
    const hello = GREETING[stop.ally];
    return { music: ["errand"], voice: hello ? [hello] : [] };
  }
  return { music: [stop.boss ? "boss" : "fight", STING[stop.villain]], voice: [TAUNT[stop.villain], DEFEAT[stop.villain]] };
}

export function nightScore(stops: readonly Stop[], out: ScoreOut = playerOut) {
  let boss = false;
  let started = false;
  let ended = false;
  let cackled = false;
  /** The errand sheet is (or was just) open at this stop: the next swing leaves it. */
  let errand: number | null = null;

  const preloadFor = (index: number) => {
    const cues = stopCues(stops[index]);
    out.preload("music", cues.music);
    out.preload("voice", cues.voice);
  };

  // An errand ends when the hero swings off (the 3D sim sends no stop-done for one).
  const leaveErrand = () => {
    if (errand === null) return;
    const index = errand;
    errand = null;
    const stop = stops[index];
    if (stop?.kind === "errand" && stop.ally === "aunt-mainnet") out.voice("aunt-mainnet-thanks");
    if (index < stops.length - 1 && !ended) {
      out.music("patrol", { fade: 1 });
      preloadFor(index + 1);
    }
  };

  return (ev: LoopEvent | LoopEvent3D) => {
    if (errand !== null && (ev.type === "thwip" || ev.type === "release" || ev.type === "land" || ev.type === "miss" || ev.type === "stop-done" || ev.type === "encounter")) leaveErrand();
    switch (ev.type) {
      case "countdown":
        if (started) break;
        started = true;
        out.preload("sfx", HOT_SFX);
        out.preload("music", ["patrol"]);
        out.preload("voice", ["narrator-night"]);
        out.ambience("city-night");
        break;
      case "go":
        out.voice("narrator-night");
        out.music("patrol", { fade: 1 });
        out.ambience("city-night");
        preloadFor(0);
        break;
      case "thwip":
        out.sfx("thwip", { rate: vary(ev.x + depth(ev)) });
        break;
      // Ruleset 4: a web-zip at a villain is a quicker thwip; a strike's swing a short whoosh.
      case "zip":
        out.sfx("thwip", { rate: 1.15 });
        break;
      case "strike":
        out.sfx("swing", { volume: 0.4, rate: 1.35 });
        break;
      case "release":
        if (ev.grade === "perfect") {
          out.sfx("release-perfect");
          out.sfx("swing", { volume: 0.5, rate: vary(ev.y) });
        } else if (ev.grade === "good") out.sfx("swing", { volume: 0.6, rate: vary(ev.y) });
        else if ("auto" in ev && ev.auto) out.sfx("swing", { volume: 0.35, rate: vary(ev.y) });
        break;
      case "pickup":
        // Ruleset 3: a Bits token chimes a little higher as the combo climbs; a ring whooshes.
        if (ev.kind === "ring") {
          out.sfx("release-perfect", { volume: 0.8, rate: 1.12 });
          out.sfx("swing", { volume: 0.7, rate: 1.2 });
        } else out.sfx("loot", { volume: 0.45, rate: 0.92 + Math.min(ev.combo, 16) * 0.025 });
        break;
      case "miss":
        out.sfx("street-thud");
        break;
      case "villain-hit":
        out.sfx(ev.by === "slam" || ev.by === "dash" || ev.by === "strike" ? "pow" : "villain-hit", { rate: vary(ev.x + depth(ev)) });
        if (ev.copy) out.sfx("sybil-pop", { volume: 0.7 });
        break;
      case "hero-hurt":
        out.sfx("hurt");
        break;
      case "dodge":
        out.sfx("swing", { volume: 0.45, rate: 1.15 });
        break;
      case "blast":
        if (ev.kind === "bomb") {
          out.sfx("fee-bomb");
          // The Goblin laughs at his first fee bomb of a fight, not at every one.
          if (!cackled) {
            cackled = true;
            out.voice("gas-goblin-cackle", { delay: 0.3 });
          }
        } else out.sfx("pow", { volume: 0.8 });
        break;
      case "trap":
        out.sfx("bread-clap");
        break;
      case "goo":
        out.sfx("sybil-pop", { volume: 0.6 });
        break;
      case "clang":
        out.sfx("chain-sweep", { volume: 0.5 });
        break;
      case "arrive": {
        const stop = stops[ev.index];
        if (stop?.kind !== "errand") break;
        out.music("errand");
        const line = GREETING[stop.ally];
        if (line) out.voice(line, { delay: 0.2 });
        break;
      }
      case "errand":
        errand = ev.index;
        out.sfx("ui-sheet", { volume: 0.6 });
        break;
      case "encounter": {
        const stop = stops[ev.index];
        boss = stop?.kind === "fight" && stop.boss;
        cackled = false;
        out.stopMusic({ fade: 0.6 });
        out.sting(STING[ev.villain]);
        out.voice(TAUNT[ev.villain], { delay: 0.45 });
        break;
      }
      case "fight-live":
        out.music(boss ? "boss" : "fight", { fade: 0.6 });
        break;
      case "fight-won":
        out.sfx("webbed");
        out.sfx("loot", { delay: 0.9, volume: 0.8 });
        out.voice(DEFEAT[ev.villain], { delay: 0.5 });
        if (ev.index >= stops.length - 1) out.stopMusic({ fade: 1.2 });
        else {
          out.music("patrol", { fade: 1 });
          preloadFor(ev.index + 1);
        }
        boss = false;
        break;
      case "ko":
        out.sfx("ko");
        out.stopMusic({ fade: 1 });
        out.voice("aunt-mainnet-patch", { delay: 1.5 });
        break;
      case "gwei":
        out.voice("gwei-backup");
        break;
      case "night-over":
        if (ended) break;
        ended = true;
        out.music(ev.reason === "route" ? "victory" : "defeat", { fade: 0.3, loop: false });
        break;
      case "status":
        if (ev.status === "paused") out.sfx("ui-sheet", { volume: 0.6 });
        out.paused(ev.status === "paused");
        break;
    }
  };
}
