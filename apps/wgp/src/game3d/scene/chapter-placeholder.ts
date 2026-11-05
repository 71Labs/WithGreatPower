/**
 * PLACEHOLDER for Case File 001 (the gameplay build), until the 3D build replaces it: plain
 * markers so the chapter can be played before its art lands. To replace it, delete this file
 * and its hooks: engine.ts (construct, update, dispose) and characters.ts (`villainBody`).
 *
 * - The Right-Clicker borrows Sandwich Man's body (`villainBody`).
 * - Clues: a tall pillar each, gold, grey once found.
 * - Mary: a column, teal turning white as she's restored.
 * - Paper copies: flat white cutouts turned to their yaw.
 * - The SCREENSHOT cone: a see-through sector on the deck while he aims, brighter at the flash.
 *
 * Two draw calls, none on a patrol night (it's only built for a chapter's city).
 */
import { BoxGeometry, CircleGeometry, Color, DoubleSide, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, Quaternion, Vector3 } from "three";

import type { RenderFrame3D } from "@wgp/game-core/sim3d/contract";

type VillainId = RenderFrame3D["villains"][number]["id"];

/** The body a villain id draws with: the Right-Clicker stands in as Sandwich Man for now. */
export function villainBody(id: VillainId): Exclude<VillainId, "right-clicker"> {
  return id === "right-clicker" ? "sandwich-man" : id;
}

const MAX = 40;
const CONE_RADIUS = 620;
const GOLD = new Color("#f2c14e");
const GREY = new Color("#8a8f98");
const TEAL = new Color("#3fb8af");
const WHITE = new Color("#ffffff");

const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const _up = new Vector3(0, 1, 0);
const _c = new Color();

export class ChapterPlaceholder {
  readonly root = new Group();
  private readonly boxes: InstancedMesh;
  private readonly cone: Mesh;
  private readonly coneMat: MeshBasicMaterial;
  private half = 0;

  constructor() {
    this.root.name = "wgp-chapter-placeholder";
    const box = new BoxGeometry(1, 1, 1);
    this.boxes = new InstancedMesh(box, new MeshBasicMaterial({ color: 0xffffff }), MAX);
    this.boxes.count = 0;
    this.boxes.frustumCulled = false;
    this.coneMat = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, depthWrite: false, side: DoubleSide });
    this.cone = new Mesh(new CircleGeometry(CONE_RADIUS, 24, -0.3, 0.6), this.coneMat);
    this.cone.visible = false;
    this.root.add(this.boxes, this.cone);
  }

  private put(i: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw: number, color: Color): number {
    if (i >= MAX) return i;
    _q.setFromAxisAngle(_up, yaw);
    _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
    this.boxes.setMatrixAt(i, _m);
    this.boxes.setColorAt(i, color);
    return i + 1;
  }

  update(frame: RenderFrame3D): void {
    const ch = frame.chapter;
    if (!ch) {
      this.boxes.count = 0;
      this.cone.visible = false;
      return;
    }
    let n = 0;
    for (const k of ch.clues) n = this.put(n, k.pos.x, k.pos.y + 60, k.pos.z, 24, 120, 24, 0, k.found ? GREY : GOLD);
    const m = ch.captive;
    if (m) n = this.put(n, m.pos.x, m.pos.y + 44, m.pos.z, 34, 88, 34, 0, _c.copy(TEAL).lerp(WHITE, m.freed ? 1 : m.restore));
    for (const c of ch.copies) if (c.alive) n = this.put(n, c.pos.x, c.pos.y, c.pos.z, 50, 88, 4, c.yaw, WHITE);
    this.boxes.count = n;
    this.boxes.instanceMatrix.needsUpdate = true;
    if (this.boxes.instanceColor) this.boxes.instanceColor.needsUpdate = true;

    const v = frame.villains.find((x) => x.id === "right-clicker" && x.aim);
    const aim = v?.aim;
    if (!v || !aim) {
      this.cone.visible = false;
      return;
    }
    if (aim.half !== this.half) {
      this.half = aim.half;
      this.cone.geometry.dispose();
      const g = new CircleGeometry(CONE_RADIUS, 24, -aim.half, aim.half * 2);
      // In the xz plane: angle θ points along (cos θ, 0, −sin θ).
      g.rotateX(-Math.PI / 2);
      this.cone.geometry = g;
    }
    this.cone.visible = true;
    this.cone.position.set(v.pos.x, v.pos.y - 40, v.pos.z);
    this.cone.rotation.set(0, Math.atan2(-aim.dir.z, aim.dir.x), 0);
    this.coneMat.opacity = v.state === "flash" ? 0.6 : 0.22;
  }

  dispose(): void {
    this.boxes.geometry.dispose();
    (this.boxes.material as MeshBasicMaterial).dispose();
    this.boxes.dispose();
    this.cone.geometry.dispose();
    this.coneMat.dispose();
  }
}
