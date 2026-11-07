/**
 * Front-run in the 3D scene (free roam, roam-3; the sim is game-core's sim3d/roam/task-frontrun.ts),
 * from the frame's v1.9 `roam.race` and `roam.marks` and the course in roamWorld().race:
 *
 * - The gates, one instanced draw call: hoops where the sim counts them (drawn a little inside
 *   each gate's reach, so through the hoop is through the gate), facing the way the course runs
 *   through them; the climb's hangs flat on its facade. The next gate is gold and breathes, the
 *   ones after it cyan, passed ones gone. Shown only while the race runs.
 * - The course's solids, two draw calls (fill and ink hull): Sandwich Man's bread barricade and
 *   Gwei's fruit crates, box for box the sim's own (what blocks him is what's drawn).
 * - Gwei's stall sign on the facade over her, one draw call: flat on the wall, in nobody's way.
 * - The parcel on the hero's back while he races, two draw calls, set on his chest each frame.
 * - Sandwich Man himself is drawn by the cast (characters.ts) from `raceRival`: his MPFB body,
 *   running, climbing and leaping on his motion-capture clips.
 *
 * Reduced motion: the next gate doesn't breathe. At most six draw calls with the race on (the
 * gates, the parcel, the solids and the sign, the last two only in view), none before an
 * outing's first frame.
 */
import {
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  NoColorSpace,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  TorusGeometry,
  Vector3,
} from "three";

import type { RaceCourse } from "@wgp/game-core/sim3d/roam";
import type { RenderFrame3D, RoamFrame } from "@wgp/game-core/sim3d/contract";

import type { SceneVillain } from "../chapter/contract";
import { NAV_COLORS } from "@/game3d/nav/colors";
import { C, rgb, type RGB } from "../palette";

/** Sandwich Man's centre over his feet (the patrol sim's radius for him: game-core RIVAL_HIP). */
const RIVAL_HIP = 44;
/** A hoop's radius as a share of its gate's reach. */
const HOOP = 0.86;
const GOLD = rgb("#FFD95A");
const CYAN = rgb(NAV_COLORS.ring);

const GATE_VERTEX = /* glsl */ `
attribute vec3 aColor;
attribute float aGlow;
varying vec3 vN;
varying vec3 vView;
varying vec3 vColor;
varying float vGlow;
void main() {
  vec4 view = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * mat3(instanceMatrix) * normal);
  vView = view.xyz;
  vColor = aColor;
  vGlow = aGlow;
  gl_Position = projectionMatrix * view;
}
`;

const GATE_FRAGMENT = /* glsl */ `
uniform vec3 uInk;
varying vec3 vN;
varying vec3 vView;
varying vec3 vColor;
varying float vGlow;
void main() {
  vec3 n = normalize(vN);
  float facing = abs(dot(n, normalize(-vView)));
  // Inked where the tube turns away (reads at any distance), two flat bands on the rest.
  vec3 c = n.y > 0.15 ? vColor : vColor * 0.78;
  gl_FragColor = facing < 0.5 ? vec4(uInk, 1.0) : vec4(c, 0.5 + 0.4 * vGlow);
}
`;

interface Box {
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
  top: RGB;
  side: RGB;
  /** The faces along x (east and west), when they differ from `side`. */
  end?: RGB;
}

/** Boxes as one geometry with a flat colour per face (tops lighter: the cel bands, baked). `grow`: an ink hull's. */
function boxGeometry(boxes: Box[], grow = 0): BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  for (const b of boxes) {
    const g = new BoxGeometry(b.x1 - b.x0 + grow * 2, b.y1 - b.y0 + grow * 2, b.z1 - b.z0 + grow * 2);
    g.translate((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2);
    const base = pos.length / 3;
    const p = g.getAttribute("position");
    const n = g.getAttribute("normal");
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      const c = n.getY(i) > 0.5 ? b.top : Math.abs(n.getX(i)) > 0.5 ? (b.end ?? b.side) : b.side;
      col.push(c[0], c[1], c[2]);
    }
    const ix = g.getIndex()!;
    for (let i = 0; i < ix.count; i++) idx.push(base + ix.getX(i));
    g.dispose();
  }
  const out = new BufferGeometry();
  out.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  out.setAttribute("color", new BufferAttribute(new Float32Array(col), 3));
  out.setIndex(idx);
  return out;
}

/**
 * The race's solids as drawn: the barricade a row of loaves (crust and crumb, a loaf every 48
 * along the roof), the crates wooden with fruit on top. Every box inside its solid.
 */
export function courseBoxes(course: RaceCourse): Box[] {
  const out: Box[] = [];
  const crust = [rgb("#C98A46"), rgb("#B37639")];
  const crustTop = [rgb("#E9B872"), rgb("#DCA65E")];
  const crumb = rgb("#F3DDB0");
  for (const s of course.solids) {
    if (s.look === "bread") {
      const n = Math.max(1, Math.round((s.z1 - s.z0) / 48));
      const step = (s.z1 - s.z0) / n;
      for (let i = 0; i < n; i++) {
        const z0 = s.z0 + i * step;
        out.push({ x0: s.x0, y0: s.y0, z0, x1: s.x1, y1: s.y1, z1: z0 + step, top: crustTop[i % 2], side: crust[i % 2], end: crust[(i + 1) % 2] });
        // The cut face of each loaf: a crumb slice standing a hair proud of the faces the race meets.
        for (const x of [s.x0 - 0.6, s.x1 - 0.4]) out.push({ x0: x, y0: s.y0 + 14, z0: z0 + 8, x1: x + 1, y1: s.y1 - 10, z1: z0 + step - 8, top: crumb, side: crumb });
      }
    } else {
      const wood = rgb("#9C6B3E");
      out.push({ x0: s.x0, y0: s.y0, z0: s.z0, x1: s.x1, y1: s.y1 - 6, z1: s.z1, top: rgb("#B9824D"), side: wood, end: rgb("#8A5D34") });
      const fruit = [rgb("#E8492F"), GOLD, rgb("#3DDC97")];
      const w = (s.z1 - s.z0 - 6) / 3;
      fruit.forEach((c, i) => out.push({ x0: s.x0 + 3, y0: s.y1 - 6, z0: s.z0 + 3 + i * w, x1: s.x1 - 3, y1: s.y1, z1: s.z0 + 3 + (i + 1) * w - 1, top: c, side: c }));
    }
  }
  return out;
}

/** The parcel on his back: a taped box with Gwei's label, centred on the origin (+z out of his back). */
function parcelBoxes(): Box[] {
  const brown = rgb("#C9A86A");
  const tape = rgb("#E8D9B0");
  return [
    { x0: -12, y0: -10, z0: -9, x1: 12, y1: 10, z1: 9, top: rgb("#D8BC80"), side: brown, end: rgb("#B9975A") },
    { x0: -2.5, y0: -10.6, z0: -9.6, x1: 2.5, y1: 10.6, z1: 9.6, top: tape, side: tape },
    { x0: 3.5, y0: -6, z0: 9, x1: 10, y1: 1, z1: 9.8, top: C.paper, side: rgb("#E5392C") },
  ];
}

/** Gwei's stall sign, painted once. */
function signTexture(): CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const cv = document.createElement("canvas");
  cv.width = 512;
  cv.height = 160;
  const g = cv.getContext("2d");
  if (!g) return null;
  g.fillStyle = "#141414";
  g.beginPath();
  g.roundRect(4, 4, 504, 152, 28);
  g.fill();
  g.fillStyle = "#FFD95A";
  g.beginPath();
  g.roundRect(14, 14, 484, 132, 20);
  g.fill();
  g.fillStyle = "#141414";
  g.textAlign = "center";
  g.font = "900 58px system-ui, sans-serif";
  g.fillText("MEMPOOL MARKET", 256, 82);
  g.font = "700 30px system-ui, sans-serif";
  g.fillText("Gwei Stacy · prices in gwei", 256, 124);
  const t = new CanvasTexture(cv);
  t.colorSpace = NoColorSpace;
  t.anisotropy = 4;
  return t;
}

export interface FrontrunHost {
  /** A joint of the hero's body in the world, or null when he isn't drawn. */
  heroJoint?(joint: string, out: Vector3): Vector3 | null;
}

const _m = new Matrix4();
const _k = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const _a = new Vector3();
const _b = new Vector3();
const _f = new Vector3();
const _r = new Vector3();
const Z = new Vector3(0, 0, 1);

export class FrontrunScene {
  readonly root = new Group();
  reducedMotion = false;
  private readonly gates: InstancedMesh;
  private readonly gateMat: ShaderMaterial;
  private readonly gateColor: InstancedBufferAttribute;
  private readonly gateGlow: InstancedBufferAttribute;
  /** Each gate's hoop at rest (its place, its turn, its size). */
  private readonly rest: Matrix4[];
  private readonly solidFill: Mesh;
  private readonly solidHull: Mesh;
  private readonly parcel: Group;
  private readonly parcelFill: Mesh;
  private readonly parcelHull: Mesh;
  private sign: Mesh | null = null;
  private signTex: CanvasTexture | null = null;

  constructor(
    private readonly course: RaceCourse,
    private readonly host: FrontrunHost,
  ) {
    this.root.name = "roam-frontrun";
    const n = course.gates.length;
    const torus = new TorusGeometry(1, 0.075, 8, 40);
    this.gateColor = new InstancedBufferAttribute(new Float32Array(n * 3), 3).setUsage(DynamicDrawUsage);
    this.gateGlow = new InstancedBufferAttribute(new Float32Array(n), 1).setUsage(DynamicDrawUsage);
    torus.setAttribute("aColor", this.gateColor);
    torus.setAttribute("aGlow", this.gateGlow);
    this.gateMat = new ShaderMaterial({ vertexShader: GATE_VERTEX, fragmentShader: GATE_FRAGMENT, transparent: true, depthWrite: false, uniforms: { uInk: { value: new Vector3(...C.ink) } } });
    this.gates = new InstancedMesh(torus, this.gateMat, n);
    this.gates.name = "frontrun-gates";
    this.gates.frustumCulled = false;
    this.gates.count = 0;
    this.gates.renderOrder = 2;
    this.rest = course.gates.map((g, i) => {
      // Facing the way the course runs through it; the climb's flat on its facade (+x into the wall).
      if (g.move === "climb") _a.set(1, 0, 0);
      else {
        const prev = i > 0 ? course.gates[i - 1] : g;
        const next = i + 1 < n ? course.gates[i + 1] : course.buyer;
        _a.set(next.x - prev.x, 0, next.z - prev.z).normalize();
      }
      _q.setFromUnitVectors(Z, _a);
      const off = g.move === "climb" ? -g.r * 0.25 : 0;
      return new Matrix4().compose(_p.set(g.x + off, g.y, g.z), _q.clone(), _s.setScalar(g.r * HOOP));
    });

    const boxes = courseBoxes(course);
    this.solidFill = new Mesh(boxGeometry(boxes), new MeshBasicMaterial({ vertexColors: true }));
    // The ink outline round each solid as a whole (the loaves read by their crust's two tones).
    this.solidHull = new Mesh(boxGeometry(course.solids.map((s) => ({ ...s, top: C.ink, side: C.ink })), 2.2), new MeshBasicMaterial({ color: 0x141414, side: BackSide }));
    this.solidFill.name = "frontrun-solids";
    this.solidHull.name = "frontrun-solids-ink";

    const pb = parcelBoxes();
    this.parcelFill = new Mesh(boxGeometry(pb), new MeshBasicMaterial({ vertexColors: true }));
    this.parcelHull = new Mesh(boxGeometry(pb.slice(0, 1), 1.6), new MeshBasicMaterial({ color: 0x141414, side: BackSide }));
    this.parcel = new Group();
    this.parcel.name = "frontrun-parcel";
    this.parcel.add(this.parcelHull, this.parcelFill);
    this.parcel.visible = false;
    this.root.add(this.solidHull, this.solidFill, this.gates, this.parcel);

    this.signTex = signTexture();
    if (this.signTex) {
      const st = course.stall;
      this.sign = new Mesh(new PlaneGeometry(150, 47), new MeshBasicMaterial({ map: this.signTex, transparent: true }));
      // Flat on the facade behind her (her stall's wall faces the street, −x), over head height.
      this.sign.position.set(st.x + 32.5, 150, st.z);
      this.sign.rotation.y = -Math.PI / 2;
      this.sign.name = "frontrun-sign";
      this.root.add(this.sign);
    }
  }

  setReducedMotion(on: boolean): void {
    this.reducedMotion = on;
  }

  update(r: RoamFrame, frame: RenderFrame3D, time: number): void {
    const race = r.race;
    // The gates: only while it runs; the next breathes gold, the rest wait in cyan.
    const running = !!race && race.over === null;
    let k = 0;
    if (running) {
      // Front-run's marks are its gates in course order (task-frontrun.ts fillRaceMarks).
      let i = 0;
      for (const m of r.marks ?? []) {
        if (m.task !== "frontrun" || m.kind !== "gate") continue;
        const gate = i++;
        if (m.done || gate >= this.rest.length) continue;
        const breathe = m.next && !this.reducedMotion ? 1 + 0.06 * Math.sin(time * 5) : 1;
        _m.copy(this.rest[gate]);
        if (breathe !== 1) _m.multiply(_k.makeScale(breathe, breathe, breathe));
        this.gates.setMatrixAt(k, _m);
        const c = m.next ? GOLD : CYAN;
        this.gateColor.setXYZ(k, c[0], c[1], c[2]);
        this.gateGlow.setX(k, m.next ? 1 : 0);
        k++;
      }
    }
    this.gates.count = k;
    this.gates.visible = k > 0;
    if (k) {
      this.gates.instanceMatrix.needsUpdate = true;
      this.gateColor.needsUpdate = true;
      this.gateGlow.needsUpdate = true;
    }
    this.placeParcel(running, frame);
  }

  /** The parcel on his back: on the chest joint, pushed out behind, upright along his spine. */
  private placeParcel(on: boolean, frame: RenderFrame3D): void {
    const chest = on ? this.host.heroJoint?.("chest", _a) : null;
    const hips = chest ? this.host.heroJoint?.("hips", _b) : null;
    if (!chest || !hips) {
      this.parcel.visible = false;
      return;
    }
    const up = _r.subVectors(chest, hips);
    if (up.lengthSq() < 1) up.set(0, 1, 0);
    up.normalize();
    const f = frame.hero.facing ?? { x: 0, y: 0, z: 1 };
    // Forward square to the spine, then the box's +z out of his back (minus forward).
    _f.set(f.x, 0, f.z).addScaledVector(up, -(f.x * up.x + f.z * up.z));
    if (_f.lengthSq() < 1e-4) _f.set(0, 0, 1);
    _f.normalize().negate();
    const right = _p.crossVectors(up, _f).normalize();
    _m.makeBasis(right, up, _f);
    this.parcel.quaternion.setFromRotationMatrix(_m);
    this.parcel.position.copy(chest).addScaledVector(_f, 13).addScaledVector(up, -4);
    this.parcel.visible = true;
  }

  dispose(): void {
    this.gates.geometry.dispose();
    this.gateMat.dispose();
    this.gates.dispose();
    for (const mesh of [this.solidFill, this.solidHull, this.parcelFill, this.parcelHull]) {
      mesh.geometry.dispose();
      (mesh.material as MeshBasicMaterial).dispose();
    }
    if (this.sign) {
      this.sign.geometry.dispose();
      (this.sign.material as MeshBasicMaterial).dispose();
    }
    this.signTex?.dispose();
  }
}

/* ------------------------------------------------------------------ Sandwich Man for the cast */

const rival: SceneVillain = {
  id: "sandwich-man",
  copy: false,
  pos: { x: 0, y: 0, z: 0 },
  hits: 0,
  hitsMax: 1,
  state: "idle",
  vel: { x: 0, y: 0, z: 0 },
  facing: { x: 0, y: 0, z: 1 },
  stateTicks: 0,
};

/**
 * Sandwich Man as a frame villain while Front-run's race is on (characters.ts draws him like
 * any villain: his MPFB body on the cast's clips), or null. One object, refilled per call.
 */
export function raceRival(frame: RenderFrame3D): SceneVillain | null {
  const race = frame.roam?.race;
  if (!race) return null;
  rival.pos.x = race.rival.x;
  rival.pos.y = race.rival.y + RIVAL_HIP;
  rival.pos.z = race.rival.z;
  rival.vel!.x = race.rivalVel.x;
  rival.vel!.y = race.rivalVel.y;
  rival.vel!.z = race.rivalVel.z;
  rival.facing!.x = Math.sin(race.rivalYaw);
  rival.facing!.z = Math.cos(race.rivalYaw);
  // A beat of guard when the hero beats him to it; otherwise his run is his velocity.
  const state = race.rivalMove === "beaten" ? "guard" : "idle";
  if (state !== rival.state) rival.stateTicks = 0;
  else rival.stateTicks = (rival.stateTicks ?? 0) + 1;
  rival.state = state;
  return rival;
}
