/**
 * The city's materials and the uniforms they share. One `SharedUniforms` object holds every
 * value that changes per frame (time, pixel ratio, px → world scale, the occlusion cone) or
 * per city and tier (fog, the halftone switch), and each material references the same
 * uniform objects, so the frame loop updates them once.
 */
import { BackSide, FrontSide, ShaderMaterial, Texture, Vector2, Vector3, Vector4, type IUniform } from "three";

import { C, FOG, HALFTONE, INK_PX, type RGB } from "../palette";
import { BILLBOARD_GRID } from "./billboard-atlas";
import { GROUND_FRAGMENT, GROUND_VERTEX, HULL_FRAGMENT, HULL_VERTEX, TOON_FRAGMENT, TOON_VERTEX } from "./shaders";
import { OCCLUSION } from "./occlusion";
import { LAMP, MAX_STREETS, type StreetGrid } from "./streets";

const v3 = (c: RGB) => new Vector3(c[0], c[1], c[2]);

export interface SharedUniforms {
  uTime: IUniform<number>;
  uDpr: IUniform<number>;
  /** World units per CSS px at view depth 1: 2·tan(fov/2) / viewport height (CSS px). */
  uPxScale: IUniform<number>;
  uCrease: IUniform<number>;
  uHullPx: IUniform<Vector4>;
  uFogBands: IUniform<Vector3>;
  uFogAmt: IUniform<Vector4>;
  uFog: IUniform<Vector3>;
  uInk: IUniform<Vector3>;
  /** The occlusion cone: the camera, the two ends it runs to (w: on), and its radii. */
  uOccCam: IUniform<Vector3>;
  uOccA: IUniform<Vector4>;
  uOccB: IUniform<Vector4>;
  uOccR: IUniform<Vector4>;
  /** The hero (w: on): what it stands over never fades. */
  uOccHero: IUniform<Vector4>;
  /** Ben-Day dots on (1) or off (0), their cell in CSS px, and the dot radii (shadow, side, far 2, far 3). */
  uHalftone: IUniform<number>;
  uHalftoneCell: IUniform<number>;
  uHalftoneDots: IUniform<Vector4>;
}

export function createSharedUniforms(): SharedUniforms {
  return {
    uTime: { value: 0 },
    uDpr: { value: 1 },
    uPxScale: { value: 0.001 },
    uCrease: { value: INK_PX.crease },
    uHullPx: { value: new Vector4(INK_PX.hullNear, INK_PX.hullFar, INK_PX.hullDepthNear, INK_PX.hullDepthFar) },
    uFogBands: { value: new Vector3(FOG.bands[0], FOG.bands[1], FOG.bands[2]) },
    uFogAmt: { value: new Vector4(FOG.amount[0], FOG.amount[1], FOG.amount[2], FOG.amount[3]) },
    uFog: { value: v3(FOG.color) },
    uInk: { value: v3(C.ink) },
    uOccCam: { value: new Vector3() },
    uOccA: { value: new Vector4() },
    uOccB: { value: new Vector4() },
    uOccR: { value: new Vector4(OCCLUSION.outerCam, OCCLUSION.outerEnd, OCCLUSION.innerCam, OCCLUSION.innerEnd) },
    uOccHero: { value: new Vector4() },
    uHalftone: { value: 1 },
    uHalftoneCell: { value: HALFTONE.cell },
    uHalftoneDots: { value: new Vector4(HALFTONE.shadow, HALFTONE.side, HALFTONE.far[0], HALFTONE.far[1]) },
  };
}

export function toonMaterial(shared: SharedUniforms, atlas: Texture | null, tank = false): ShaderMaterial {
  return new ShaderMaterial({
    name: tank ? "wgp-toon-tank" : "wgp-toon",
    vertexShader: TOON_VERTEX,
    fragmentShader: TOON_FRAGMENT,
    defines: tank ? { TANK: "" } : {},
    side: FrontSide,
    uniforms: {
      ...shared,
      uRoof: { value: v3(C.rooftop) },
      uLit: { value: v3(C.windowLit) },
      uWarm: { value: v3(C.windowWarm) },
      uDark: { value: v3(C.windowDark) },
      uPaper: { value: v3(C.paper) },
      uRed: { value: v3(C.neonRed) },
      uMint: { value: v3(C.neonMint) },
      uCrane: { value: v3(C.crane) },
      uTank: { value: v3(C.waterTower) },
      uTankBand: { value: v3(C.waterTowerBand) },
      uStreet: { value: v3(C.street) },
      uTar: { value: v3(C.tar) },
      uGravel: { value: v3(C.gravel) },
      uAtlas: { value: atlas },
      uAtlasGrid: { value: new Vector2(BILLBOARD_GRID.cols, BILLBOARD_GRID.rows) },
    },
  });
}

export function hullMaterial(shared: SharedUniforms): ShaderMaterial {
  return new ShaderMaterial({
    name: "wgp-hull",
    vertexShader: HULL_VERTEX,
    fragmentShader: HULL_FRAGMENT,
    side: BackSide,
    uniforms: { ...shared },
  });
}

export function groundMaterial(shared: SharedUniforms, streets: StreetGrid, bounds: { x0: number; z0: number; x1: number; z1: number }, river: { x0: number; z0: number; x1: number; z1: number } | null): ShaderMaterial {
  const origin = streets.lampOrigin;
  const pack = (list: { c: number; w: number }[]) => {
    const c = new Float32Array(MAX_STREETS);
    const w = new Float32Array(MAX_STREETS);
    list.slice(0, MAX_STREETS).forEach((s, i) => {
      c[i] = s.c;
      w[i] = s.w;
    });
    return { c, w, n: Math.min(MAX_STREETS, list.length) };
  };
  const xs = pack(streets.xs);
  const zs = pack(streets.zs);
  return new ShaderMaterial({
    name: "wgp-ground",
    vertexShader: GROUND_VERTEX,
    fragmentShader: GROUND_FRAGMENT,
    uniforms: {
      ...shared,
      uStreetX: { value: xs.c },
      uStreetXW: { value: xs.w },
      uStreetXN: { value: xs.n },
      uStreetZ: { value: zs.c },
      uStreetZW: { value: zs.w },
      uStreetZN: { value: zs.n },
      uBounds: { value: new Vector4(bounds.x0, bounds.z0, bounds.x1, bounds.z1) },
      uRiver: { value: river ? new Vector4(river.x0, river.z0, river.x1, river.z1) : new Vector4(1, 1, 0, 0) },
      uStreet: { value: v3(C.street) },
      uCurb: { value: v3(C.curb) },
      uSidewalk: { value: v3(C.sidewalk) },
      uCurbEdge: { value: v3(C.curbEdge) },
      uPool: { value: v3(C.lampPool) },
      uPaper: { value: v3(C.paper) },
      uLine: { value: v3(C.streetLine) },
      uWater: { value: v3(C.water) },
      uFoam: { value: v3(C.cable) },
      uLamps: { value: new Vector3(LAMP.spacing, LAMP.curb, LAMP.pool) },
      uLampOrigin: { value: new Vector2(origin.x, origin.z) },
    },
  });
}
