/**
 * Cross-chain in the City (game-core sim3d/roam/task-crosschain.ts, roam-3): Doc Octochain's
 * four relays where the sim has them solid, drawn from the frame's v1.9 fields.
 *
 * - The relays, one instanced draw (and its ink hull): a junction box in Doc's green clamped with
 *   gunmetal straps, a steel front panel, a hazard band, his badge, a socket with a red plug in
 *   it, and a red warning lamp on top that blinks while it's live. Unplugged, the lamp goes dark
 *   and the plug hangs out of its socket. Every box lies inside the sim's solid box.
 * - Chain-link cables, one instanced draw (and its hull): two chains per relay, from the box's
 *   sides down the structure it's bolted to (the crane's apex pole, the antenna, over the cap's
 *   edge and down a bridge tower's leg), Doc's own link style.
 * - Sprites, one instanced draw: a lamp's glow (never smaller than a few pixels, so a live
 *   relay reads from across the city like an aircraft light) and, while one is held, a progress
 *   ring over it filling to unplugged.
 * - The relay's events: a spark ("ZZT!", yellow debris, a small shake) and its plug out ("CLUNK!").
 *
 * Reduced motion (or the Steady camera): the lamps hold steady (no flashing), no debris, no
 * shake. Five draw calls in all, the ring's only while a relay is held.
 */
import { BackSide, BoxGeometry, BufferGeometry, DynamicDrawUsage, FrontSide, Group, InstancedBufferAttribute, InstancedMesh, Matrix4, PlaneGeometry, ShaderMaterial, TorusGeometry, Vector3 } from "three";

import type { RenderFrame3D, Vec3 } from "@wgp/game-core/sim3d/contract";
import type { RoamRelay } from "@wgp/game-core/sim3d/roam";

import { KEY_LIGHT, SHADE_DARK, SHADE_MID } from "../characters/materials";
import type { SharedUniforms } from "../city/materials";
import { COMMON } from "../city/shaders";
import { C, rgb, type RGB } from "../palette";

/** Doc's gear (his avatar's colours) and the relay's details. */
const GUNMETAL = rgb("#3A3D44");
const PANEL = rgb("#6E7581");
const DOC_GREEN = rgb("#4F9A4E");
const HAZARD = C.windowLit;
const PLUG = C.neonRed;
const LAMP_ON = rgb("#FF4433");
const LAMP_OFF = rgb("#2B2D33");
const RING_GOLD = rgb("#FFD95A");

/** How each relay's chains run down its structure: out from its side, and out past an edge (a bridge cap's lip). */
const CHAINS: Record<RoamRelay["key"], { side: number; lip: number }> = {
  crane: { side: 4.5, lip: 0 },
  antenna: { side: 6.5, lip: 0 },
  bridge: { side: 9, lip: 11 },
  deck: { side: 9, lip: 11 },
};
/** Box parts per relay (the plug and the lamp are the last two, moved each frame). */
const PARTS = 9;
const LINK_STEP = 3.4;
const MAX_LINKS = 400;
/** The lamp blinks on for this share of each period (seconds). */
const BLINK = { period: 1.1, on: 0.55 } as const;
/** A lamp's glow (world size, and never under this many CSS px across), and the hold ring (this far over the box). */
const GLOW = { size: 16, minPx: 7 } as const;
const RING = { size: 28, minPx: 48, up: 46 } as const;

const BOX_VERTEX = /* glsl */ `
attribute vec4 aColor; // rgb, w: 1 unlit (the lamp)
varying vec3 vN;
varying vec4 vColor;
varying vec3 vWorld;
void main() {
  mat4 m = modelMatrix * instanceMatrix;
  vec4 world = m * vec4(position, 1.0);
  vN = normalize(mat3(m) * normal);
  vColor = aColor;
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const BOX_FRAGMENT = /* glsl */ `
${COMMON}
uniform vec3 uLight;
uniform vec3 uShadeMid;
uniform vec3 uShadeDark;
uniform vec3 uFog;
uniform vec4 uFogAmt;
uniform vec3 uFogBands;
varying vec3 vN;
varying vec4 vColor;
varying vec3 vWorld;
void main() {
  float l = dot(normalize(vN), uLight);
  vec3 shade = vColor.w > 0.5 ? vec3(1.0) : l > 0.16 ? vec3(1.0) : l > -0.4 ? uShadeMid : uShadeDark;
  vec3 col = vColor.rgb * shade;
  float f = fogAmount(fogBand(vWorld.xz, uFogBands), uFogAmt) * (vColor.w > 0.5 ? 0.4 : 1.0);
  gl_FragColor = vec4(mix(col, uFog, f), 1.0);
}
`;

const HULL_VERTEX = /* glsl */ `
uniform float uPxScale;
uniform vec4 uHullPx;
void main() {
  mat4 m = modelMatrix * instanceMatrix;
  vec4 world = m * vec4(position, 1.0);
  vec3 n = normalize(mat3(m) * normal);
  float depth = max(1.0, -(viewMatrix * world).z);
  float px = mix(uHullPx.x, uHullPx.y, smoothstep(uHullPx.z, uHullPx.w, depth)) * 0.8;
  world.xyz += n * px * depth * uPxScale;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const HULL_FRAGMENT = /* glsl */ `
uniform vec3 uInk;
void main() { gl_FragColor = vec4(uInk, 1.0); }
`;

const SPRITE_VERTEX = /* glsl */ `
attribute vec3 aCenter;
attribute vec4 aParams; // x: size (world), y: kind (0 glow, 1 ring), z: value (glow brightness, ring progress), w: min px
uniform float uPxScale;
varying vec2 vUv;
varying vec2 vKind;
void main() {
  vec4 view = viewMatrix * vec4(aCenter, 1.0);
  float depth = max(1.0, -view.z);
  float size = max(aParams.x, aParams.w * depth * uPxScale);
  view.xy += position.xy * size;
  vUv = position.xy * 2.0;
  vKind = aParams.yz;
  gl_Position = projectionMatrix * view;
}
`;

const SPRITE_FRAGMENT = /* glsl */ `
uniform vec3 uInk;
uniform vec3 uPaper;
uniform vec3 uLamp;
uniform vec3 uGold;
uniform float uDpr;
varying vec2 vUv;
varying vec2 vKind;
void main() {
  float r = length(vUv);
  if (r > 1.0) discard;
  if (vKind.x < 0.5) {
    // A lamp's glow: a hot core and a soft halo, as bright as the lamp is lit.
    float a = (exp(-r * r * 7.0) * 0.85 + smoothstep(0.32, 0.0, r) * 0.6) * vKind.y;
    if (a < 0.02) discard;
    gl_FragColor = vec4(mix(uLamp, vec3(1.0, 0.92, 0.86), smoothstep(0.3, 0.0, r)), a);
    return;
  }
  // The hold ring: paper track, ink rims, gold fill sweeping clockwise from the top.
  float px = max(fwidth(r), 1e-4);
  float inner = 0.62;
  if (r < inner - 1.4 * px * uDpr) discard;
  float ang = atan(vUv.x, vUv.y); // 0 at the top, clockwise
  float u = ang < 0.0 ? ang / 6.2831853 + 1.0 : ang / 6.2831853;
  vec3 col = u <= vKind.y ? uGold : uPaper;
  float rim = min(abs(r - inner), abs(r - 1.0));
  if (rim < 1.6 * px * uDpr || r > 1.0 - 1.6 * px * uDpr) col = uInk;
  gl_FragColor = vec4(col, 1.0);
}
`;

const _m = new Matrix4();
const _p = new Vector3();
const _x = new Vector3();
const _y = new Vector3();
const _z = new Vector3();
const _t = new Vector3();
const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();

export interface RelayHost {
  burst(word: string, at: Vec3, opts?: { size?: number; life?: number }): void;
  /** Comic debris for a hit word (the engine's sparks; nothing under reduced motion). */
  impact?(word: string, at: Vec3): void;
  shake?(amount: number): void;
}

/** A box part in a relay's frame: right (across its front), up, out (its front). */
interface Part {
  r: number;
  u: number;
  o: number;
  w: number;
  h: number;
  d: number;
  color: RGB;
  unlit?: boolean;
}

export class RoamRelays {
  readonly root = new Group();
  private readonly boxGeo = new BoxGeometry(1, 1, 1);
  private readonly linkGeo = new TorusGeometry(1, 0.34, 3, 6);
  private readonly quad = new PlaneGeometry(1, 1);
  private readonly spriteGeo = new BufferGeometry();
  private readonly boxMat: ShaderMaterial;
  private readonly linkMat: ShaderMaterial;
  private readonly hullMat: ShaderMaterial;
  private readonly spriteMat: ShaderMaterial;
  private readonly boxes: InstancedMesh;
  private readonly boxHull: InstancedMesh;
  private readonly links: InstancedMesh;
  private readonly linkHull: InstancedMesh;
  private readonly sprites: InstancedMesh;
  private readonly color: InstancedBufferAttribute;
  private readonly center: InstancedBufferAttribute;
  private readonly params: InstancedBufferAttribute;
  /** What each relay looked like last frame (unplugged or not), so its parts move only on a change. */
  private readonly dark: boolean[];

  constructor(
    shared: SharedUniforms,
    private readonly relays: readonly RoamRelay[],
  ) {
    this.root.name = "roam-relays";
    const n = relays.length * PARTS;
    const colors = new Float32Array(n * 4);
    this.color = new InstancedBufferAttribute(colors, 4).setUsage(DynamicDrawUsage);
    this.boxGeo.setAttribute("aColor", this.color);
    const lit = { uLight: { value: KEY_LIGHT.clone() }, uShadeMid: { value: new Vector3(...SHADE_MID) }, uShadeDark: { value: new Vector3(...SHADE_DARK) } };
    const fog = { uFog: shared.uFog, uFogAmt: shared.uFogAmt, uFogBands: shared.uFogBands };
    this.boxMat = new ShaderMaterial({ name: "wgp-relay", vertexShader: BOX_VERTEX, fragmentShader: BOX_FRAGMENT, side: FrontSide, uniforms: { ...lit, ...fog } });
    // The links: Doc's steel, cel shaded.
    const linkGeo = this.linkGeo;
    const steel = new Float32Array(MAX_LINKS * 4);
    for (let i = 0; i < MAX_LINKS; i++) steel.set([C.steel[0], C.steel[1], C.steel[2], 0], i * 4);
    linkGeo.setAttribute("aColor", new InstancedBufferAttribute(steel, 4));
    this.linkMat = new ShaderMaterial({ name: "wgp-relay-chain", vertexShader: BOX_VERTEX, fragmentShader: BOX_FRAGMENT, side: FrontSide, uniforms: { ...lit, ...fog } });
    this.hullMat = new ShaderMaterial({ name: "wgp-relay-hull", vertexShader: HULL_VERTEX, fragmentShader: HULL_FRAGMENT, side: BackSide, uniforms: { uPxScale: shared.uPxScale, uHullPx: shared.uHullPx, uInk: { value: new Vector3(...C.ink) } } });

    this.boxes = new InstancedMesh(this.boxGeo, this.boxMat, n);
    this.boxHull = new InstancedMesh(this.boxGeo, this.hullMat, n);
    this.boxes.name = "roam-relays";
    this.boxHull.name = "roam-relays-ink";
    const linkCount = this.chainCount();
    this.links = new InstancedMesh(linkGeo, this.linkMat, Math.max(1, linkCount));
    this.linkHull = new InstancedMesh(linkGeo, this.hullMat, Math.max(1, linkCount));
    this.links.name = "roam-relay-chains";
    this.linkHull.name = "roam-relay-chains-ink";
    for (const m of [this.boxes, this.boxHull, this.links, this.linkHull]) {
      m.frustumCulled = false;
      m.renderOrder = 1;
    }
    this.boxes.instanceMatrix.setUsage(DynamicDrawUsage);
    this.boxHull.instanceMatrix.setUsage(DynamicDrawUsage);

    // Sprites: a glow per lamp, and the hold ring.
    this.spriteGeo.setAttribute("position", this.quad.getAttribute("position"));
    this.spriteGeo.setIndex(this.quad.getIndex());
    const sprites = relays.length + 1;
    this.center = new InstancedBufferAttribute(new Float32Array(sprites * 3), 3).setUsage(DynamicDrawUsage);
    this.params = new InstancedBufferAttribute(new Float32Array(sprites * 4), 4).setUsage(DynamicDrawUsage);
    this.spriteGeo.setAttribute("aCenter", this.center);
    this.spriteGeo.setAttribute("aParams", this.params);
    this.spriteMat = new ShaderMaterial({
      name: "wgp-relay-sprites",
      vertexShader: SPRITE_VERTEX,
      fragmentShader: SPRITE_FRAGMENT,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uPxScale: shared.uPxScale,
        uDpr: shared.uDpr,
        uInk: { value: new Vector3(...C.ink) },
        uPaper: { value: new Vector3(...C.paper) },
        uLamp: { value: new Vector3(...LAMP_ON) },
        uGold: { value: new Vector3(...RING_GOLD) },
      },
    });
    this.sprites = new InstancedMesh(this.spriteGeo, this.spriteMat, sprites);
    this.sprites.name = "roam-relay-sprites";
    this.sprites.frustumCulled = false;
    this.sprites.renderOrder = 3;
    this.sprites.count = 0;

    this.dark = relays.map(() => false);
    relays.forEach((_, i) => this.placeRelay(i, false));
    this.placeChains();
    this.root.add(this.boxHull, this.boxes, this.linkHull, this.links, this.sprites);
  }

  /** The relay's frame: right (across the front), up, out (the front), right-handed (right × up = out), so no box is drawn mirrored. */
  private frame(rl: RoamRelay) {
    return { rx: rl.fz, rz: -rl.fx, ox: rl.fx, oz: rl.fz };
  }

  /** A relay's box parts, plugged in or out: all inside its solid box but the hanging plug and the lamp on top. */
  private parts(rl: RoamRelay, dark: boolean): Part[] {
    const hx = rl.hx;
    const hy = rl.hy;
    const hz = rl.hz;
    const face = hz;
    return [
      // Doc's green housing (his coat's), so it reads against the night from a roof away.
      { r: 0, u: 0, o: 0, w: hx * 2 - 1, h: hy * 2, d: hz * 2 - 1, color: DOC_GREEN },
      // Gunmetal straps clamping it on, a steel front panel, the hazard band and Doc's badge.
      { r: 0, u: hy - 6, o: 0, w: hx * 2, h: 2.8, d: hz * 2, color: GUNMETAL },
      { r: 0, u: -hy + 6, o: 0, w: hx * 2, h: 2.8, d: hz * 2, color: GUNMETAL },
      { r: 0, u: 0, o: face - 0.6, w: hx * 2 - 6, h: hy * 2 - 11, d: 1.2, color: PANEL },
      { r: 0, u: 6.5, o: face - 0.3, w: hx * 2 - 8, h: 3.2, d: 0.8, color: HAZARD },
      { r: -4.6, u: 0.5, o: face - 0.3, w: 5.5, h: 5.5, d: 0.8, color: GUNMETAL },
      // The socket.
      { r: 3.4, u: -4.5, o: face - 0.3, w: 8, h: 6.5, d: 0.8, color: C.ink },
      // The plug: in the socket, or pulled out and hanging by its lead under it.
      dark ? { r: 5, u: -hy + 5.5, o: face + 1.8, w: 4.6, h: 7.5, d: 3.4, color: PLUG } : { r: 3.4, u: -4.5, o: face + 2, w: 5.6, h: 4.6, d: 4, color: PLUG },
      // The lamp on top.
      { r: 0, u: hy + 2.6, o: 0, w: 6.5, h: 5.2, d: 6.5, color: dark ? LAMP_OFF : LAMP_ON, unlit: !dark },
    ];
  }

  private placeRelay(i: number, dark: boolean) {
    const rl = this.relays[i];
    const f = this.frame(rl);
    const col = this.color.array as Float32Array;
    this.parts(rl, dark).forEach((p, k) => {
      const idx = i * PARTS + k;
      const x = rl.x + f.rx * p.r + f.ox * p.o;
      const z = rl.z + f.rz * p.r + f.oz * p.o;
      // Quarter-turned boxes: across the front along the right axis.
      _x.set(f.rx * p.w, 0, f.rz * p.w);
      _y.set(0, p.h, 0);
      _z.set(f.ox * p.d, 0, f.oz * p.d);
      _m.makeBasis(_x, _y, _z).setPosition(x, rl.y + p.u, z);
      this.boxes.setMatrixAt(idx, _m);
      this.boxHull.setMatrixAt(idx, _m);
      col.set([p.color[0], p.color[1], p.color[2], p.unlit ? 1 : 0], idx * 4);
    });
    this.dark[i] = dark;
    this.boxes.instanceMatrix.needsUpdate = true;
    this.boxHull.instanceMatrix.needsUpdate = true;
    this.color.needsUpdate = true;
  }

  /** Each relay's two chains: from its sides, to the structure under it, down to where they're bolted. */
  private chainPaths(rl: RoamRelay): Vec3[][] {
    const f = this.frame(rl);
    const c = CHAINS[rl.key];
    const bottom = rl.y - rl.hy;
    const out: Vec3[][] = [];
    for (const s of [-1, 1]) {
      const p0 = { x: rl.x + f.rx * s * (rl.hx + 0.6), y: bottom + 5, z: rl.z + f.rz * s * (rl.hx + 0.6) };
      const edge = { x: rl.ax + f.ox * c.lip + f.rx * s * c.side, y: bottom + 1, z: rl.az + f.oz * c.lip + f.rz * s * c.side };
      const bolt = { x: rl.ax + f.ox * (c.lip ? 1 : 0) + f.rx * s * c.side, y: rl.ay + 1, z: rl.az + f.oz * (c.lip ? 1 : 0) + f.rz * s * c.side };
      out.push([p0, edge, bolt]);
    }
    return out;
  }

  private chainCount(): number {
    let n = 0;
    for (const rl of this.relays)
      for (const path of this.chainPaths(rl))
        for (let i = 1; i < path.length; i++) n += Math.max(1, Math.round(Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y, path[i].z - path[i - 1].z) / LINK_STEP));
    return Math.min(MAX_LINKS, n);
  }

  /** Lay the links along every path, alternate ones turned a quarter about the chain (built once). */
  private placeChains() {
    let n = 0;
    let turn = 0;
    for (const rl of this.relays) {
      for (const path of this.chainPaths(rl)) {
        for (let i = 1; i < path.length; i++) {
          const a = path[i - 1];
          const b = path[i];
          _t.set(b.x - a.x, b.y - a.y, b.z - a.z);
          const len = _t.length();
          if (len < 1e-3) continue;
          _t.divideScalar(len);
          const steps = Math.max(1, Math.round(len / LINK_STEP));
          // A frame round the chain's line.
          _x.set(0, 1, 0);
          if (Math.abs(_t.y) > 0.9) _x.set(1, 0, 0);
          _z.crossVectors(_t, _x).normalize();
          _x.crossVectors(_z, _t).normalize();
          for (let k = 0; k < steps && n < MAX_LINKS; k++) {
            const u = (k + 0.5) / steps;
            _p.set(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u, a.z + (b.z - a.z) * u);
            // The torus lies in its xy plane: x across the link, y along the chain, z its face
            // (x × y, so the basis is right-handed and the link isn't drawn inside out).
            _a.copy(turn % 2 ? _z : _x);
            _c.crossVectors(_a, _t).multiplyScalar(1.25);
            _a.multiplyScalar(1.25);
            _b.copy(_t).multiplyScalar(2.1);
            _m.makeBasis(_a, _b, _c).setPosition(_p);
            this.links.setMatrixAt(n, _m);
            this.linkHull.setMatrixAt(n, _m);
            n++;
            turn++;
          }
        }
      }
    }
    this.links.count = n;
    this.linkHull.count = n;
    this.links.instanceMatrix.needsUpdate = true;
    this.linkHull.instanceMatrix.needsUpdate = true;
  }

  /**
   * Per frame: which relays are unplugged (Cross-chain's stage and marks: none before it's
   * taken, all once it's done), the lamps blinking (steady when still), their glows, and the
   * ring over the one being held.
   */
  update(frame: RenderFrame3D, time: number, still: boolean): void {
    const r = frame.roam;
    if (!r) return;
    let stage = 0;
    for (const t of r.tasks) if (t.id === "crosschain") stage = t.stage;
    const marks = r.marks ?? [];
    let first = -1;
    for (let k = 0; k < marks.length && first < 0; k++) if (marks[k].task === "crosschain") first = k;
    for (let i = 0; i < this.relays.length; i++) {
      // A task's marks are its relays in order (game-core render.ts).
      const dark = stage >= 2 || (stage === 1 && first >= 0 && !!marks[first + i]?.done);
      if (dark !== this.dark[i]) this.placeRelay(i, dark);
    }
    const blinkOn = still || (time % BLINK.period) / BLINK.period < BLINK.on;
    const col = this.color.array as Float32Array;
    let n = 0;
    for (let i = 0; i < this.relays.length; i++) {
      const rl = this.relays[i];
      if (this.dark[i]) continue;
      // The lamp itself: lit, or dimmed between blinks.
      const lamp = (i * PARTS + PARTS - 1) * 4;
      const k = blinkOn ? 1 : 0.35;
      for (let c = 0; c < 3; c++) col[lamp + c] = LAMP_ON[c] * k + LAMP_OFF[c] * (1 - k);
      this.sprite(n++, rl.x, rl.y + rl.hy + 3, rl.z, GLOW.size, 0, blinkOn ? 1 : 0.18, GLOW.minPx);
    }
    this.color.needsUpdate = true;
    const held = r.relay;
    if (held && this.relays[held.index]) {
      const rl = this.relays[held.index];
      this.sprite(n++, rl.x, rl.y + rl.hy + RING.up, rl.z, RING.size, 1, held.progress, RING.minPx);
    }
    this.sprites.count = n;
    this.sprites.visible = n > 0;
    this.center.needsUpdate = true;
    this.params.needsUpdate = true;
  }

  private sprite(n: number, x: number, y: number, z: number, size: number, kind: number, value: number, minPx: number) {
    const c = this.center.array as Float32Array;
    const p = this.params.array as Float32Array;
    c[n * 3] = x;
    c[n * 3 + 1] = y;
    c[n * 3 + 2] = z;
    p[n * 4] = size;
    p[n * 4 + 1] = kind;
    p[n * 4 + 2] = value;
    p[n * 4 + 3] = minPx;
  }

  /** The drawn boxes, as world boxes (the lamp and the plug included), for the tests. */
  drawnBoxes(): { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; part: number; relay: number }[] {
    const out = [];
    const e = this.boxes.instanceMatrix.array;
    for (let idx = 0; idx < this.boxes.count; idx++) {
      const o = idx * 16;
      // Columns: the box's three (turned, scaled) axes, then its centre.
      const hx = (Math.abs(e[o]) + Math.abs(e[o + 4]) + Math.abs(e[o + 8])) / 2;
      const hy = (Math.abs(e[o + 1]) + Math.abs(e[o + 5]) + Math.abs(e[o + 9])) / 2;
      const hz = (Math.abs(e[o + 2]) + Math.abs(e[o + 6]) + Math.abs(e[o + 10])) / 2;
      const [cx, cy, cz] = [e[o + 12], e[o + 13], e[o + 14]];
      out.push({ x0: cx - hx, y0: cy - hy, z0: cz - hz, x1: cx + hx, y1: cy + hy, z1: cz + hz, part: idx % PARTS, relay: Math.floor(idx / PARTS) });
    }
    return out;
  }

  /** Draw calls this adds (the sprites only while something's lit or held). */
  get draws(): number {
    return 4 + (this.sprites.visible ? 1 : 0);
  }

  /** A relay's event (sim roam-relay): a spark fights back; unplugged at last. */
  event(state: string, index: number, host: RelayHost, still: boolean): void {
    const rl = this.relays[index];
    if (!rl) return;
    // Off to the side of the relay, clear of it and of the ring over it.
    const side = index % 2 ? 1 : -1;
    const at = { x: rl.x + rl.fx * (rl.hz + 6) - rl.fz * side * 44, y: rl.y + 4, z: rl.z + rl.fz * (rl.hz + 6) + rl.fx * side * 44 };
    if (state === "spark") {
      host.burst("ZZT!", at, { size: 50, life: 0.5 });
      if (!still) {
        host.impact?.("POW!", at);
        host.shake?.(0.22);
      }
    } else if (state === "unplugged") {
      host.burst("CLUNK!", { x: rl.x, y: rl.y + 40, z: rl.z }, { size: 84, life: 1 });
      if (!still) host.impact?.("POW!", at);
    }
  }

  dispose(): void {
    this.boxGeo.dispose();
    this.linkGeo.dispose();
    this.quad.dispose();
    this.spriteGeo.dispose();
    this.boxMat.dispose();
    this.linkMat.dispose();
    this.hullMat.dispose();
    this.spriteMat.dispose();
    for (const m of [this.boxes, this.boxHull, this.links, this.linkHull, this.sprites]) m.dispose();
  }
}
