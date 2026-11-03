/**
 * Where the bodies and clips live (public/models, packed with meshopt by
 * scripts/models/compress.sh), and the order they come down in. No three.js here, so the
 * patrol page can start the night's first downloads before the 3D code has arrived.
 *
 * - The hero's body and clips go first: `prefetchHero` asks for them as soon as the 3D code
 *   is in, while the scene is still being built and its shaders compiled.
 * - The cast queue behind them, a couple at a time, in the order the night meets them, so
 *   they never take bandwidth from the hero or from each other's turn.
 *
 * Each file is fetched once, at its versioned URL (lib/assets.ts: cached for good); the loaders
 * parse the bytes (hero-asset.ts, cast-asset.ts).
 */
import { assetUrl } from "@/lib/assets";

import type { QualityTier } from "../quality";

/** The hero's two levels of detail: the full body, and the low tier's lighter one. */
export const HERO_MODEL = { hi: "/models/hero.glb", lo: "/models/hero-lo.glb" } as const;

/** The hero's motion-capture clips (Quaternius' UAL, CC0, retargeted by launch/brand/hero/retarget.py). */
export const HERO_ANIMS = "/models/hero-anims.glb";

/** The cast's extra motion: clips the hero doesn't use (retarget.py --cast). */
export const CAST_ANIMS = "/models/cast-anims.glb";

/** The hero's body file for a tier. */
export const heroModelUrl = (tier: QualityTier) => (tier === "low" ? HERO_MODEL.lo : HERO_MODEL.hi);

/** A cast member's body file: `cast-<id>.glb` (medium and high), `cast-<id>-lo.glb` (low). */
export function castModelUrl(id: string, low: boolean): string {
  return low ? `/models/cast-${id}-lo.glb` : `/models/cast-${id}.glb`;
}

const files = new Map<string, Promise<ArrayBuffer>>();

function get(url: string, priority: RequestPriority): Promise<ArrayBuffer> {
  return fetch(assetUrl(url), { priority }).then((r) => {
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    return r.arrayBuffer();
  });
}

/** A file's bytes, fetched once (now, ahead of anything queued). */
export function fetchModel(url: string): Promise<ArrayBuffer> {
  let p = files.get(url);
  if (!p) {
    p = get(url, "high");
    files.set(url, p);
    // A failed fetch can be asked for again (a flaky connection, a tier change).
    p.catch(() => files.delete(url));
  }
  return p;
}

/** Hand the bytes over once parsed: the loaders keep what they built, not the file. */
export function releaseModel(url: string): void {
  files.delete(url);
}

/* ------------------------------------------------------------------ the queue */

/** Files allowed down at once from the queue, once the hero's are in. */
const QUEUE_SLOTS = 2;
let gate: Promise<unknown> | null = null;
const waiting: { url: string; start: () => void }[] = [];
let running = 0;

function pump() {
  if (gate) return;
  while (running < QUEUE_SLOTS && waiting.length) {
    const next = waiting.shift()!;
    running++;
    next.start();
  }
}

/**
 * A file that waits its turn: behind the hero's files and `QUEUE_SLOTS` queued files ahead of
 * it, in the order asked (`urgent` jumps the queue: Gwei called into a fight).
 */
export function queueModel(url: string, urgent = false): Promise<ArrayBuffer> {
  const have = files.get(url);
  if (have) return have;
  const p = new Promise<ArrayBuffer>((resolve, reject) => {
    const item = {
      url,
      start: () =>
        get(url, "low")
          .then(resolve, reject)
          .finally(() => {
            running--;
            pump();
          }),
    };
    if (urgent) waiting.unshift(item);
    else waiting.push(item);
  });
  files.set(url, p);
  p.catch(() => files.delete(url));
  pump();
  return p;
}

/** When whatever holds the queue (the hero's files) has settled: at once if nothing does. */
export function queueSettled(): Promise<void> {
  return gate ? gate.then(() => {}) : Promise.resolve();
}

/** Hold the queue until these (the hero's files) have settled, loaded or not. */
export function queueAfter(first: Promise<unknown>): void {
  const g = (gate = Promise.allSettled([first]));
  void g.then(() => {
    if (gate !== g) return;
    gate = null;
    pump();
  });
}

/**
 * The night's first downloads, as early as the tier is known: the hero's body and clips, and
 * the glTF loader. The cast waits behind them.
 */
export function prefetchHero(tier: QualityTier): void {
  const first = Promise.all([fetchModel(heroModelUrl(tier)), fetchModel(HERO_ANIMS)]);
  queueAfter(first);
  import("./gltf").then(
    (m) => m.gltfLoader(),
    () => {
      // The loader comes with the first parse instead.
    },
  );
}
