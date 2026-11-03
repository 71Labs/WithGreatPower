/**
 * Pickups from the frame's v1.3 `pickups` (nothing at all when the sim doesn't send them):
 *
 * - Bits: a gold token sticker, camera-facing, with a constant 2.5 px ink rim, an inner
 *   ring and a paper sparkle. It spins (the quad narrows to its edge and back) and bobs.
 * - Boost rings: a cyan hoop standing across the route (its axis along the route segment
 *   nearest it), inked where the tube turns away from the camera, breathing a little.
 *
 * Reduced motion: no spin, no bob, no breathing. A pickup turning `taken` pops a burst
 * ("+5 BITS!", "BOOST!") through `onTaken`, once; one already taken when first seen (a
 * resumed run) doesn't. Instanced: two draw calls at most, none without pickups.
 */
import {
  BufferGeometry,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  TorusGeometry,
  Vector3,
} from "three";

import type { City, RenderFrame3D, Vec3 } from "@wgp/game-core/sim3d/contract";

import { NAV_COLORS } from "@/game3d/nav/colors";
import { routeDirAt, routeLine } from "@/game3d/nav/map";

import type { SharedUniforms } from "./city/materials";
import { C, rgb } from "./palette";

/** Token diameter (world units; the hero is 88 tall) and its smallest size on screen (CSS px). */
export const TOKEN_SIZE = 46;
const TOKEN_MIN_PX = 12;
/** Hoop radius and tube (world units): wide enough to swing through. */
export const RING_RADIUS = 74;
const RING_TUBE = 0.17;

const TOKEN_VERTEX = /* glsl */ `
attribute vec3 aCenter;
attribute vec2 aParams;  // x: width share (the spin), y: diameter in world units
uniform float uPxScale;
uniform float uMinPx;
varying vec2 vUv;
void main() {
  vec4 view = viewMatrix * vec4(aCenter, 1.0);
  float depth = max(1.0, -view.z);
  float size = max(aParams.y, uMinPx * depth * uPxScale);
  view.xy += vec2(position.x * aParams.x, position.y) * size;
  vUv = position.xy * 2.0;
  gl_Position = projectionMatrix * view;
}
`;

const TOKEN_FRAGMENT = /* glsl */ `
uniform vec3 uInk;
uniform vec3 uGold;
uniform vec3 uGoldDeep;
uniform vec3 uPaper;
uniform float uDpr;
varying vec2 vUv;
void main() {
  float r = length(vUv);
  if (r > 1.0) discard;
  // Screen-space widths, so the rim stays 2.5 px however far or edge-on the token is.
  float px = max(fwidth(r), 1e-4);
  vec3 c = uGold;
  if ((1.0 - r) / px < 2.5 * uDpr) c = uInk;
  else if (abs(r - 0.62) / px < 1.0 * uDpr) c = uInk;
  else if (r > 0.62) c = uGoldDeep;
  else {
    vec2 a = abs(vUv);
    if (sqrt(a.x) + sqrt(a.y) < 0.64) c = uPaper;
  }
  gl_FragColor = vec4(c, 1.0);
}
`;

const RING_VERTEX = /* glsl */ `
varying vec3 vN;
varying vec3 vView;
void main() {
  vec4 view = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * mat3(instanceMatrix) * normal);
  vView = view.xyz;
  gl_Position = projectionMatrix * view;
}
`;

const RING_FRAGMENT = /* glsl */ `
uniform vec3 uInk;
uniform vec3 uColor;
varying vec3 vN;
varying vec3 vView;
void main() {
  vec3 n = normalize(vN);
  float facing = abs(dot(n, normalize(-vView)));
  // A broad ink band where the tube turns away (about a sixth of its width each side), so the hoop reads as inked at any distance.
  vec3 c = n.y > 0.2 ? uColor : uColor * 0.8;
  gl_FragColor = vec4(facing < 0.56 ? uInk : c, 1.0);
}
`;

const MAX = 64;

export type PickupKind = "bits" | "ring";

/** The burst a pickup pops when taken. */
export const PICKUP_WORD: Record<PickupKind, string> = { bits: "+5 BITS!", ring: "BOOST!" };

export class Pickups {
  readonly root = new Group();
  reducedMotion = false;
  private readonly tokens: InstancedMesh;
  private readonly rings: InstancedMesh;
  private readonly tokenGeo: BufferGeometry;
  private readonly quad: PlaneGeometry;
  private readonly tokenMat: ShaderMaterial;
  private readonly ringMat: ShaderMaterial;
  private readonly center = new Float32Array(MAX * 3);
  private readonly params = new Float32Array(MAX * 2);
  private readonly centerAttr: InstancedBufferAttribute;
  private readonly paramsAttr: InstancedBufferAttribute;
  /** Last `taken` per pickup id, to pop each pickup once. */
  private readonly seen = new Map<number, boolean>();
  /** The route line the rings face along, rebuilt when the stop changes. */
  private line: Vec3[] = [];
  private lineKey = -1;
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly p = new Vector3();
  private readonly s = new Vector3();
  private readonly axis = new Vector3();
  private static readonly Z = new Vector3(0, 0, 1);

  constructor(
    private readonly city: City,
    shared: SharedUniforms,
  ) {
    this.quad = new PlaneGeometry(1, 1);
    this.tokenGeo = new BufferGeometry();
    this.tokenGeo.setAttribute("position", this.quad.getAttribute("position"));
    this.tokenGeo.setIndex(this.quad.getIndex());
    this.centerAttr = new InstancedBufferAttribute(this.center, 3).setUsage(DynamicDrawUsage);
    this.paramsAttr = new InstancedBufferAttribute(this.params, 2).setUsage(DynamicDrawUsage);
    this.tokenGeo.setAttribute("aCenter", this.centerAttr);
    this.tokenGeo.setAttribute("aParams", this.paramsAttr);
    this.tokenMat = new ShaderMaterial({
      vertexShader: TOKEN_VERTEX,
      fragmentShader: TOKEN_FRAGMENT,
      uniforms: {
        uPxScale: shared.uPxScale,
        uDpr: shared.uDpr,
        uMinPx: { value: TOKEN_MIN_PX },
        uInk: { value: new Vector3(...C.ink) },
        uGold: { value: new Vector3(...rgb(NAV_COLORS.bits)) },
        uGoldDeep: { value: new Vector3(...rgb(NAV_COLORS.bitsDeep)) },
        uPaper: { value: new Vector3(...C.paper) },
      },
    });
    this.tokens = new InstancedMesh(this.tokenGeo, this.tokenMat, MAX);
    this.tokens.name = "pickup-bits";

    this.ringMat = new ShaderMaterial({
      vertexShader: RING_VERTEX,
      fragmentShader: RING_FRAGMENT,
      uniforms: { uInk: { value: new Vector3(...C.ink) }, uColor: { value: new Vector3(...rgb(NAV_COLORS.ring)) } },
    });
    this.rings = new InstancedMesh(new TorusGeometry(1, RING_TUBE, 8, 28), this.ringMat, MAX);
    this.rings.name = "pickup-rings";
    this.rings.instanceMatrix.setUsage(DynamicDrawUsage);

    for (const mesh of [this.tokens, this.rings]) {
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.visible = false;
      this.root.add(mesh);
    }
    this.root.name = "pickups";
  }

  /** Draw this frame's pickups; `onTaken` hears each one picked up since the last frame. */
  update(frame: RenderFrame3D, time: number, onTaken?: (kind: PickupKind, at: Vec3) => void): void {
    const list = frame.pickups;
    if (!list || !list.length) {
      this.hide();
      return;
    }
    // The route only changes at a stop (the sim's own route shrinks by one there too).
    const key = frame.stop * 1024 + (frame.route ? frame.route.length + 1 : 0);
    if (key !== this.lineKey) {
      this.line = routeLine(this.city, frame);
      this.lineKey = key;
    }
    const still = this.reducedMotion;
    let nt = 0;
    let nr = 0;
    for (const pk of list) {
      const was = this.seen.get(pk.id);
      this.seen.set(pk.id, pk.taken);
      if (pk.taken) {
        if (was === false) onTaken?.(pk.kind, pk.pos);
        continue;
      }
      const phase = pk.id * 1.731;
      if (pk.kind === "bits" && nt < MAX) {
        const bob = still ? 0 : Math.sin(time * 2.4 + phase) * 6;
        const spin = still ? 1 : Math.max(0.12, Math.abs(Math.cos(time * 2.6 + phase)));
        this.center[nt * 3] = pk.pos.x;
        this.center[nt * 3 + 1] = pk.pos.y + bob;
        this.center[nt * 3 + 2] = pk.pos.z;
        this.params[nt * 2] = spin;
        this.params[nt * 2 + 1] = TOKEN_SIZE;
        nt++;
      } else if (pk.kind === "ring" && nr < MAX) {
        const d = routeDirAt(pk.pos, this.line);
        this.q.setFromUnitVectors(Pickups.Z, this.axis.set(d.x, 0, d.z));
        const breathe = still ? 1 : 1 + 0.05 * Math.sin(time * 4 + phase);
        this.m.compose(this.p.set(pk.pos.x, pk.pos.y, pk.pos.z), this.q, this.s.setScalar(RING_RADIUS * breathe));
        this.rings.setMatrixAt(nr, this.m);
        nr++;
      }
    }
    if (this.seen.size > MAX * 4) this.prune(list);
    this.tokens.count = nt;
    this.rings.count = nr;
    this.tokens.visible = nt > 0;
    this.rings.visible = nr > 0;
    if (nt) {
      this.centerAttr.needsUpdate = true;
      this.paramsAttr.needsUpdate = true;
    }
    if (nr) this.rings.instanceMatrix.needsUpdate = true;
  }

  private hide() {
    this.tokens.count = this.rings.count = 0;
    this.tokens.visible = this.rings.visible = false;
  }

  /** Forget ids no longer in the list (a new night's pickups). */
  private prune(list: { id: number }[]) {
    const live = new Set(list.map((p) => p.id));
    for (const id of this.seen.keys()) if (!live.has(id)) this.seen.delete(id);
  }

  dispose(): void {
    this.quad.dispose();
    this.tokenGeo.dispose();
    this.tokenMat.dispose();
    this.rings.geometry.dispose();
    this.ringMat.dispose();
    this.tokens.dispose();
    this.rings.dispose();
  }
}
