/**
 * Builds the static city from a `City`: per sector, one instanced box mesh (fills) and one
 * instanced hull mesh (ink outlines); one instanced tank mesh and its hull for every water
 * tower; the ground plane; and the traffic (cars driving the street grid, drawn on the GPU
 * from the clock). Everything is created once per city and never touched per frame except
 * shared uniforms and the draw counts the LOD and the tier pick.
 *
 * Each sector's instances are sorted by LOD, so a draw count cuts them: far sectors stop
 * after the buildings and landmarks, near ones go on to rooftop clutter, and on tiers that
 * allow it, street and facade detail.
 *
 * Draw calls: 2 per visible sector (≤ 32), 2 for tanks, 1 for the ground, 2 for cars.
 */
import {
  BufferGeometry,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  PlaneGeometry,
  Quaternion,
  Texture,
  Vector3,
  type Material,
} from "three";

import type { City } from "@wgp/game-core/sim3d/contract";

import { billboardAtlas } from "./billboard-atlas";
import { tankGeometry, unitBox } from "./geometry";
import { buildCityLayout, KIND, type BoxSpec, type CityLayout } from "./layout";
import { buildTraffic, type Traffic } from "./traffic";
import { groundMaterial, hullMaterial, toonMaterial, type SharedUniforms } from "./materials";
import { inferStreets } from "./streets";
import { FOG } from "../palette";

export interface CityMeshes {
  root: Group;
  layout: CityLayout;
  traffic: Traffic;
  /** Show or hide the ink hulls on props (the low tier keeps only the buildings' hulls). */
  setPropOutlines(on: boolean): void;
  /** The highest LOD near sectors draw: 1 (rooftop clutter) or 2 (plus street and facade detail). */
  setDetail(level: number): void;
  /**
   * Per-frame LOD from the camera's ground position: sectors past the second fog band draw
   * their buildings and landmarks only (no rooftop clutter, no prop hulls).
   */
  updateLod(x: number, z: number): void;
  /** Radius around the city centre the ground and skyline reach. */
  horizon: number;
  dispose(): void;
}

const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const _x = new Vector3();
const _y = new Vector3();
const _z = new Vector3();
const UP = new Vector3(0, 1, 0);

function boxMatrix(b: BoxSpec, out: Matrix4): Matrix4 {
  if (b.to) {
    _y.set(b.to.x - b.x, b.to.y - b.y, b.to.z - b.z);
    const len = _y.length();
    const dir = _z.copy(_y).divideScalar(len || 1);
    _x.crossVectors(Math.abs(dir.y) > 0.98 ? _x.set(1, 0, 0) : UP, dir).normalize();
    _z.crossVectors(_x, dir).normalize();
    _x.multiplyScalar(b.w);
    _z.multiplyScalar(b.d);
    out.makeBasis(_x, _y, _z);
    out.setPosition(b.x, b.y, b.z);
    return out;
  }
  _q.setFromAxisAngle(UP, b.yaw);
  return out.compose(_p.set(b.x, b.y, b.z), _q, _s.set(b.w, b.h, b.d));
}

function isPropHull(b: BoxSpec): boolean {
  return b.kind !== KIND.building && b.kind !== KIND.top && b.kind !== KIND.truss;
}

export function buildCityMeshes(city: City, shared: SharedUniforms): CityMeshes {
  const layout = buildCityLayout(city);
  const root = new Group();
  root.name = "wgp-city";
  const box = unitBox();
  const atlas: Texture = billboardAtlas(layout.texts);
  const fillMat = toonMaterial(shared, atlas);
  const hullMat = hullMaterial(shared);
  const tankMat = toonMaterial(shared, atlas, true);
  const geometries: BufferGeometry[] = [box];
  const materials: Material[] = [fillMat, hullMat, tankMat];
  const sectors: { bounds: { x0: number; z0: number; x1: number; z1: number }; fill: InstancedMesh; upTo: number[]; hull: InstancedMesh | null; hullUpTo: number[]; hullBase: number }[] = [];
  let propOutlines = true;
  let detail = 2;
  const near: boolean[] = [];

  const sectorCount = layout.sectors.length;
  for (let s = 0; s < sectorCount; s++) {
    // Always-drawn boxes first, so far sectors can stop the draw before the rooftop clutter.
    const fills = layout.boxes.filter((b) => b.sector === s).sort((a, b) => a.lod - b.lod);
    if (!fills.length) continue;
    // Buildings first, so the low tier can stop the hull draw before the props; then by LOD.
    const hullList = fills.filter((b) => b.hull > 0).sort((a, b) => Number(isPropHull(a)) - Number(isPropHull(b)) || a.lod - b.lod);
    const fillGeo = new BufferGeometry();
    fillGeo.setAttribute("position", box.getAttribute("position"));
    fillGeo.setAttribute("normal", box.getAttribute("normal"));
    fillGeo.setIndex(box.getIndex());
    const color = new Float32Array(fills.length * 3);
    const info = new Float32Array(fills.length * 4);
    const ref = new Float32Array(fills.length * 2);
    fills.forEach((b, i) => {
      color.set(b.color, i * 3);
      info.set([b.kind, b.seed, b.style, b.atlas], i * 4);
      ref.set([b.ref.x, b.ref.z], i * 2);
    });
    fillGeo.setAttribute("aColor", new InstancedBufferAttribute(color, 3));
    fillGeo.setAttribute("aInfo", new InstancedBufferAttribute(info, 4));
    fillGeo.setAttribute("aRef", new InstancedBufferAttribute(ref, 2));
    const fill = new InstancedMesh(fillGeo, fillMat, fills.length);
    fill.name = `sector-${s}`;
    fills.forEach((b, i) => fill.setMatrixAt(i, boxMatrix(b, _m)));
    fill.instanceMatrix.needsUpdate = true;
    fill.computeBoundingSphere();
    fill.matrixAutoUpdate = false;
    root.add(fill);
    geometries.push(fillGeo);

    let hull: InstancedMesh | null = null;
    if (hullList.length) {
      const hullGeo = new BufferGeometry();
      hullGeo.setAttribute("position", box.getAttribute("position"));
      hullGeo.setAttribute("normal", box.getAttribute("normal"));
      hullGeo.setAttribute("aHullDir", box.getAttribute("aHullDir"));
      hullGeo.setIndex(box.getIndex());
      hullGeo.setAttribute("aHull", new InstancedBufferAttribute(new Float32Array(hullList.map((b) => b.hull)), 1));
      hullGeo.setAttribute("aRef", new InstancedBufferAttribute(new Float32Array(hullList.flatMap((b) => [b.ref.x, b.ref.z])), 2));
      const mesh = new InstancedMesh(hullGeo, hullMat, hullList.length);
      mesh.name = `sector-${s}-ink`;
      hullList.forEach((b, i) => mesh.setMatrixAt(i, boxMatrix(b, _m)));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      if (mesh.boundingSphere) mesh.boundingSphere.radius += 24;
      mesh.matrixAutoUpdate = false;
      // Fills first: most hull fragments then fail the depth test early.
      mesh.renderOrder = 1;
      root.add(mesh);
      geometries.push(hullGeo);
      hull = mesh;
    }
    const upTo = [0, 1, 2].map((l) => fills.filter((b) => b.lod <= l).length);
    const hullBase = hullList.filter((b) => !isPropHull(b)).length;
    sectors.push({
      bounds: layout.sectors[s],
      fill,
      upTo,
      hull,
      hullUpTo: [hullBase, ...[1, 2].map((l) => hullList.filter((b) => !isPropHull(b) || b.lod <= l).length)],
      hullBase,
    });
  }

  if (layout.tanks.length) {
    const tank = tankGeometry();
    geometries.push(tank);
    const n = layout.tanks.length;
    const fillGeo = new BufferGeometry();
    fillGeo.setAttribute("position", tank.getAttribute("position"));
    fillGeo.setAttribute("normal", tank.getAttribute("normal"));
    fillGeo.setIndex(tank.getIndex());
    const info = new Float32Array(n * 4);
    const color = new Float32Array(n * 3);
    const ref = new Float32Array(n * 2);
    layout.tanks.forEach((t, i) => {
      info.set([KIND.tank, t.seed, 0, 0], i * 4);
      ref.set([t.ref.x, t.ref.z], i * 2);
    });
    fillGeo.setAttribute("aColor", new InstancedBufferAttribute(color, 3));
    fillGeo.setAttribute("aInfo", new InstancedBufferAttribute(info, 4));
    fillGeo.setAttribute("aRef", new InstancedBufferAttribute(ref, 2));
    const hullGeo = new BufferGeometry();
    hullGeo.setAttribute("position", tank.getAttribute("position"));
    hullGeo.setAttribute("normal", tank.getAttribute("normal"));
    hullGeo.setAttribute("aHullDir", tank.getAttribute("aHullDir"));
    hullGeo.setIndex(tank.getIndex());
    hullGeo.setAttribute("aHull", new InstancedBufferAttribute(new Float32Array(n).fill(0.9), 1));
    hullGeo.setAttribute("aRef", new InstancedBufferAttribute(ref.slice(), 2));
    const fill = new InstancedMesh(fillGeo, tankMat, n);
    const hull = new InstancedMesh(hullGeo, hullMat, n);
    layout.tanks.forEach((t, i) => {
      _m.compose(_p.set(t.x, t.y, t.z), _q.identity(), _s.set(t.w, t.h, t.w));
      fill.setMatrixAt(i, _m);
      hull.setMatrixAt(i, _m);
    });
    for (const mesh of [fill, hull]) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.matrixAutoUpdate = false;
    }
    fill.name = "tanks";
    hull.name = "tanks-ink";
    hull.renderOrder = 1;
    root.add(fill, hull);
    geometries.push(fillGeo, hullGeo);
  }

  // The ground: streets, sidewalks and the river, out to the skyline.
  const cx = (city.bounds.x0 + city.bounds.x1) / 2;
  const cz = (city.bounds.z0 + city.bounds.z1) / 2;
  const half = Math.max(city.bounds.x1 - city.bounds.x0, city.bounds.z1 - city.bounds.z0) / 2;
  const horizon = half * 2.3;
  const groundGeo = new PlaneGeometry(horizon * 2.2, horizon * 2.2);
  groundGeo.rotateX(-Math.PI / 2);
  const groundMat = groundMaterial(shared, inferStreets(city), city.bounds, city.river);
  const ground = new Mesh(groundGeo, groundMat);
  ground.name = "ground";
  ground.position.set(cx, 0, cz);
  ground.updateMatrix();
  ground.matrixAutoUpdate = false;
  ground.renderOrder = -1;
  geometries.push(groundGeo);
  materials.push(groundMat);
  root.add(ground);

  const traffic = buildTraffic(city, shared);
  root.add(traffic.fill, traffic.hull);

  for (let i = 0; i < sectors.length; i++) near.push(true);
  const apply = () => {
    sectors.forEach((sec, i) => {
      const level = near[i] ? detail : 0;
      sec.fill.count = sec.upTo[level];
      if (sec.hull) sec.hull.count = near[i] && propOutlines ? sec.hullUpTo[level] : sec.hullBase;
    });
  };

  return {
    root,
    layout,
    traffic,
    horizon,
    setPropOutlines(on: boolean) {
      propOutlines = on;
      apply();
    },
    setDetail(level: number) {
      detail = Math.max(1, Math.min(2, Math.round(level)));
      apply();
    },
    updateLod(x: number, z: number) {
      let changed = false;
      sectors.forEach((sec, i) => {
        const b = sec.bounds;
        const dx = Math.max(b.x0 - x, 0, x - b.x1);
        const dz = Math.max(b.z0 - z, 0, z - b.z1);
        const isNear = dx * dx + dz * dz < FOG.bands[1] * FOG.bands[1];
        if (isNear !== near[i]) changed = true;
        near[i] = isNear;
      });
      if (changed) apply();
    },
    dispose() {
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      atlas.dispose();
      traffic.dispose();
      for (const child of root.children) if (child instanceof InstancedMesh) child.dispose();
    },
  };
}
