/**
 * The physics debug overlay for /lab/cast: every visible rig's bones as lines, IK targets
 * as yellow crosses, and Verlet particles (chains, strands, the ragdoll) as mint points.
 * Drawn over everything, off unless switched on.
 */
import { BufferAttribute, BufferGeometry, DynamicDrawUsage, Group, LineBasicMaterial, LineSegments, Points, PointsMaterial, Vector3 } from "three";

import type { Rig } from "./rig";

const MAX_LINES = 1600;
const MAX_POINTS = 600;
const _a = new Vector3();
const _b = new Vector3();

export class RigDebug {
  readonly group = new Group();
  private readonly lines: LineSegments;
  private readonly targets: LineSegments;
  private readonly points: Points;
  private readonly linePos = new Float32Array(MAX_LINES * 6);
  private readonly targetPos = new Float32Array(MAX_LINES * 6);
  private readonly pointPos = new Float32Array(MAX_POINTS * 3);
  private nl = 0;
  private nt = 0;
  private np = 0;

  constructor() {
    const make = (arr: Float32Array) => {
      const g = new BufferGeometry();
      g.setAttribute("position", new BufferAttribute(arr, 3).setUsage(DynamicDrawUsage));
      return g;
    };
    this.lines = new LineSegments(make(this.linePos), new LineBasicMaterial({ color: 0xff3df0, depthTest: false, transparent: true }));
    this.targets = new LineSegments(make(this.targetPos), new LineBasicMaterial({ color: 0xffe14a, depthTest: false, transparent: true }));
    this.points = new Points(make(this.pointPos), new PointsMaterial({ color: 0x00ec97, size: 5, sizeAttenuation: false, depthTest: false, transparent: true }));
    for (const o of [this.lines, this.targets, this.points]) {
      o.frustumCulled = false;
      o.renderOrder = 30;
      this.group.add(o);
    }
    this.group.name = "cast-debug";
    this.group.visible = false;
  }

  begin(): void {
    this.nl = 0;
    this.nt = 0;
    this.np = 0;
  }

  rig(rig: Rig): void {
    for (const bone of rig.bones) {
      const parent = bone.parent;
      if (!parent || !rig.index.has(parent.name)) continue;
      if (this.nl >= MAX_LINES) return;
      _a.setFromMatrixPosition(parent.matrixWorld);
      _b.setFromMatrixPosition(bone.matrixWorld);
      this.linePos.set([_a.x, _a.y, _a.z, _b.x, _b.y, _b.z], this.nl * 6);
      this.nl++;
    }
  }

  target(p: Vector3, size = 3): void {
    for (const [dx, dy, dz] of [
      [size, 0, 0],
      [0, size, 0],
      [0, 0, size],
    ]) {
      if (this.nt >= MAX_LINES) return;
      this.targetPos.set([p.x - dx, p.y - dy, p.z - dz, p.x + dx, p.y + dy, p.z + dz], this.nt * 6);
      this.nt++;
    }
  }

  particles(pos: Float32Array, count = pos.length / 3): void {
    for (let i = 0; i < count && this.np < MAX_POINTS; i++, this.np++) this.pointPos.set([pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]], this.np * 3);
  }

  end(): void {
    const set = (o: LineSegments | Points, n: number) => {
      o.geometry.setDrawRange(0, n);
      (o.geometry.getAttribute("position") as BufferAttribute).needsUpdate = true;
    };
    set(this.lines, this.nl * 2);
    set(this.targets, this.nt * 2);
    set(this.points, this.np);
  }

  dispose(): void {
    for (const o of [this.lines, this.targets, this.points]) {
      o.geometry.dispose();
      (o.material as LineBasicMaterial).dispose();
    }
  }
}
