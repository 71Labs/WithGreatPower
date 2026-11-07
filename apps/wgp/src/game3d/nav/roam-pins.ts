/**
 * What free roam's maps show, and where the tracked task's next step is, from a frame's
 * `roam`. Shared by the big city map, the minimap and the waypoint, so the three always
 * agree. Pure: no DOM.
 *
 * - The tracked task: the one you picked on the map while it isn't done, else the first under
 *   way. Its next step is the waypoint's target and the map's red ring.
 * - A task's next step: its giver until it's picked up; then the task's own `next` mark (v1.9
 *   `roam.marks`: the race's gates, the relays) when it has one, else its nearest open mark;
 *   else the pickpocket bot while it runs, the nearest pixel or tag still to find, and the
 *   person to hand it in to.
 * - Pins: everything on the map, each with a kind (its icon), whether it's done (drawn
 *   checked and faded), whether it's the tracked task's (others' are dimmed) and a label.
 */
import { FOLKS, RELAY_NAMES, TASKS, TASK_DONE, TASK_IDS, type TaskId } from "@wgp/game-core/city";
import type { RoamFrame, RoamMark, Vec3 } from "@wgp/game-core/sim3d/contract";
import type { RoamWorld } from "@wgp/game-core/sim3d/roam";

import { compass, metres } from "./map";

export type TargetKind = "folk" | "bot" | "pixel" | "tag" | "gate" | "relay";

/** Where a task's next step is. */
export interface RoamTarget {
  task: TaskId;
  at: Vec3;
  /** Who or what, mid-sentence: "Dev", "the pickpocket bot", "the nearest pixel", "gate 3". */
  who: string;
  kind: TargetKind;
}

type TaskState = { id: string; stage: number; got: number };

const stageOf = (roam: Pick<RoamFrame, "tasks">, id: TaskId) => roam.tasks.find((t) => t.id === id)?.stage ?? 0;
const flat = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.z - b.z);
const isTask = (id: string): id is TaskId => (TASK_IDS as readonly string[]).includes(id);

/** The task's marks in the frame (none on a frame from before v1.9). */
export function marksOf(roam: Pick<RoamFrame, "marks">, task?: TaskId): RoamMark[] {
  const all = roam.marks ?? [];
  return task ? all.filter((m) => m.task === task) : all;
}

/** A mark's name in a sentence: "gate 3" (its place in the race), "the next relay". */
export function markName(marks: readonly RoamMark[], m: RoamMark, world?: RoamWorld): string {
  if (m.kind === "gate") return `gate ${marks.filter((x) => x.task === m.task && x.kind === "gate").indexOf(m) + 1}`;
  // Relays are marked in the world's own order (render.ts), so the n-th relay mark is world.relays[n].
  const key = world?.relays[marks.filter((x) => x.task === m.task && x.kind === "relay").indexOf(m)]?.key;
  if (key) return `the relay on ${RELAY_NAMES[key]}`;
  return m.next ? "the next relay" : "a relay";
}

function nearest<T>(list: readonly T[], at: (t: T) => Vec3, from: Vec3): T | null {
  let best: T | null = null;
  let d = Infinity;
  for (const t of list) {
    const dd = flat(at(t), from);
    if (dd < d) {
      d = dd;
      best = t;
    }
  }
  return best;
}

/** Where a task's next step is, or null (done, or nothing to point at). */
export function taskTarget(id: TaskId, roam: RoamFrame, hero: Vec3, world: RoamWorld): RoamTarget | null {
  const stage = stageOf(roam, id);
  if (stage === TASK_DONE) return null;
  const giver = world.folks.find((f) => f.gives === id) ?? null;
  const taker = world.folks.find((f) => f.takes === id) ?? null;
  const folk = (f: RoamWorld["folks"][number]): RoamTarget => ({ task: id, at: { x: f.x, y: f.y, z: f.z }, who: FOLKS[f.key]?.name ?? "them", kind: "folk" });
  if (stage === 0) return giver ? folk(giver) : null;
  // The task's own marks: the one it says is next, else the nearest still open.
  const marks = marksOf(roam, id);
  const open = marks.filter((m) => !m.done);
  const mark = open.find((m) => m.next) ?? nearest(open, (m) => m.pos, hero);
  if (mark) return { task: id, at: mark.pos, who: markName(roam.marks ?? [], mark, world), kind: mark.kind };
  if (id === "pickpocket" && stage === 1) return roam.bot && roam.bot.state !== "caught" ? { task: id, at: roam.bot.pos, who: "the pickpocket bot", kind: "bot" } : null;
  if (id === "pixels" && stage === 1) {
    const p = nearest(
      roam.pixels.filter((x) => !x.found),
      (x) => x.pos,
      hero,
    );
    return p ? { task: id, at: p.pos, who: "the nearest pixel", kind: "pixel" } : null;
  }
  if (id === "graffiti" && stage === 1) {
    const t = nearest(
      roam.tags.filter((x) => !x.shot),
      (x) => x.pos,
      hero,
    );
    return t ? { task: id, at: t.pos, who: "the nearest tag", kind: "tag" } : null;
  }
  // Front-run between tries (stage 1, no race running): back to Gwei's stall to race again.
  if (id === "frontrun" && stage === 1) return giver ? folk(giver) : null;
  const back = taker ?? giver;
  return back ? folk(back) : null;
}

/** The task the HUD follows: the one picked while it isn't done, else the first under way, else none. */
export function trackedTask(tasks: readonly TaskState[], picked: TaskId | null): TaskId | null {
  const stage = (id: string) => tasks.find((t) => t.id === id)?.stage ?? 0;
  if (picked && stage(picked) !== TASK_DONE) return picked;
  const on = tasks.find((t) => isTask(t.id) && t.stage > 0 && t.stage < TASK_DONE);
  return on ? (on.id as TaskId) : null;
}

/** The map's line about the tracked task: "Stop, thief.exe: Dev is 74 m east of you." */
export function whereLine(target: RoamTarget | null, hero: Vec3, allDone: boolean): string {
  if (!target) return allDone ? "Every task’s done. The pages and the masts are still out there." : "Talk to someone with a gold marker to pick up a task.";
  const dx = target.at.x - hero.x;
  const dz = target.at.z - hero.z;
  const m = metres(Math.hypot(dx, dz));
  const title = TASKS[target.task]?.title ?? "Your task";
  return m < 3 ? `${title}: ${target.who} is right here.` : `${title}: ${target.who} is ${m} m ${compass(dx, dz)} of you.`;
}

/* ------------------------------------------------------------------ pins */

export type PinKind = "giver" | "page" | "view" | "pixel" | "tag" | "bot" | "gate" | "relay";

export interface RoamPin {
  key: string;
  kind: PinKind;
  x: number;
  z: number;
  /** Found, synced, photographed, passed, unplugged, or (a giver) the task's finished. */
  done: boolean;
  /** Belongs to the tracked task (drawn on top, full strength); false for others' pins. */
  tracked: boolean;
  /** For a screen reader's list and a tooltip: "Gate 2, passed", "Mary Jpeg: Lossless". */
  label: string;
  task?: TaskId;
  /** A giver's cast id (their face), a gate's number. */
  cast?: string | null;
  initial?: string;
  order?: number;
  /** A mark the task says is next. */
  next?: boolean;
}

/**
 * Everything the maps pin, bottom to top: masts, pages (once their district is synced, found
 * ones always), pixels and tags while their task is on, task marks, the bot, the givers.
 */
export function roamPins(roam: RoamFrame, world: RoamWorld, tracked: TaskId | null): RoamPin[] {
  const pins: RoamPin[] = [];
  const synced = new Set(world.views.map((v, i) => (roam.views[i]?.synced ? v.district : null)).filter(Boolean));
  roam.views.forEach((v, i) => {
    pins.push({ key: `v${i}`, kind: "view", x: v.pos.x, z: v.pos.z, done: v.synced, tracked: true, label: v.synced ? "Viewpoint, synced" : "Viewpoint to sync" });
  });
  roam.pages.forEach((p, i) => {
    if (!p.found && !synced.has(world.pages[i]?.district)) return;
    pins.push({ key: `p${i}`, kind: "page", x: p.pos.x, z: p.pos.z, done: p.found, tracked: true, label: p.found ? "Daily Rug page, found" : "Daily Rug page" });
  });
  if (stageOf(roam, "pixels") === 1)
    roam.pixels.forEach((p, i) => {
      if (!p.found) pins.push({ key: `x${i}`, kind: "pixel", x: p.pos.x, z: p.pos.z, done: false, tracked: tracked === "pixels", task: "pixels", label: "Mary’s pixel" });
    });
  if (stageOf(roam, "graffiti") === 1)
    roam.tags.forEach((t, i) => {
      if (!t.shot) pins.push({ key: `t${i}`, kind: "tag", x: t.pos.x, z: t.pos.z, done: false, tracked: tracked === "graffiti", task: "graffiti", label: "Gas Goblin’s tag" });
    });
  const marks = marksOf(roam);
  marks.forEach((m, i) => {
    const name = markName(marks, m, world);
    const order = m.kind === "gate" ? Number(name.slice(5)) : undefined;
    const label = `${name.charAt(0).toUpperCase()}${name.slice(1)}${m.done ? (m.kind === "gate" ? ", passed" : ", unplugged") : ""}`;
    pins.push({ key: `m${i}`, kind: m.kind, x: m.pos.x, z: m.pos.z, done: m.done, tracked: tracked === m.task, task: m.task, order, next: m.next && !m.done, label });
  });
  if (roam.bot && roam.bot.state !== "caught" && stageOf(roam, "pickpocket") === 1)
    pins.push({ key: "bot", kind: "bot", x: roam.bot.pos.x, z: roam.bot.pos.z, done: false, tracked: tracked === "pickpocket", task: "pickpocket", label: "The pickpocket bot" });
  for (const f of world.folks) {
    if (!f.gives) continue;
    const st = stageOf(roam, f.gives);
    const name = FOLKS[f.key]?.name ?? "Someone";
    pins.push({
      key: `f${f.id}`,
      kind: "giver",
      x: f.x,
      z: f.z,
      done: st === TASK_DONE,
      tracked: tracked === f.gives,
      task: f.gives,
      cast: f.cast,
      initial: name.replace(/^(Ms|Mrs|Mr|The|J\.) /, "").slice(0, 1),
      label: `${name}: ${TASKS[f.gives]?.title ?? "a task"}${st === TASK_DONE ? ", done" : st > 0 ? ", under way" : ", new"}`,
    });
  }
  // The tracked task's pins on top of everyone else's.
  return [...pins.filter((p) => !(p.task && p.tracked)), ...pins.filter((p) => p.task && p.tracked)];
}
