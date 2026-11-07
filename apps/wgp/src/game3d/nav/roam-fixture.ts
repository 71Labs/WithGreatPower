/**
 * Fixture free-roam frames for the HUD's tests and its development preview: a whole RoamFrame
 * laid out from the roam world (everyone in place, nothing found), progress set per task, and
 * v1.9 map marks (the race's six gates, the four relays) placed round a point, before the task
 * builds send real ones. Never used by the sim or the scene.
 */
import { TASK_DONE, TASK_IDS, type TaskId } from "@wgp/game-core/city";
import type { RenderFrame3D, RoamFrame, RoamMark, Vec3 } from "@wgp/game-core/sim3d/contract";
import type { RoamWorld } from "@wgp/game-core/sim3d/roam";

export interface RoamFixture {
  /** Per task: its stage (default 0) and how many of its items are found (pixels, photos: the first ones). */
  stage?: Partial<Record<TaskId, number>>;
  got?: Partial<Record<TaskId, number>>;
  /** Pages found and viewpoints synced, by index. */
  pages?: number[];
  views?: number[];
  marks?: RoamMark[];
  /** The pickpocket bot, while it runs. */
  bot?: Vec3 | null;
}

const v3 = (p: { x: number; y: number; z: number }): Vec3 => ({ x: p.x, y: p.y, z: p.z });

/** A whole RoamFrame from the world, with the given progress. */
export function roamFrameFixture(world: RoamWorld, f: RoamFixture = {}): RoamFrame {
  const stage = (id: TaskId) => f.stage?.[id] ?? 0;
  const got = (id: TaskId) => f.got?.[id] ?? 0;
  return {
    move: "ground",
    moveT: 0,
    sprint: false,
    wall: null,
    path: null,
    zip: null,
    bot: f.bot ? { pos: f.bot, vel: { x: 0, y: 0, z: 0 }, state: "running" } : null,
    folks: world.folks.map((p) => ({ id: p.id, key: p.key, pos: v3(p), yaw: p.yaw, body: p.body, cast: p.cast, talking: false })),
    chat: null,
    act: null,
    pages: world.pages.map((p, i) => ({ pos: v3(p), found: !!f.pages?.includes(i) })),
    views: world.views.map((p, i) => ({ pos: v3(p), roof: p.roof, synced: !!f.views?.includes(i) })),
    pixels: world.pixels.map((p, i) => ({ pos: v3(p), found: stage("pixels") >= 2 || i < got("pixels") })),
    tags: world.tags.map((t, i) => ({ pos: v3(t), normal: { x: t.nx, y: 0, z: t.nz }, shot: stage("graffiti") >= 2 || i < got("graffiti") })),
    tasks: TASK_IDS.map((id) => ({ id, stage: stage(id), got: stage(id) === TASK_DONE ? 0 : got(id) })),
    cars: [],
    knock: null,
    marks: f.marks ?? [],
  };
}

/** A render frame around a RoamFrame: the hero at `hero`, facing `facing`. Only what the HUD reads is real. */
export function renderFrameFixture(roam: RoamFrame, hero: Vec3, facing: Vec3 = { x: 0, y: 0, z: -1 }): RenderFrame3D {
  return {
    tick: 0,
    alpha: 1,
    hero: { pos: hero, vel: { x: 0, y: 0, z: 0 }, anchor: null, grounded: true, hp: 100, maxHp: 100, fluid: 1, hurtFlash: 0, shield: false, facing },
    roam,
  } as unknown as RenderFrame3D;
}

/**
 * The race's six gates in a ring round `at` (radius `r`), passed up to `passed` (the next one
 * after them marked next); or four relays at the corners of a square round it, `unplugged` of
 * them done and the nearest open one next.
 */
export function marksFixture(kind: "gate" | "relay", task: TaskId, at: Vec3, opts: { r?: number; passed?: number; unplugged?: number } = {}): RoamMark[] {
  const r = opts.r ?? 1400;
  if (kind === "gate") {
    const passed = opts.passed ?? 2;
    return Array.from({ length: 6 }, (_, i) => {
      const a = (i / 6) * Math.PI * 2;
      return { task, kind, pos: { x: at.x + Math.cos(a) * r, y: 400, z: at.z + Math.sin(a) * r }, done: i < passed, next: i === passed };
    });
  }
  const unplugged = opts.unplugged ?? 1;
  const corners = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([sx, sz], i) => ({ task, kind, pos: { x: at.x + sx * r * (1 + i * 0.15), y: 900, z: at.z + sz * r }, done: i < unplugged, next: false }));
  const open = corners.filter((m) => !m.done);
  let best = open[0];
  for (const m of open) if (Math.hypot(m.pos.x - at.x, m.pos.z - at.z) < Math.hypot(best.pos.x - at.x, best.pos.z - at.z)) best = m;
  if (best) best.next = true;
  return corners;
}
