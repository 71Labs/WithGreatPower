/**
 * Case file 002, "The Sybil Vote", in the 3D scene: everything its night draws on top of a
 * normal one, from the frame's v1.6 `chapter.vote` (docs/chapters/case-002.md) and its events.
 * The voters themselves are the Sybil's bodies (characters.ts draws them, every one a grey copy
 * while he hides); this adds what tells them apart and the place they stand in:
 *
 * - the drop boxes on three roofs (blue, a gold beam over each until it's read; "+CLUE!");
 * - the polling station: eight booth frames on the stage with their "vote" placards, the
 *   ballot box, and Uncle Gen beside it (gen.ts);
 * - each voter's tells: a blob shadow under the ones who cast one, the ballot card in his left
 *   or right hand, and an eye over his head that blinks (or stares) while you pick him out;
 * - the fork vote: the split line across the roof and the orphaned half in red hatching, its
 *   hatch thickening as the count runs out ("FORK!" or "NO QUORUM!" at the close);
 * - the recount ("RECOUNT!"), the marks ("GOTCHA!", "COPY!", card confetti), and Uncle Gen's
 *   gold ballot, with the runner, in the hero's hand, then in the box ("COUNTED!").
 *
 * Nothing is built until a Case file 002 frame arrives. About ten draws: one for every inked
 * box (booths, boxes, cards), the beams, the shadows, the eyes, the split's two planes, the
 * confetti, and Uncle Gen. Reduced motion (and the Steady camera): no pulsing or bobbing; the
 * eyes still blink, since a blink is a tell (a state change, not motion).
 */
import {
  BoxGeometry,
  CanvasTexture,
  CircleGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  Object3D,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  Vector3,
  AdditiveBlending,
  type PerspectiveCamera,
} from "three";

import type { City, RenderFrame3D, Vec3, VoteFrame } from "@wgp/game-core/sim3d/contract";

import { surfaceBelow, type CitySolids } from "../../camera/raycast";
import type { SharedUniforms } from "../../city/materials";
import { KEY_LIGHT } from "../../characters/materials";
import { C, rgb } from "../../palette";
import type { QualityTier } from "../../quality";
import type { ChapterHost } from "../chapter";
import type { ChapterEvent } from "../contract";
import { Pops } from "../particles";
import { BOX_FRAGMENT, BOX_VERTEX } from "../shaders";
import { GenFigure, type GenState } from "./gen";

/** A voter's centre over his feet (game-core VOTER_LIFT). */
const LIFT = 52;
const MAX_BOXES = 220;
const MAX_VOTERS = 16;

const COL = {
  post: rgb("#2E3350"),
  bar: rgb("#E5392C"),
  placard: rgb("#FFFDF8"),
  stripe: rgb("#3B5BA8"),
  drop: rgb("#3B5BA8"),
  dropTop: rgb("#5A7BC8"),
  dropDone: rgb("#7E86A8"),
  band: rgb("#FFFDF8"),
  slot: C.ink,
  ballot: rgb("#FFFDF8"),
  gold: rgb("#F6C445"),
  box: rgb("#2F4FA0"),
  lid: rgb("#24346E"),
} as const;

const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const _up = new Vector3(0, 1, 0);

/** One instanced batch of inked boxes (the chapter's BOX shader), refilled each frame. */
class InkBoxes {
  readonly mesh: InstancedMesh;
  private readonly geo = new BoxGeometry(1, 1, 1);
  private readonly mat: ShaderMaterial;
  private readonly colour: InstancedBufferAttribute;
  private n = 0;

  constructor(shared: SharedUniforms) {
    this.colour = new InstancedBufferAttribute(new Float32Array(MAX_BOXES * 3), 3).setUsage(DynamicDrawUsage);
    this.geo.setAttribute("aColor", this.colour);
    this.mat = new ShaderMaterial({
      name: "wgp-vote-boxes",
      vertexShader: BOX_VERTEX,
      fragmentShader: BOX_FRAGMENT,
      uniforms: {
        uInk: { value: new Vector3(...C.ink) },
        uDpr: shared.uDpr,
        uGlow: { value: 0 },
        uLight: { value: KEY_LIGHT.clone() },
        uFog: shared.uFog,
        uFogBands: shared.uFogBands,
        uFogAmt: shared.uFogAmt,
      },
    });
    this.mesh = new InstancedMesh(this.geo, this.mat, MAX_BOXES);
    this.mesh.name = "vote-boxes";
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
  }

  begin() {
    this.n = 0;
  }

  /** A box centred at (x, y, z), sized (sx, sy, sz), turned `yaw` about y. */
  add(x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw: number, col: readonly number[]) {
    if (this.n >= MAX_BOXES) return;
    _q.setFromAxisAngle(_up, yaw);
    _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
    this.mesh.setMatrixAt(this.n, _m);
    this.colour.setXYZ(this.n, col[0], col[1], col[2]);
    this.n += 1;
  }

  end() {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.colour.needsUpdate = true;
  }

  dispose() {
    this.geo.dispose();
    this.mat.dispose();
  }
}

const SHADOW_VERTEX = /* glsl */ `
void main() {
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
}
`;
const SHADOW_FRAGMENT = /* glsl */ `
uniform vec3 uInk;
void main() { gl_FragColor = vec4(uInk, 0.38); }
`;

const BEAM_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
}
`;
const BEAM_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uPulse;
varying vec2 vUv;
void main() {
  float side = 1.0 - abs(vUv.x - 0.5) * 2.0;
  float a = side * side * (1.0 - vUv.y) * (0.45 + 0.25 * uPulse);
  gl_FragColor = vec4(uColor * a, a);
}
`;

const EYE_VERTEX = /* glsl */ `
attribute float aCell;
varying vec2 vUv;
void main() {
  vUv = vec2((uv.x + aCell) * 0.5, uv.y);
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
}
`;
const EYE_FRAGMENT = /* glsl */ `
uniform sampler2D uMap;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(uMap, vUv);
  if (c.a < 0.5) discard;
  gl_FragColor = c;
}
`;

const SPLIT_VERTEX = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;
const SPLIT_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
uniform float uProg;
uniform float uStill;
varying vec3 vWorld;
void main() {
  // Diagonal hatching in world space, thickening as the count runs out (a pattern, not only a colour).
  float t = (vWorld.x + vWorld.z) / 34.0 + uTime * 0.6 * (1.0 - uStill);
  float band = fract(t);
  float w = mix(0.22, 0.55, uProg);
  float a = band < w ? 0.5 : 0.14;
  gl_FragColor = vec4(uColor, a);
}
`;

/** The eye atlas: open (left) and shut (right), ink on paper, 128 × 64. */
function eyeAtlas(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 128;
  const g = c.getContext("2d")!;
  const ink = "#141414";
  const paper = "#FFFDF8";
  for (let i = 0; i < 2; i++) {
    const cx = 64 + i * 128;
    const cy = 64;
    // The badge: a paper disc with an ink rim.
    g.beginPath();
    g.arc(cx, cy, 54, 0, Math.PI * 2);
    g.fillStyle = paper;
    g.fill();
    g.lineWidth = 9;
    g.strokeStyle = ink;
    g.stroke();
    g.lineCap = "round";
    g.lineJoin = "round";
    if (i === 0) {
      // Open: an almond and its pupil.
      g.beginPath();
      g.moveTo(cx - 36, cy);
      g.quadraticCurveTo(cx, cy - 34, cx + 36, cy);
      g.quadraticCurveTo(cx, cy + 34, cx - 36, cy);
      g.lineWidth = 8;
      g.stroke();
      g.beginPath();
      g.arc(cx, cy, 12, 0, Math.PI * 2);
      g.fillStyle = ink;
      g.fill();
    } else {
      // Shut: a lid's curve and lashes.
      g.beginPath();
      g.moveTo(cx - 36, cy - 4);
      g.quadraticCurveTo(cx, cy + 26, cx + 36, cy - 4);
      g.lineWidth = 8;
      g.stroke();
      for (const k of [-20, 0, 20]) {
        g.beginPath();
        g.moveTo(cx + k, cy + 10);
        g.lineTo(cx + k * 1.3, cy + 24);
        g.lineWidth = 6;
        g.stroke();
      }
    }
  }
  const t = new CanvasTexture(c);
  t.needsUpdate = true;
  return t;
}

interface Parts {
  boxes: InkBoxes;
  beams: InstancedMesh;
  beamMat: ShaderMaterial;
  beamGeo: PlaneGeometry;
  shadows: InstancedMesh;
  shadowMat: ShaderMaterial;
  shadowGeo: CircleGeometry;
  eyes: InstancedMesh;
  eyeMat: ShaderMaterial;
  eyeGeo: PlaneGeometry;
  eyeCell: InstancedBufferAttribute;
  eyeTex: CanvasTexture;
  half: Mesh;
  halfMat: ShaderMaterial;
  line: Mesh;
  lineMat: ShaderMaterial;
  splitGeo: PlaneGeometry;
  pops: Pops;
  gen: GenFigure;
}

/** Seconds an eye stays shut, and how often a blinker blinks. */
const SHUT = 0.24;
const BLINK_EVERY = 1.5;

export class VoteScene {
  readonly root = new Group();
  private parts: Parts | null = null;
  private tier: QualityTier = "medium";
  private reduced = false;
  private primed = false;
  private boothsUp = false;
  private time = 0;
  private readonly alive = new Map<number, Vec3>();
  private readonly found = new Set<string>();
  private readonly tmp = new Object3D();

  constructor(
    private readonly city: City,
    private readonly solids: CitySolids,
    private readonly shared: SharedUniforms,
    private readonly host: ChapterHost,
  ) {
    this.root.name = "wgp-vote";
    this.root.visible = false;
  }

  /** Whether a Case file 002 night is on (its first frame has arrived). */
  get active(): boolean {
    return this.parts !== null && this.root.visible;
  }

  setTier(tier: QualityTier): void {
    this.tier = tier;
    const p = this.parts;
    if (!p) return;
    p.pops.light = tier === "low";
    p.gen.setTier(tier);
  }

  setReducedMotion(on: boolean): void {
    this.reduced = on;
    const p = this.parts;
    if (!p) return;
    p.pops.reducedMotion = on;
    p.gen.reducedMotion = on;
  }

  private ensure(): Parts {
    if (this.parts) return this.parts;
    const ink = new Vector3(...C.ink);
    const beamGeo = new PlaneGeometry(1, 1);
    beamGeo.translate(0, 0.5, 0);
    const beamMat = new ShaderMaterial({
      name: "wgp-vote-beams",
      vertexShader: BEAM_VERTEX,
      fragmentShader: BEAM_FRAGMENT,
      uniforms: { uColor: { value: new Vector3(...COL.gold) }, uPulse: { value: 0.5 } },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
    });
    const beams = new InstancedMesh(beamGeo, beamMat, 6);
    beams.frustumCulled = false;
    beams.instanceMatrix.setUsage(DynamicDrawUsage);
    const shadowGeo = new CircleGeometry(0.5, 20);
    shadowGeo.rotateX(-Math.PI / 2);
    const shadowMat = new ShaderMaterial({
      vertexShader: SHADOW_VERTEX,
      fragmentShader: SHADOW_FRAGMENT,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      uniforms: { uInk: { value: ink } },
    });
    const shadows = new InstancedMesh(shadowGeo, shadowMat, MAX_VOTERS);
    shadows.frustumCulled = false;
    shadows.instanceMatrix.setUsage(DynamicDrawUsage);
    shadows.renderOrder = 2;
    const eyeTex = eyeAtlas();
    const eyeGeo = new PlaneGeometry(1, 1);
    const eyeCell = new InstancedBufferAttribute(new Float32Array(MAX_VOTERS), 1).setUsage(DynamicDrawUsage);
    eyeGeo.setAttribute("aCell", eyeCell);
    const eyeMat = new ShaderMaterial({ name: "wgp-vote-eyes", vertexShader: EYE_VERTEX, fragmentShader: EYE_FRAGMENT, uniforms: { uMap: { value: eyeTex } } });
    const eyes = new InstancedMesh(eyeGeo, eyeMat, MAX_VOTERS);
    eyes.frustumCulled = false;
    eyes.instanceMatrix.setUsage(DynamicDrawUsage);
    const splitGeo = new PlaneGeometry(1, 1);
    splitGeo.rotateX(-Math.PI / 2);
    const halfMat = new ShaderMaterial({
      name: "wgp-vote-orphan",
      vertexShader: SPLIT_VERTEX,
      fragmentShader: SPLIT_FRAGMENT,
      uniforms: { uColor: { value: new Vector3(...rgb("#E5392C")) }, uTime: { value: 0 }, uProg: { value: 0 }, uStill: { value: 0 } },
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
    const lineMat = new ShaderMaterial({
      name: "wgp-vote-split",
      vertexShader: SPLIT_VERTEX,
      fragmentShader: /* glsl */ `
uniform vec3 uColor;
void main() { gl_FragColor = vec4(uColor, 1.0); }
`,
      uniforms: { uColor: { value: new Vector3(...COL.gold) } },
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    const half = new Mesh(splitGeo, halfMat);
    half.renderOrder = 3;
    const line = new Mesh(splitGeo, lineMat);
    line.renderOrder = 4;
    half.visible = false;
    line.visible = false;
    const p: Parts = {
      boxes: new InkBoxes(this.shared),
      beams,
      beamMat,
      beamGeo,
      shadows,
      shadowMat,
      shadowGeo,
      eyes,
      eyeMat,
      eyeGeo,
      eyeCell,
      eyeTex,
      half,
      halfMat,
      line,
      lineMat,
      splitGeo,
      pops: new Pops(this.shared),
      gen: new GenFigure(this.shared, this.solids),
    };
    this.root.add(p.boxes.mesh, p.beams, p.shadows, p.eyes, p.half, p.line, p.pops.mesh, p.gen.root);
    this.parts = p;
    this.setTier(this.tier);
    this.setReducedMotion(this.reduced);
    // His body and the copies' come down while the hero reads the drop boxes.
    this.host.characters.prepareVillain("sybil");
    p.gen.ask();
    return p;
  }

  update(frame: RenderFrame3D, camera: PerspectiveCamera, _size: { width: number; height: number }, dt: number, time: number): void {
    const ch = frame.chapter;
    const vote = ch?.id === "case-002" ? ch.vote : null;
    if (!ch || !vote) {
      if (this.root.visible) this.reset();
      return;
    }
    const p = this.ensure();
    this.root.visible = true;
    this.time = time;
    const first = !this.primed;
    this.primed = true;
    const still = this.reduced;
    const zone = this.city.zones[0];
    const floor = zone?.stage?.y ?? ch.captive?.pos.y ?? 0;
    const hero = frame.hero.pos;
    const b = p.boxes;
    b.begin();

    // The drop boxes, and a beam over each until it's read.
    let beams = 0;
    for (const c of ch.clues) {
      const y = surfaceBelow(this.solids, c.pos.x, c.pos.z, c.pos.y + 6);
      const body = c.found ? COL.dropDone : COL.drop;
      b.add(c.pos.x, y + 25, c.pos.z, 30, 50, 24, 0.4, body);
      b.add(c.pos.x, y + 54, c.pos.z, 32, 8, 26, 0.4, c.found ? COL.dropDone : COL.dropTop);
      b.add(c.pos.x, y + 34, c.pos.z, 30.6, 9, 24.6, 0.4, COL.band);
      if (!c.found && beams < 6) {
        const camYaw = Math.atan2(camera.position.x - c.pos.x, camera.position.z - c.pos.z);
        this.tmp.position.set(c.pos.x, y, c.pos.z);
        this.tmp.rotation.set(0, camYaw, 0);
        this.tmp.scale.set(70, 640, 1);
        this.tmp.updateMatrix();
        p.beams.setMatrixAt(beams++, this.tmp.matrix);
      }
      if (c.found && !this.found.has(c.id)) {
        this.found.add(c.id);
        if (!first) this.host.burst("+CLUE!", { x: c.pos.x, y: y + 90, z: c.pos.z }, { size: 92, life: 1, rise: 36 });
      } else if (!c.found) this.found.delete(c.id);
    }
    p.beams.count = beams;
    p.beams.visible = beams > 0;
    p.beams.instanceMatrix.needsUpdate = true;
    p.beamMat.uniforms.uPulse.value = still ? 0.5 : 0.5 + 0.5 * Math.sin(time * 3);

    // The station while the line stands: a taped square on the roof under each booth and a
    // little "vote" sign on a pole at its back corner. The line breaks when he's unmasked: the
    // booths go flying (confetti) and the roof's clear for the fight.
    const station = ch.phase === "investigate" || ch.phase === "lineup";
    if (station) {
      const mid = zone?.center.z ?? 0;
      for (const at of vote.booths) {
        const back = at.z > mid ? 1 : -1;
        b.add(at.x, floor + 0.6, at.z, 84, 1.2, 84, 0, COL.stripe);
        b.add(at.x, floor + 1.6, at.z, 74, 1.2, 74, 0, COL.post);
        b.add(at.x - 38, floor + 34, at.z + back * 38, 4, 68, 4, 0, COL.post);
        b.add(at.x - 38, floor + 72, at.z + back * 38, 30, 14, 2.5, 0, COL.placard);
        b.add(at.x - 38, floor + 68, at.z + back * 38, 26, 3, 2.9, 0, COL.bar);
      }
      this.boothsUp = true;
    } else if (this.boothsUp) {
      this.boothsUp = false;
      if (!first) for (const at of vote.booths) this.parts!.pops.pop("paper", { x: at.x - 38, y: floor + 60, z: at.z }, ["#FFFDF8", "#3B5BA8", "#E5392C", "#2E3350"]);
    }
    // The ballot box beside Uncle Gen.
    const bx = vote.box;
    b.add(bx.x, floor + 24, bx.z, 46, 48, 38, 0, COL.box);
    b.add(bx.x, floor + 51, bx.z, 50, 6, 42, 0, COL.lid);
    b.add(bx.x, floor + 54.5, bx.z, 26, 1.5, 4, 0, COL.slot);
    b.add(bx.x, floor + 30, bx.z, 46.6, 10, 38.6, 0, COL.band);

    // The voters' tells: shadows, ballot cards, eyes.
    const picking = ch.phase === "lineup" || ch.phase === "investigate" || (ch.phase === "standoff" && vote.stage === "recount");
    let shadows = 0;
    let eyes = 0;
    const cq = camera.quaternion;
    for (const v of vote.voters) {
      if (!v.alive) {
        this.popVoter(v.id);
        continue;
      }
      this.alive.set(v.id, { x: v.pos.x, y: v.pos.y, z: v.pos.z });
      const fx = hero.x - v.pos.x;
      const fz = hero.z - v.pos.z;
      const fl = Math.hypot(fx, fz) || 1;
      // Facing the hero (the copies' batch turns them so): his left hand is on his facing's left.
      const lx = fz / fl;
      const lz = -fx / fl;
      const hand = v.left ? 1 : -1;
      const yaw = Math.atan2(fx, fz);
      const bob = still ? 0 : Math.sin(time * 2 + v.id) * 1.5;
      if (v.runner) {
        // Uncle Gen's ballot, held up high and gold.
        b.add(v.pos.x + lx * 22, v.pos.y + 30 + bob, v.pos.z + lz * 22, 20, 26, 2.5, yaw, COL.gold);
      } else {
        // His ballot, held out in that hand: a card with a red band across its foot.
        const hx = v.pos.x + lx * 30 * hand;
        const hz = v.pos.z + lz * 30 * hand;
        b.add(hx, v.pos.y + 16 + bob, hz, 20, 26, 2, yaw, COL.ballot);
        b.add(hx, v.pos.y + 7 + bob, hz, 20.4, 5, 2.4, yaw, COL.bar);
      }
      if (v.shadow && shadows < MAX_VOTERS) {
        const g = v.pos.y - LIFT;
        this.tmp.position.set(v.pos.x, g + 1.5, v.pos.z);
        this.tmp.rotation.set(0, 0, 0);
        this.tmp.scale.set(64, 1, 48);
        this.tmp.updateMatrix();
        p.shadows.setMatrixAt(shadows++, this.tmp.matrix);
      }
      if (picking && eyes < MAX_VOTERS) {
        // A blinker shuts his eye now and then (each on his own beat); the rest stare.
        const shut = v.blink && (time + v.id * 0.37) % BLINK_EVERY < SHUT;
        this.tmp.position.set(v.pos.x, v.pos.y + 58, v.pos.z);
        this.tmp.quaternion.copy(cq);
        this.tmp.scale.set(19, 19, 1);
        this.tmp.updateMatrix();
        p.eyes.setMatrixAt(eyes, this.tmp.matrix);
        p.eyeCell.setX(eyes, shut ? 1 : 0);
        eyes += 1;
      }
    }
    p.shadows.count = shadows;
    p.shadows.visible = shadows > 0;
    p.shadows.instanceMatrix.needsUpdate = true;
    p.eyes.count = eyes;
    p.eyes.visible = eyes > 0;
    p.eyes.instanceMatrix.needsUpdate = true;
    p.eyeCell.needsUpdate = true;

    // Uncle Gen's ballot out of the runner's hand: in the hero's, then in the box.
    if (vote.ballot && vote.ballot.state === "carried") {
      const bob = still ? 0 : Math.sin(time * 4) * 2;
      b.add(vote.ballot.pos.x, vote.ballot.pos.y + 20 + bob, vote.ballot.pos.z, 20, 26, 2.5, Math.atan2(camera.position.x - hero.x, camera.position.z - hero.z), COL.gold);
    }
    b.end();

    // The fork vote's split.
    this.split(vote, zone?.stage ?? null, floor, time);

    // Uncle Gen.
    const gen = ch.captive?.pos ?? null;
    const near = gen ? Math.hypot(hero.x - gen.x, hero.z - gen.z) < 260 : false;
    const state: GenState = ch.captive?.freed ? "wave" : vote.ballot?.state === "carried" && near ? "talk" : "idle";
    p.gen.update(gen, state, hero, camera, dt);

    p.pops.update(dt);

  }

  private split(vote: VoteFrame, stage: { x0: number; z0: number; x1: number; z1: number } | null, floor: number, time: number) {
    const p = this.parts!;
    const f = vote.fork;
    if (!f || !stage) {
      p.half.visible = false;
      p.line.visible = false;
      return;
    }
    const y = floor + 1.2;
    if (f.axis === "x") {
      const x0 = f.orphan > 0 ? f.at : stage.x0;
      const x1 = f.orphan > 0 ? stage.x1 : f.at;
      p.half.position.set((x0 + x1) / 2, y, (stage.z0 + stage.z1) / 2);
      p.half.scale.set(Math.max(1, x1 - x0), 1, stage.z1 - stage.z0);
      p.line.position.set(f.at, y + 0.4, (stage.z0 + stage.z1) / 2);
      p.line.scale.set(8, 1, stage.z1 - stage.z0);
    } else {
      const z0 = f.orphan > 0 ? f.at : stage.z0;
      const z1 = f.orphan > 0 ? stage.z1 : f.at;
      p.half.position.set((stage.x0 + stage.x1) / 2, y, (z0 + z1) / 2);
      p.half.scale.set(stage.x1 - stage.x0, 1, Math.max(1, z1 - z0));
      p.line.position.set((stage.x0 + stage.x1) / 2, y + 0.4, f.at);
      p.line.scale.set(stage.x1 - stage.x0, 1, 8);
    }
    p.half.visible = true;
    p.line.visible = true;
    const u = p.halfMat.uniforms;
    u.uTime.value = time;
    u.uProg.value = f.total > 0 ? 1 - f.left / f.total : 0;
    u.uStill.value = this.reduced ? 1 : 0;
  }

  /** A voter that's gone: card confetti where he stood (once). */
  private popVoter(id: number) {
    const at = this.alive.get(id);
    if (!at) return;
    this.alive.delete(id);
    this.parts!.pops.pop("paper", { x: at.x, y: at.y + 6, z: at.z }, ["#A3A3A0", "#E4E4E1", "#141414", "#FFFDF8", "#3B5BA8"]);
  }

  /** Case file 002's sim events (session/effects.ts passes them on with the chapter's). */
  event(ev: ChapterEvent): void {
    if (!this.parts || !this.root.visible) return;
    switch (ev.type) {
      case "voter-mark":
        this.host.burst(ev.real ? "GOTCHA!" : "COPY!", { x: ev.x, y: ev.y + 80, z: ev.z }, { size: ev.real ? 110 : 80, life: 1, rise: 30 });
        break;
      case "fork": {
        const at = this.host.characters.jointOf("hero", "hips", new Vector3());
        const p = at ? { x: at.x, y: at.y + 90, z: at.z } : null;
        if (p) this.host.burst(ev.passed ? "FORK!" : "NO QUORUM!", p, { size: 100, life: 1.1, rise: 30 });
        break;
      }
      case "recount":
        if (!ev.end) this.host.burst("RECOUNT!", { x: ev.x, y: ev.y + 110, z: ev.z }, { size: 100, life: 1.2, rise: 30 });
        break;
      case "ballot":
        if (ev.state === "counted") this.host.burst("COUNTED!", { x: ev.x, y: ev.y + 100, z: ev.z }, { size: 104, life: 1.4, rise: 34 });
        break;
      default:
        break;
    }
  }

  private reset(): void {
    this.root.visible = false;
    this.primed = false;
    this.boothsUp = false;
    this.alive.clear();
    this.found.clear();
    const p = this.parts;
    if (!p) return;
    p.pops.clear();
    p.gen.hide();
    p.half.visible = false;
    p.line.visible = false;
  }

  dispose(): void {
    const p = this.parts;
    if (!p) return;
    p.boxes.dispose();
    p.beamGeo.dispose();
    p.beamMat.dispose();
    p.shadowGeo.dispose();
    p.shadowMat.dispose();
    p.eyeGeo.dispose();
    p.eyeMat.dispose();
    p.eyeTex.dispose();
    p.splitGeo.dispose();
    p.halfMat.dispose();
    p.lineMat.dispose();
    p.pops.dispose();
    p.gen.dispose();
    this.parts = null;
  }

  /** For the lab and tests: the time the scene last drew. */
  get lastTime(): number {
    return this.time;
  }
}
