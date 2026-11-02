/**
 * The characters as sticker cards standing in the 3D city.
 *
 * - Extruded (medium and high): each silhouette extruded 4 units, the sticker on the front,
 *   paper-white sides with an ink back edge (it reads as the 2D sticker's ink drop when the
 *   card turns), and a paper back with the "WGP" stamp.
 * - Flat (low): a sticker quad over an ink-silhouette quad offset down and back.
 *
 * Cards turn to face the camera about +y only, through a lagging spring, so a fast camera
 * swing shows the card's edge. The hero also rolls toward the web anchor and can flip.
 * Every card casts an ink blob shadow on the roof or street below it.
 *
 * Draw calls: one per visible card, plus one for all the shadows.
 */
import {
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  DoubleSide,
  DynamicDrawUsage,
  ExtrudeGeometry,
  FrontSide,
  Group,
  InstancedMesh,
  Mesh,
  Object3D,
  ShaderMaterial,
  Shape,
  Vector2,
  Vector3,
  Vector4,
} from "three";

import type { City, RenderFrame3D, Vec3 } from "@wgp/game-core/sim3d/contract";

import { surfaceBelow, type CitySolids } from "../camera/raycast";
import { Smoothed, SmoothedAngle } from "../camera/springs";
import { C } from "../palette";
import type { CardArt, CardCell, CardKey } from "./card-art";
import { signedArea } from "./contour";

/** Card thickness (world units). */
export const CARD_DEPTH = 4;

/** Art-box size per character (world units), from the 2D renderer's sticker sizes. */
export const CARD_SIZE: Record<CardKey, number> = {
  hero: 88,
  node: 88,
  gwei: 84,
  "uncle-gen": 84,
  "aunt-mainnet": 84,
  bearson: 84,
  "mary-jpeg": 84,
  "gas-goblin": 122,
  "sandwich-man": 112,
  "doc-octochain": 126,
  sybil: 104,
  "sybil-copy": 92,
};

const CARD_VERTEX = /* glsl */ `
#ifdef FLAT
attribute float aLayer;
varying float vLayer;
#endif
varying vec3 vPos;
varying vec3 vN;
void main() {
  vPos = position;
  vN = normal;
#ifdef FLAT
  vLayer = aLayer;
#endif
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const CARD_FRAGMENT = /* glsl */ `
uniform sampler2D uAtlas;
uniform vec4 uCell;
uniform vec4 uStamp;
uniform float uSpan;
uniform float uDepth;
uniform vec3 uPaper;
uniform vec3 uInk;
uniform float uFlash;
uniform float uOffset;   // FLAT: the ink quad's offset (world units), to undo in the lookup
varying vec3 vPos;
varying vec3 vN;
#ifdef FLAT
varying float vLayer;
#endif
void main() {
#ifdef FLAT
  vec2 p = vPos.xy;
  if (vLayer < 0.5) p.y += uOffset;
  vec2 uv = p / uSpan + 0.5;
  vec4 s = texture2D(uAtlas, uCell.xy + uv * uCell.zw);
  if (s.a < 0.5) discard;
  gl_FragColor = vec4(vLayer < 0.5 ? uInk : mix(s.rgb, vec3(1.0), uFlash), 1.0);
#else
  vec2 uv = vPos.xy / uSpan + 0.5;
  if (abs(vN.z) < 0.5) {
    // The edge: paper, inked along the back so the turn reads like the 2D ink drop.
    float t = (vPos.z + uDepth * 0.5) / uDepth;
    float w = fwidth(t);
    vec3 c = mix(uInk, uPaper, smoothstep(0.55 - w, 0.55 + w, t));
    gl_FragColor = vec4(c, 1.0);
  } else if (vN.z > 0.0) {
    vec4 s = texture2D(uAtlas, uCell.xy + clamp(uv, 0.0, 1.0) * uCell.zw);
    vec3 c = mix(uPaper, s.rgb, smoothstep(0.3, 0.6, s.a));
    gl_FragColor = vec4(mix(c, vec3(1.0), uFlash), 1.0);
  } else {
    vec2 b = vec2(1.0 - uv.x, uv.y);
    vec4 s = texture2D(uAtlas, uStamp.xy + clamp(b, 0.0, 1.0) * uStamp.zw);
    gl_FragColor = vec4(mix(uPaper * 0.97, s.rgb, s.a), 1.0);
  }
#endif
}
`;

const SHADOW_VERTEX = /* glsl */ `
void main() {
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
}
`;

const SHADOW_FRAGMENT = /* glsl */ `
uniform vec3 uInk;
void main() { gl_FragColor = vec4(uInk, 0.34); }
`;

interface GeometrySet {
  extruded: BufferGeometry;
  flat: BufferGeometry;
  /** Art-box size → world scale applied to the sprite's px. */
  span: number;
  offset: number;
}

function cardGeometries(cell: CardCell, size: number): GeometrySet {
  const k = size / cell.art;
  const half = cell.span / 2;
  const span = cell.span * k;
  let pts = cell.outline.map(([x, y]) => new Vector2((x - half) * k, (half - y) * k));
  if (pts.length < 3) {
    const r = span * 0.42;
    pts = [new Vector2(-r, -r), new Vector2(r, -r), new Vector2(r, r), new Vector2(-r, r)];
  }
  if (signedArea(pts.map((p) => [p.x, p.y])) < 0) pts.reverse();
  const extruded = new ExtrudeGeometry(new Shape(pts), { depth: CARD_DEPTH, bevelEnabled: false, curveSegments: 1, steps: 1 });
  extruded.translate(0, 0, -CARD_DEPTH / 2);
  extruded.computeBoundingSphere();

  // Flat: the ink quad (layer 0) offset down and back, then the sticker quad (layer 1).
  const offset = cell.drop * k * 1.4;
  const h = span / 2;
  const quad = (z: number, dy: number) => [-h, -h + dy, z, h, -h + dy, z, h, h + dy, z, -h, h + dy, z];
  const flat = new BufferGeometry();
  flat.setAttribute("position", new BufferAttribute(new Float32Array([...quad(-1.5, -offset), ...quad(0, 0)]), 3));
  flat.setAttribute("normal", new BufferAttribute(new Float32Array(24).map((_, i) => (i % 3 === 2 ? 1 : 0)), 3));
  flat.setAttribute("aLayer", new BufferAttribute(new Float32Array([0, 0, 0, 0, 1, 1, 1, 1]), 1));
  flat.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  flat.computeBoundingSphere();
  return { extruded, flat, span, offset };
}

interface Card {
  key: CardKey;
  mesh: Mesh;
  material: ShaderMaterial;
  flatMaterial: ShaderMaterial;
  geo: GeometrySet;
  yaw: SmoothedAngle;
  roll: Smoothed;
  started: boolean;
  /** Seconds left in a flip. */
  flip: number;
  size: number;
}

const FLIP_TIME = 0.5;

export class CardSystem {
  readonly root = new Group();
  private art: CardArt | null = null;
  private readonly geometries = new Map<CardKey, GeometrySet>();
  private hero: Card | null = null;
  private readonly villains: Card[] = [];
  private readonly allies: { card: Card; at: Vec3 }[] = [];
  private extruded = true;
  private readonly shadows: InstancedMesh;
  private readonly shadowMat: ShaderMaterial;
  private readonly shadowGeo: BufferGeometry;
  private readonly tmp = new Object3D();
  private readonly camDir = new Vector3();

  constructor(
    private readonly city: City,
    private readonly solids: CitySolids,
  ) {
    this.root.name = "wgp-cards";
    this.shadowGeo = new CircleGeometry(0.5, 20);
    this.shadowGeo.rotateX(-Math.PI / 2);
    this.shadowMat = new ShaderMaterial({
      vertexShader: SHADOW_VERTEX,
      fragmentShader: SHADOW_FRAGMENT,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      uniforms: { uInk: { value: new Vector3(...C.ink) } },
    });
    this.shadows = new InstancedMesh(this.shadowGeo, this.shadowMat, 16);
    this.shadows.instanceMatrix.setUsage(DynamicDrawUsage);
    this.shadows.frustumCulled = false;
    this.shadows.count = 0;
    this.shadows.renderOrder = 2;
    this.root.add(this.shadows);
  }

  get ready(): boolean {
    return this.art !== null;
  }

  setArt(art: CardArt): void {
    this.art = art;
    this.hero = this.makeCard("hero");
    for (const z of this.city.zones) {
      if (!z.ally) continue;
      const card = this.makeCard(z.ally);
      // allyAt is where the ally's feet are (contract v1.1); older cities only have the centre.
      const feet = z.allyAt ?? z.center;
      if (card) this.allies.push({ card, at: { x: feet.x, y: feet.y + card.size * 0.46, z: feet.z } });
    }
  }

  setExtruded(on: boolean): void {
    this.extruded = on;
    const all = [this.hero, ...this.villains, ...this.allies.map((a) => a.card)];
    for (const c of all) if (c) this.applyMode(c);
  }

  /** Spin the hero card a full turn (a perfect release). */
  flip(): void {
    if (this.hero) this.hero.flip = FLIP_TIME;
  }

  private geometryFor(key: CardKey): GeometrySet | null {
    const cached = this.geometries.get(key);
    if (cached) return cached;
    const cell = this.art?.cells.get(key);
    if (!cell) return null;
    const geo = cardGeometries(cell, CARD_SIZE[key] ?? 100);
    this.geometries.set(key, geo);
    return geo;
  }

  private makeCard(key: CardKey): Card | null {
    const art = this.art;
    const geo = this.geometryFor(key);
    const cell = art?.cells.get(key);
    if (!art || !geo || !cell) return null;
    const uniforms = {
      uAtlas: { value: art.texture },
      uCell: { value: new Vector4(...cell.rect) },
      uStamp: { value: new Vector4(...art.stamp) },
      uSpan: { value: geo.span },
      uDepth: { value: CARD_DEPTH },
      uPaper: { value: new Vector3(...C.paper) },
      uInk: { value: new Vector3(...C.ink) },
      uFlash: { value: 0 },
      uOffset: { value: geo.offset },
    };
    const material = new ShaderMaterial({ vertexShader: CARD_VERTEX, fragmentShader: CARD_FRAGMENT, uniforms, side: FrontSide });
    const flatMaterial = new ShaderMaterial({ vertexShader: CARD_VERTEX, fragmentShader: CARD_FRAGMENT, uniforms, defines: { FLAT: "" }, side: DoubleSide });
    const mesh = new Mesh(geo.extruded, material);
    mesh.name = `card-${key}`;
    mesh.renderOrder = 1;
    const card: Card = { key, mesh, material, flatMaterial, geo, yaw: new SmoothedAngle(), roll: new Smoothed(), started: false, flip: 0, size: CARD_SIZE[key] ?? 100 };
    this.applyMode(card);
    this.root.add(mesh);
    return card;
  }

  private applyMode(c: Card): void {
    c.mesh.geometry = this.extruded ? c.geo.extruded : c.geo.flat;
    c.mesh.material = this.extruded ? c.material : c.flatMaterial;
  }

  /** Face the camera about +y through the lagging spring; returns the yaw used. */
  private face(c: Card, pos: Vec3, camera: Vector3, dt: number, lag: number): number {
    const want = Math.atan2(camera.x - pos.x, camera.z - pos.z);
    if (!c.started) {
      c.yaw.snap(want);
      c.started = true;
    }
    c.yaw.step(want, lag, dt);
    // Never more than ~55° behind, so a card never shows its edge for long.
    c.yaw.clampTo(want, 0.95);
    return c.yaw.value;
  }

  update(frame: RenderFrame3D, camera: Vector3, dt: number, time: number): void {
    if (!this.art) return;
    let shadows = 0;
    const shadow = (p: Vec3, size: number) => {
      if (shadows >= 16) return;
      const ground = surfaceBelow(this.solids, p.x, p.z, p.y);
      const lift = Math.max(0, p.y - ground);
      const s = size * 0.62 * (1 - Math.min(0.6, lift / 900));
      this.tmp.position.set(p.x, ground + 1.5, p.z);
      this.tmp.scale.set(s, 1, s * 0.62);
      this.tmp.rotation.set(0, 0, 0);
      this.tmp.updateMatrix();
      this.shadows.setMatrixAt(shadows++, this.tmp.matrix);
    };

    // The hero.
    const h = this.hero;
    if (h) {
      const hp = frame.hero.pos;
      const yaw = this.face(h, hp, camera, dt, 0.2);
      // Roll toward the rope (or lean into the motion), in the card's own plane.
      const rx = Math.cos(yaw);
      const rz = -Math.sin(yaw);
      let rollWant = 0;
      if (frame.hero.anchor) {
        const a = frame.hero.anchor;
        const side = (a.x - hp.x) * rx + (a.z - hp.z) * rz;
        rollWant = Math.max(-0.45, Math.min(0.45, -Math.atan2(side, Math.max(1, a.y - hp.y)) * 0.45));
      } else {
        const v = frame.hero.vel;
        rollWant = Math.max(-0.25, Math.min(0.25, -(v.x * rx + v.z * rz) / 2400));
      }
      h.roll.step(rollWant, 0.15, dt);
      let spin = 0;
      if (h.flip > 0) {
        h.flip = Math.max(0, h.flip - dt);
        const u = 1 - h.flip / FLIP_TIME;
        spin = (1 - (1 - u) * (1 - u)) * Math.PI * 2;
      }
      h.mesh.position.set(hp.x, hp.y, hp.z);
      h.mesh.rotation.set(0, yaw + spin, h.roll.value, "YXZ");
      const hurt = frame.hero.hurtFlash > 0 && Math.floor(time * 16) % 2 === 0;
      h.material.uniforms.uFlash.value = hurt ? 0.7 : 0;
      h.mesh.visible = frame.mode !== "done";
      if (h.mesh.visible) shadow(hp, h.size);
    }

    // Villains: one pooled card per entry, re-keyed when the cast changes.
    const list = frame.villains;
    for (let i = 0; i < list.length; i++) {
      const v = list[i];
      const key: CardKey = v.copy ? "sybil-copy" : v.id;
      let c = this.villains[i];
      if (!c || c.key !== key) {
        if (c) {
          this.root.remove(c.mesh);
          c.material.dispose();
          c.flatMaterial.dispose();
        }
        const made = this.makeCard(key);
        if (!made) continue;
        c = made;
        this.villains[i] = c;
      }
      const yaw = this.face(c, v.pos, camera, dt, 0.24);
      const wobble = v.state === "stunned" ? Math.sin(time * 9 + i) * 0.22 : Math.sin(time * 1.6 + i) * 0.05;
      const squash = v.state === "windup" ? 0.9 : 1;
      c.mesh.position.set(v.pos.x, v.pos.y, v.pos.z);
      c.mesh.rotation.set(0, yaw, wobble, "YXZ");
      c.mesh.scale.set(1 / Math.sqrt(squash), squash, 1);
      c.material.uniforms.uFlash.value = v.state === "hit" && Math.floor(time * 16) % 2 === 0 ? 0.7 : 0;
      c.mesh.visible = true;
      shadow(v.pos, c.size);
    }
    for (let i = list.length; i < this.villains.length; i++) if (this.villains[i]) this.villains[i].mesh.visible = false;

    // Allies wait on their rooftops, bobbing a little.
    for (let i = 0; i < this.allies.length; i++) {
      const { card, at } = this.allies[i];
      const yaw = this.face(card, at, camera, dt, 0.3);
      card.mesh.position.set(at.x, at.y + Math.sin(time * 2 + i) * 3, at.z);
      card.mesh.rotation.set(0, yaw, Math.sin(time * 1.7 + i) * 0.05, "YXZ");
      shadow({ x: at.x, y: at.y - card.size * 0.46, z: at.z }, card.size * 0.9);
    }

    this.shadows.count = shadows;
    this.shadows.instanceMatrix.needsUpdate = true;
  }

  /** The hero's hand, where the web leaves the card (world). */
  handPoint(frame: RenderFrame3D, out: Vector3): Vector3 {
    const h = this.hero;
    const p = frame.hero.pos;
    if (!h) return out.set(p.x, p.y, p.z);
    const yaw = h.yaw.value;
    const roll = h.roll.value;
    // Up the card's plane, tilted by the roll: about a third of the art box above centre.
    const up = h.size * 0.32;
    this.camDir.set(Math.cos(yaw), 0, -Math.sin(yaw)).multiplyScalar(-Math.sin(roll) * up);
    return out.set(p.x + this.camDir.x, p.y + Math.cos(roll) * up, p.z + this.camDir.z);
  }

  dispose(): void {
    for (const g of this.geometries.values()) {
      g.extruded.dispose();
      g.flat.dispose();
    }
    const all = [this.hero, ...this.villains, ...this.allies.map((a) => a.card)];
    for (const c of all) {
      c?.material.dispose();
      c?.flatMaterial.dispose();
    }
    this.shadowGeo.dispose();
    this.shadowMat.dispose();
    this.shadows.dispose();
    this.art?.texture.dispose();
  }
}
