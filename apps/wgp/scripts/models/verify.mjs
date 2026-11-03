/**
 * Checks packed models against the originals, as three.js loads them: the same meshes, bones,
 * extras and clips, the same vertex and triangle counts, and how far any value moved (per
 * attribute; vertex order is free, so each component's sorted values are compared).
 *
 *   node apps/wgp/scripts/models/verify.mjs <originals dir> [<packed dir>]
 *
 * (packed dir defaults to apps/wgp/public/models; run from the repo with apps/wgp installed.)
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const [origDir, packedDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "public", "models")] = process.argv.slice(2);
const load = (file) => {
  const b = readFileSync(file);
  return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), "");
};

function meshes(scene) {
  const out = new Map();
  scene.traverse((o) => {
    if (o.isSkinnedMesh) out.set(o.name, o);
  });
  return out;
}

/** Largest change of any component, comparing sorted values (vertex order may differ). */
function moved(a, b) {
  let abs = 0;
  let rel = 0;
  for (let c = 0; c < a.itemSize; c++) {
    const x = Float64Array.from({ length: a.count }, (_, i) => a.getComponent(i, c)).sort();
    const y = Float64Array.from({ length: b.count }, (_, i) => b.getComponent(i, c)).sort();
    let span = 0;
    for (let i = 0; i < x.length; i++) span = Math.max(span, Math.abs(x[i]));
    for (let i = 0; i < x.length; i++) {
      const d = Math.abs(x[i] - y[i]);
      abs = Math.max(abs, d);
      rel = Math.max(rel, span ? d / span : 0);
    }
  }
  return { abs, rel };
}

let worst = 0;
let failed = false;
const fail = (m) => {
  failed = true;
  console.log(`  FAIL ${m}`);
};
for (const name of readdirSync(origDir).filter((f) => f.endsWith(".glb")).sort()) {
  const [a, b] = await Promise.all([load(join(origDir, name)), load(join(packedDir, name))]);
  const lines = [];
  const ma = meshes(a.scene);
  const mb = meshes(b.scene);
  if ([...ma.keys()].join() !== [...mb.keys()].join()) fail(`${name}: meshes ${[...ma.keys()]} vs ${[...mb.keys()]}`);
  for (const [mesh, sa] of ma) {
    const sb = mb.get(mesh);
    if (!sb) continue;
    if (JSON.stringify(sa.userData) !== JSON.stringify(sb.userData)) fail(`${name} ${mesh}: extras differ`);
    if (sa.skeleton.bones.map((x) => x.name).join() !== sb.skeleton.bones.map((x) => x.name).join()) fail(`${name} ${mesh}: bones differ`);
    const ga = sa.geometry;
    const gb = sb.geometry;
    if (ga.index.count !== gb.index.count) fail(`${name} ${mesh}: ${ga.index.count} vs ${gb.index.count} indices`);
    const parts = [];
    for (const attr of Object.keys(ga.attributes)) {
      if (attr === "color" || attr === "_prev") {
        if (gb.attributes[attr]) fail(`${name} ${mesh}: ${attr} kept`);
        continue;
      }
      const x = ga.attributes[attr];
      const y = gb.attributes[attr];
      if (!y) {
        fail(`${name} ${mesh}: lost ${attr}`);
        continue;
      }
      if (x.count !== y.count) fail(`${name} ${mesh} ${attr}: ${x.count} vs ${y.count} vertices`);
      if (x.normalized !== y.normalized || x.array.constructor !== y.array.constructor) fail(`${name} ${mesh} ${attr}: type changed`);
      const m = moved(x, y);
      worst = Math.max(worst, m.rel);
      parts.push(`${attr} ${m.rel.toExponential(1)}`);
    }
    lines.push(`  ${mesh}: ${ga.attributes.position.count} vertices, ${ga.index.count / 3} triangles; moved (of range) ${parts.join(", ")}`);
  }
  if (a.animations.length !== b.animations.length) fail(`${name}: ${a.animations.length} vs ${b.animations.length} clips`);
  let tracks = 0;
  let animWorst = 0;
  for (const [i, ca] of a.animations.entries()) {
    const cb = b.animations.find((c) => c.name === ca.name);
    if (!cb) {
      fail(`${name}: lost clip ${ca.name}`);
      continue;
    }
    if (Math.abs(ca.duration - cb.duration) > 1e-6) fail(`${name} ${ca.name}: duration`);
    for (const ta of ca.tracks) {
      const tb = cb.tracks.find((t) => t.name === ta.name);
      if (!tb) {
        fail(`${name} ${ca.name}: lost track ${ta.name}`);
        continue;
      }
      tracks++;
      if (ta.times.length !== tb.times.length || ta.times.some((t, k) => t !== tb.times[k])) fail(`${name} ${ca.name} ${ta.name}: times`);
      for (let k = 0; k < ta.values.length; k++) animWorst = Math.max(animWorst, Math.abs(ta.values[k] - tb.values[k]));
    }
    void i;
  }
  if (tracks) lines.push(`  ${a.animations.length} clips, ${tracks} tracks; largest keyframe change ${animWorst.toExponential(1)}`);
  console.log(`${name}\n${lines.join("\n")}`);
}
console.log(failed ? "\nFAILED" : `\nOK: every mesh, bone, extra and clip kept; worst attribute change ${worst.toExponential(1)} of its range`);
process.exit(failed ? 1 : 0);
