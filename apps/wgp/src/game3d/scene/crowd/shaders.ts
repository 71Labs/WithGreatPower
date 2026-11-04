/**
 * The crowd's shaders: the cast's own (characters/cast-shaders.ts: the cel bands, the baked
 * AO, the painted face, the ink hull, fog and the cloak's dither), so a passer-by is lit and
 * inked exactly like the cast, with three changes made on the cast's source:
 *
 * - Every civilian body sits in one geometry, each vertex tagged with its body (`aVariant`);
 *   an instance draws only its own (`aCrowd.x`), the rest fall outside the clip volume
 *   before any skinning.
 * - The palette comes per person from a looks texture (`uLooks`, a row per look): the same
 *   slots (skin, hair, top, …), each person's colours.
 * - Each instance carries its own dither fade and fog (`aCrowd.z`, `aCrowd.w`).
 *
 * The edits are made on the cast's GLSL by exact anchors; if the cast's shaders change under
 * them, this throws at load (and in the tests), rather than drawing the crowd differently.
 */
import { CAST_FRAGMENT, CAST_HULL_VERTEX, CAST_VERTEX } from "../characters/cast-shaders";
import { HULL_FRAGMENT } from "../characters/shaders";

export function patchShader(src: string, name: string, edits: [string, string][]): string {
  let out = src;
  for (const [from, to] of edits) {
    if (!out.includes(from)) throw new Error(`crowd shader: ${name} has no ${JSON.stringify(from)} (has the cast's shader changed?)`);
    out = out.split(from).join(to);
  }
  return out;
}

const VERTEX_PARS = /* glsl */ `
attribute float aVariant;
attribute vec4 aCrowd;   // body, look, fade, fog
flat varying float vLook;
flat varying float vFadeI;
flat varying float vFogI;
`;

/** Not this instance's body: outside the clip volume, so its triangles are culled whole. */
const EARLY_OUT = /* glsl */ `
  if (abs(aVariant - aCrowd.x) > 0.5) {
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    return;
  }
  vLook = aCrowd.y;
  vFadeI = aCrowd.z;
  vFogI = aCrowd.w;
`;

export const CROWD_VERTEX = patchShader(CAST_VERTEX, "CAST_VERTEX", [["void main() {", `${VERTEX_PARS}\nvoid main() {\n${EARLY_OUT}`]]);

export const CROWD_HULL_VERTEX = patchShader(CAST_HULL_VERTEX, "CAST_HULL_VERTEX", [["void main() {", `${VERTEX_PARS}\nvoid main() {\n${EARLY_OUT}`]]);

const FRAGMENT_PARS = /* glsl */ `
uniform highp sampler2D uLooks;
flat varying float vLook;
flat varying float vFadeI;
flat varying float vFogI;
vec3 lookPal(int i) { return texelFetch(uLooks, ivec2(i, int(vLook + 0.5)), 0).rgb; }
`;

export const CROWD_FRAGMENT = patchShader(CAST_FRAGMENT, "CAST_FRAGMENT", [
  ["void main() {", `${FRAGMENT_PARS}\nvoid main() {`],
  ["if (uFade > 0.0 && bayer4(gl_FragCoord.xy) < uFade) discard;", "float fadeI = max(uFade, vFadeI);\n  if (fadeI > 0.0 && bayer4(gl_FragCoord.xy) < fadeI) discard;"],
  ["uPal[pi]", "lookPal(pi)"],
  ["uPal[fill]", "lookPal(fill)"],
  ["uPal[0]", "lookPal(0)"],
  ["mix(col, uFog, uFogMix)", "mix(col, uFog, max(uFogMix, vFogI))"],
]);

export const CROWD_HULL_FRAGMENT = patchShader(HULL_FRAGMENT, "HULL_FRAGMENT", [
  ["void main() {", "flat varying float vFadeI;\nflat varying float vFogI;\nvoid main() {"],
  ["if (uFade > 0.0 && bayer4(gl_FragCoord.xy) < uFade) discard;", "float fadeI = max(uFade, vFadeI);\n  if (fadeI > 0.0 && bayer4(gl_FragCoord.xy) < fadeI) discard;"],
  ["uFogMix * 0.5", "max(uFogMix, vFogI) * 0.5"],
]);
