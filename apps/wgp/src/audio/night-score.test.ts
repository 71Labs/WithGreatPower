import { describe, expect, it } from "vitest";

import type { Stop } from "@wgp/game-core/types";

import { LOOPS } from "./loops";
import { MUSIC, SFX, VOICES } from "./manifest";
import { nightScore, type ScoreOut } from "./night-score";
import { loopPosition } from "./player";

const STOPS: Stop[] = [
  { kind: "fight", villain: "gas-goblin", district: "sector-7", level: 1, boss: false, quest: false },
  { kind: "errand", ally: "aunt-mainnet", errand: "groceries", district: "queens-block" },
  { kind: "errand", ally: "mary-jpeg", errand: "selfie", district: "mempool-market" },
  { kind: "fight", villain: "doc-octochain", district: "bridge-district", level: 2, boss: true, quest: false },
];

/** Records what the score asks for, as "kind:id" strings. */
function recorder() {
  const calls: string[] = [];
  const out: ScoreOut = {
    music: (id) => calls.push(`music:${id}`),
    stopMusic: () => calls.push("stop"),
    sting: (id) => calls.push(`sting:${id}`),
    voice: (id) => calls.push(`voice:${id}`),
    sfx: (id) => calls.push(`sfx:${id}`),
    ambience: (id) => calls.push(`ambience:${id}`),
    paused: (on) => calls.push(`paused:${on}`),
    preload: (kind, ids) => calls.push(`preload:${kind}:${ids.join(",")}`),
  };
  return { calls, out };
}

const cues = (calls: string[]) => calls.filter((c) => /^(music|sting|stop)/.test(c));

describe("the night score", () => {
  it("plays every state of a won night on its own cue", () => {
    const { calls, out } = recorder();
    const on = nightScore(STOPS, out);
    on({ type: "countdown", value: 3 });
    on({ type: "go" });
    on({ type: "encounter", index: 0, villain: "gas-goblin" });
    on({ type: "fight-live", index: 0 });
    on({ type: "fight-won", index: 0, villain: "gas-goblin", hp: 50, fluid: 50, uses: {}, gweiUsed: 0 });
    on({ type: "arrive", index: 1, kind: "errand", hp: 50, fluid: 50, combo: 0, perfect: 0, good: 0, miss: 0, uses: {} });
    on({ type: "errand", index: 1 });
    // The 3D sim sends no stop-done after an errand: the next swing leaves it.
    on({ type: "thwip", x: 1, y: 2, z: 3, ax: 0, ay: 0, az: 0 });
    on({ type: "thwip", x: 1, y: 2, z: 3, ax: 0, ay: 0, az: 0 });
    on({ type: "encounter", index: 3, villain: "doc-octochain" });
    on({ type: "fight-live", index: 3 });
    on({ type: "fight-won", index: 3, villain: "doc-octochain", hp: 50, fluid: 50, uses: {}, gweiUsed: 0 });
    on({ type: "night-over", reason: "route" });
    on({ type: "night-over", reason: "route" });

    expect(cues(calls)).toEqual([
      "music:patrol",
      "stop",
      "sting:sting-gas-goblin",
      "music:fight",
      "music:patrol",
      "music:errand",
      "music:patrol",
      "stop",
      "sting:sting-doc-octochain",
      "music:boss",
      "stop",
      "music:victory",
    ]);
    expect(calls).toContain("ambience:city-night");
    expect(calls).toContain("voice:gas-goblin-taunt");
    expect(calls).toContain("voice:doc-octochain-defeat");
    expect(calls).toContain("voice:aunt-mainnet-hello");
    expect(calls).toContain("voice:aunt-mainnet-thanks");
  });

  it("loads the next stop's cues while swinging there", () => {
    const { calls, out } = recorder();
    const on = nightScore(STOPS, out);
    on({ type: "go" });
    expect(calls).toContain("preload:music:fight,sting-gas-goblin");
    on({ type: "errand", index: 2 });
    on({ type: "stop-done", index: 2 });
    expect(calls).toContain("preload:music:boss,sting-doc-octochain");
  });

  it("ends a knockout on the lose sting", () => {
    const { calls, out } = recorder();
    const on = nightScore(STOPS, out);
    on({ type: "go" });
    on({ type: "ko", index: 0, villain: "gas-goblin", hp: 0, fluid: 0, uses: {}, gweiUsed: 0 });
    on({ type: "night-over", reason: "ko" });
    expect(cues(calls)).toEqual(["music:patrol", "stop", "music:defeat"]);
    expect(calls).toContain("voice:aunt-mainnet-patch");
  });

  it("ducks under the pause sheet and comes back", () => {
    const { calls, out } = recorder();
    const on = nightScore(STOPS, out);
    on({ type: "status", status: "paused" });
    on({ type: "status", status: "live" });
    expect(calls.filter((c) => c.startsWith("paused"))).toEqual(["paused:true", "paused:false"]);
  });

  it("only asks for sounds the manifest has", () => {
    const { calls, out } = recorder();
    const on = nightScore(STOPS, out);
    for (const villain of ["gas-goblin", "sandwich-man", "doc-octochain", "sybil"] as const) {
      on({ type: "encounter", index: 0, villain });
      on({ type: "fight-won", index: 0, villain, hp: 1, fluid: 1, uses: {}, gweiUsed: 0 });
    }
    on({ type: "blast", kind: "bomb", x: 0, y: 0, z: 0, r: 1 });
    const known = new Set([...MUSIC.map((m) => `music:${m.id}`), ...MUSIC.map((m) => `sting:${m.id}`), ...SFX.map((s) => `sfx:${s.id}`), ...VOICES.map((v) => `voice:${v.id}`)]);
    for (const c of calls.filter((x) => /^(music|sting|sfx|voice):/.test(x))) expect(known).toContain(c);
  });
});

describe("loops", () => {
  it("has a loop for every bed and the ambience, inside sensible bounds", () => {
    for (const m of MUSIC.filter((x) => x.loop)) {
      const loop = LOOPS[`music/${m.id}`];
      expect(loop, m.id).toBeDefined();
      expect(loop!.start).toBeGreaterThan(0.04);
      expect(loop!.end - loop!.start).toBeGreaterThan(20);
    }
    expect(LOOPS["sfx/city-night"]).toBeDefined();
  });

  it("wraps a position into the loop", () => {
    const loop = { start: 10, end: 40 };
    expect(loopPosition(0, 5, loop)).toBe(5);
    expect(loopPosition(35, 5, loop)).toBe(10);
    expect(loopPosition(35, 40, loop)).toBe(15);
    expect(loopPosition(2, 3, null)).toBe(5);
  });
});
