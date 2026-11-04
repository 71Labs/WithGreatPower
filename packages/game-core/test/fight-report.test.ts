import { writeFileSync } from "node:fs";
import { describe, it } from "vitest";

import { fightReport, fightTracks } from "./fight-metrics";

/**
 * FIGHT_REPORT=1 pnpm --filter @wgp/game-core exec vitest run test/fight-report.test.ts
 *
 * With FIGHT_TRACKS=<file.json> it also writes the fights of nights 1–6 (the bot and the good
 * player) for apps/wgp's camera report (CAMERA_REPORT=<file.json>).
 */
describe.runIf(process.env.FIGHT_REPORT === "1")("fight report", () => {
  it("prints", () => {
    console.log(fightReport());
    const out = process.env.FIGHT_TRACKS;
    if (out) writeFileSync(out, JSON.stringify([...fightTracks("bot"), ...fightTracks("good")]));
  }, 900_000);
});
