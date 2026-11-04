/**
 * The camera pass's before/after table, from scripts/camera/metrics.ts's JSON (the old camera
 * run through the same harness, then the new one; each also with the Steady camera):
 *
 *   node launch/brand/hero/camera-table.mjs <before.json> <after.json> <before-steady.json> <after-steady.json> [previous.json] > metrics.md
 *
 * With a fifth file, a middle column for an earlier "after" (the pass's first round).
 */
import { readFileSync } from "node:fs";

const files = process.argv.slice(2);
const [before, after, beforeSteady, afterSteady, previous] = files.slice(0, 5).map((f) => JSON.parse(readFileSync(f, "utf8")));
/** The column names and the note on what "before" is (env, for a run against another baseline). */
const BEFORE = process.env.BEFORE_LABEL ?? "before";
const MIDDLE = process.env.MIDDLE_LABEL ?? "first round";
const BEFORE_NOTE = process.env.BEFORE_NOTE ?? `"before" is the camera at bd4b185 through the same harness.`;
const f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : "–");
const f0 = (x) => (Number.isFinite(x) ? x.toFixed(0) : "–");
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : "–");

/** [label, getter, format, which way is better] */
const ROWS = [
  ["**Travel** (swinging, falling, running, standing)", null],
  ["Hero off-centre (outside the middle 60% across or the lower-middle band), %", (r) => r.phases.travel.offCentrePct, f1, "↓"],
  ["Hero off screen, %", (r) => r.phases.travel.offScreenPct, f1, "↓"],
  ["Hero's body under the HUD, %", (r) => r.phases.travel.hudClipPct, f1, "↓"],
  ["Hero's mean distance from the middle across, |NDC x|", (r) => r.phases.travel.heroX.mean, f2, "↓"],
  ["Camera inside a building, %", (r) => r.phases.travel.insideBuildingPct, f1, "↓"],
  ["Camera within 12 units of a solid, %", (r) => r.phases.travel.skimPct, f1, "↓"],
  ["Hero hidden behind geometry, %", (r) => r.phases.travel.blockedPct, f1, "↓"],
  ["FOV range, °", (r) => `${f1(r.phases.travel.fov.min)}–${f1(r.phases.travel.fov.max)}`, (x) => x, ""],
  ["**Swinging**", null],
  ["Yaw rate p95 / max, °/s", (r) => `${f0(r.phases.swing.yawRateDeg.p95)} / ${f0(r.phases.swing.yawRateDeg.max)}`, (x) => x, "↓"],
  ["Pitch rate p95 / max, °/s", (r) => `${f0(r.phases.swing.pitchRateDeg.p95)} / ${f0(r.phases.swing.pitchRateDeg.max)}`, (x) => x, "↓"],
  ["Angular acceleration p95, °/s²", (r) => r.phases.swing.accDeg.p95, f0, "↓"],
  ["Angular jerk p95, °/s³", (r) => r.phases.swing.jerkDeg.p95, f0, "↓"],
  ["Flips (view turning > 180°/s), frames", (r) => r.phases.swing.flips + r.phases.air.flips, f0, "↓"],
  ["Arm pops (> 12 units in a frame), frames", (r) => r.phases.swing.pops + r.phases.air.pops, f0, "↓"],
  ["Arm, mean units", (r) => r.phases.swing.arm.mean, f0, ""],
  ["**Looking ahead** (travel)", null],
  ["Next stop's waypoint pin on screen (not the edge arrow), %", (r) => r.ahead.stopPinPct, f1, "↑"],
  ["Next stop itself in view and unhidden, %", (r) => r.ahead.stopSeenPct, f1, "↑"],
  ["… within 1500 / 1500–3000 / past 3000 units, %", (r) => `${f1(r.ahead.stopSeenByDist.under1500)} / ${f1(r.ahead.stopSeenByDist["1500to3000"])} / ${f1(r.ahead.stopSeenByDist.over3000)}`, (x) => x, "↑"],
  ["Last 2.5 s before a stop: stop in view, %", (r) => r.ahead.arrivingStopSeenPct, f1, "↑"],
  ["Web anchor on screen while swinging, %", (r) => r.ahead.anchorSeenPct, f1, "↑"],
  ["View vs the way to the stop, mean / p95 °", (r) => `${f0(r.ahead.stopBearingDeg.mean)} / ${f0(r.ahead.stopBearingDeg.p95)}`, (x) => x, "↓"],
  ["**Standing still** (after GO, after errands)", null],
  ["Next stop in view and unhidden, %", (r) => r.stand.stopSeenPct, f1, "↑"],
  ["View vs the way to the stop, mean °", (r) => r.stand.stopBearingDeg.mean, f0, "↓"],
  ["Hero across (NDC, − is left of centre), mean |x|", (r) => r.phases.stand.heroX.mean, f2, ""],
  ["Looking down, mean °", (r) => r.phases.stand.pitchDownDeg.mean, f1, ""],
  ["Flips, frames", (r) => r.phases.stand.flips, f0, "↓"],
  ["**Errands** (the sheet open)", null],
  ["Hero and ally both shown: apart, on screen, clear of the sheet and HUD, %", (r) => r.errand.pairShownPct, f1, "↑"],
  ["… apart (neither hides the other), %", (r) => r.errand.pairApartPct, f1, "↑"],
  ["**Countdown** (2.4 s)", null],
  ["Hero on screen, %", (r) => 100 - r.phases.intro.offScreenPct, f1, "↑"],
  ["Camera arm, mean units (an establishing shot backs off)", (r) => r.phases.intro.arm.mean, f0, ""],
  ["Yaw rate max, °/s", (r) => r.phases.intro.yawRateDeg.max, f0, "↓"],
  ["**End of the night** (outro and results)", null],
  ["Camera inside a building, %", (r) => r.phases.outro.insideBuildingPct, f1, "↓"],
  ["Flips, frames", (r) => r.phases.outro.flips, f0, "↓"],
  ["Yaw rate p95, °/s", (r) => r.phases.outro.yawRateDeg.p95, f0, "↓"],
  ["**Fights** (control: the fight camera is grounded-fights', unchanged here)", null],
  ["Live fight: both fighters in frame, %", (r) => r.fightLive?.bothFramedPct, f1, ""],
  ["Live fight: camera inside a building, %", (r) => r.fightLive?.insideBuildingPct, f1, ""],
  ["Live fight: camera height bob p95, units", (r) => r.fightLive?.bobP95, f1, ""],
  ["Encounter, fight and its end: hero off-centre, %", (r) => r.phases.fight.offCentrePct, f1, ""],
  ["Encounter, fight and its end: flips, frames", (r) => r.phases.fight.flips, f0, ""],
];

const STEADY = [
  ["**Steady camera / reduced motion**", null],
  ["Travel FOV range, °", (r) => `${f1(r.phases.travel.fov.min)}–${f1(r.phases.travel.fov.max)}`, (x) => x, ""],
  ["Countdown arm, mean units (no crane)", (r) => r.phases.intro.arm.mean, f0, ""],
  ["Errands: both shown, %", (r) => r.errand.pairShownPct, f1, "↑"],
];

function table(rows, b, a, name, p = null) {
  const out = p ? [`| ${name} | ${BEFORE} | ${MIDDLE} | after |`, "|---|---:|---:|---:|"] : [`| ${name} | ${BEFORE} | after |`, "|---|---:|---:|"];
  for (const [label, get, fmt] of rows) {
    if (!get) {
      out.push(p ? `| ${label} | | | |` : `| ${label} | | |`);
      continue;
    }
    out.push(p ? `| ${label} | ${fmt(get(b))} | ${fmt(get(p))} | ${fmt(get(a))} |` : `| ${label} | ${fmt(get(b))} | ${fmt(get(a))} |`);
  }
  return out.join("\n");
}

const nights = after.nights.join(", ");
console.log(`# Camera angles: before and after\n`);
console.log(`Six guest nights (${nights}) played by the bot through the real sim, the loop's phases replayed at 60 fps: the 3-2-1 countdown, 3 s standing after GO and 2 s after each errand, 0.9 s of the stick held right, the errand sheet's 1.4 s, the outro and 3 s of results. The camera is fed as scene/engine.ts feeds it (scripts/camera/rig.ts); ${BEFORE_NOTE} HUD boxes measured on the page at each size (the phone's power arc as its five buttons).${previous ? ` ${process.env.MIDDLE_NOTE ?? "\"First round\" is the pass's first after (e686961), before the phone follow-up."}` : ""} Generated by apps/wgp/scripts/camera/metrics.ts and launch/brand/hero/camera-table.mjs.\n`);
for (const vp of ["desktop", "phone"]) {
  const size = vp === "desktop" ? "1920×1080, mouse" : "390×844, touch (iPhone safe areas)";
  console.log(`## ${vp === "desktop" ? "Desktop" : "Phone"} (${size}), ${after[vp].frames} frames\n`);
  console.log(table(ROWS, before[vp], after[vp], "Metric", previous ? previous[vp] : null));
  console.log("");
  console.log(table(STEADY, beforeSteady[vp], afterSteady[vp], "Steady"));
  console.log("");
}
