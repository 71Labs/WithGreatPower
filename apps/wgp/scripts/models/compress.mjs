/**
 * Packs the game's body and clip files (public/models/*.glb) for the wire, in place:
 *
 * - drops the attributes the game never reads (COLOR_0 and `_prev`, build_cast.py's preview
 *   colours, which leak into some exports);
 * - rounds float data to the significant bits below (far under a pixel: 16 bits on a 1.9 m
 *   body is 30 µm), so the meshopt codec and the CDN's Brotli find runs of zeros. Values stay
 *   32-bit floats in the same units, so the loaders and shaders read them as before; no
 *   KHR_mesh_quantization, no dequantisation transforms in the skins;
 * - drops duplicate accessors, reorders each mesh for the vertex cache (the triangles and their
 *   vertices; the shapes and every vertex's data are unchanged), and writes the buffers with
 *   EXT_meshopt_compression, which three's GLTFLoader decodes with the MeshoptDecoder it ships
 *   (inline WebAssembly: nothing to host).
 *
 * Integers (joints, palette indices) and keyframe times are kept exact. Running it again on
 * packed files changes nothing that matters (rounding is idempotent).
 *
 *   apps/wgp/scripts/models/compress.sh            (installs the pinned tools in a temp dir)
 *   node compress.mjs <file.glb> ...               (from a dir where they're installed)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTMeshoptCompression } from "@gltf-transform/extensions";
import { dedup, reorder } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";

/** Significant bits kept per attribute (float32 has 24). Anything unlisted stays exact. */
const BITS = {
  POSITION: 16,
  NORMAL: 14,
  WEIGHTS_0: 14,
  _AO: 12,
  _WEB_P: 16,
  _WEB_Q: 16,
  _WEB_R: 16,
  _FACE: 16,
};
/** Keyframe values by target path; the times stay exact. */
const ANIM_BITS = { rotation: 16, translation: 16, scale: 16 };
/** Never read by the game (cast-asset.ts, hero-asset.ts). */
const DROP = new Set(["COLOR_0", "_PREV"]);

/** Round float32s to `bits` significant bits, to nearest (a carry into the exponent is fine). */
function round(array, bits) {
  if (!(array instanceof Float32Array) || bits >= 24) return array;
  const out = array.slice();
  const u = new Uint32Array(out.buffer, out.byteOffset, out.length);
  const drop = 24 - bits;
  const half = 1 << (drop - 1);
  const mask = ~((1 << drop) - 1) >>> 0;
  for (let i = 0; i < u.length; i++) {
    const e = (u[i] >>> 23) & 0xff;
    if (e === 0 || e === 0xff) continue;
    u[i] = ((u[i] + half) & mask) >>> 0;
  }
  return out;
}

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.encoder": MeshoptEncoder, "meshopt.decoder": MeshoptDecoder });

let before = 0;
let after = 0;
for (const file of process.argv.slice(2)) {
  const src = readFileSync(file);
  const doc = await io.readBinary(new Uint8Array(src.buffer, src.byteOffset, src.byteLength));
  const root = doc.getRoot();
  const seen = new Set();
  for (const mesh of root.listMeshes())
    for (const prim of mesh.listPrimitives())
      for (const semantic of prim.listSemantics()) {
        if (DROP.has(semantic)) {
          prim.setAttribute(semantic, null);
          continue;
        }
        const a = prim.getAttribute(semantic);
        if (seen.has(a)) continue;
        seen.add(a);
        a.setArray(round(a.getArray(), BITS[semantic] ?? 24));
      }
  for (const anim of root.listAnimations())
    for (const channel of anim.listChannels()) {
      const out = channel.getSampler()?.getOutput();
      if (!out || seen.has(out)) continue;
      seen.add(out);
      out.setArray(round(out.getArray(), ANIM_BITS[channel.getTargetPath()] ?? 24));
    }
  // The dropped attributes' accessors.
  for (const a of root.listAccessors()) if (a.listParents().every((p) => p.propertyType === "Root")) a.dispose();
  await doc.transform(dedup(), reorder({ encoder: MeshoptEncoder, target: "size" }));
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  const bin = await io.writeBinary(doc);
  writeFileSync(file, bin);
  before += src.length;
  after += bin.length;
  console.log(`${basename(file).padEnd(28)} ${String(src.length).padStart(8)} → ${String(bin.length).padStart(8)}`);
}
console.log(`${"total".padEnd(28)} ${String(before).padStart(8)} → ${String(after).padStart(8)}`);
