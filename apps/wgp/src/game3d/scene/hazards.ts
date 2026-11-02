/**
 * Hazards and projectiles from the frame (fee bombs, bread traps, goo, chain arms), pooled:
 * points draw as flat-filled blobs with an ink rim, segments (`to`) as ink-rimmed rods.
 * The rim comes from the view angle, so there is no extra outline pass. Two draw calls at
 * most, none when the frame has no hazards.
 */
import {
  CylinderGeometry,
  DynamicDrawUsage,
  Group,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Quaternion,
  ShaderMaterial,
  Vector3,
} from "three";

import type { RenderFrame3D } from "@wgp/game-core/sim3d/contract";

import { CITY } from "@/game/style";

import { C, rgb, type RGB } from "./palette";

const VERTEX = /* glsl */ `
attribute vec3 aColor;
varying vec3 vN;
varying vec3 vView;
varying vec3 vColor;
void main() {
  vec4 view = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * mat3(instanceMatrix) * normal);
  vView = view.xyz;
  vColor = aColor;
  gl_Position = projectionMatrix * view;
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uInk;
varying vec3 vN;
varying vec3 vView;
varying vec3 vColor;
void main() {
  float facing = abs(dot(normalize(vN), normalize(-vView)));
  vec3 c = vN.y > 0.35 ? vColor : vColor * 0.84;
  gl_FragColor = vec4(facing < 0.38 ? uInk : c, 1.0);
}
`;

const BREAD = "#E9B46A";

/** A hazard's fill from its kind word. */
export function hazardColor(kind: string): RGB {
  const k = kind.toLowerCase();
  if (k.includes("bomb") || k.includes("fee")) return rgb(CITY.windowWarm);
  if (k.includes("bread") || k.includes("trap") || k.includes("sandwich")) return rgb(BREAD);
  if (k.includes("goo") || k.includes("slime")) return rgb(CITY.neonMint);
  if (k.includes("arm") || k.includes("chain")) return C.steel;
  return C.neonRed;
}

const MAX = 32;

export class Hazards {
  readonly root = new Group();
  private readonly blobs: InstancedMesh;
  private readonly rods: InstancedMesh;
  private readonly blobColor = new Float32Array(MAX * 3);
  private readonly rodColor = new Float32Array(MAX * 3);
  private readonly blobAttr: InstancedBufferAttribute;
  private readonly rodAttr: InstancedBufferAttribute;
  private readonly material: ShaderMaterial;
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly p = new Vector3();
  private readonly s = new Vector3();
  private readonly d = new Vector3();
  private static readonly UP = new Vector3(0, 1, 0);

  constructor() {
    this.material = new ShaderMaterial({ vertexShader: VERTEX, fragmentShader: FRAGMENT, uniforms: { uInk: { value: new Vector3(...C.ink) } } });
    const blobGeo = new IcosahedronGeometry(1, 1);
    this.blobAttr = new InstancedBufferAttribute(this.blobColor, 3).setUsage(DynamicDrawUsage);
    blobGeo.setAttribute("aColor", this.blobAttr);
    const rodGeo = new CylinderGeometry(1, 1, 1, 6, 1);
    rodGeo.translate(0, 0.5, 0);
    this.rodAttr = new InstancedBufferAttribute(this.rodColor, 3).setUsage(DynamicDrawUsage);
    rodGeo.setAttribute("aColor", this.rodAttr);
    this.blobs = new InstancedMesh(blobGeo, this.material, MAX);
    this.rods = new InstancedMesh(rodGeo, this.material, MAX);
    for (const mesh of [this.blobs, this.rods]) {
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.visible = false;
      this.root.add(mesh);
    }
    this.root.name = "hazards";
  }

  update(frame: RenderFrame3D): void {
    let nb = 0;
    let nr = 0;
    for (const h of frame.hazards) {
      const color = hazardColor(h.kind);
      const c: RGB = h.armed ? color : [color[0] * 0.6, color[1] * 0.6, color[2] * 0.6];
      if (h.to && nr < MAX) {
        this.d.set(h.to.x - h.pos.x, h.to.y - h.pos.y, h.to.z - h.pos.z);
        const len = this.d.length();
        this.q.setFromUnitVectors(Hazards.UP, this.d.divideScalar(len || 1));
        this.m.compose(this.p.set(h.pos.x, h.pos.y, h.pos.z), this.q, this.s.set(Math.max(3, h.r), len, Math.max(3, h.r)));
        this.rods.setMatrixAt(nr, this.m);
        this.rodColor.set(c, nr * 3);
        nr++;
      } else if (!h.to && nb < MAX) {
        this.m.compose(this.p.set(h.pos.x, h.pos.y, h.pos.z), this.q.identity(), this.s.setScalar(Math.max(4, h.r)));
        this.blobs.setMatrixAt(nb, this.m);
        this.blobColor.set(c, nb * 3);
        nb++;
      }
    }
    this.blobs.count = nb;
    this.rods.count = nr;
    this.blobs.visible = nb > 0;
    this.rods.visible = nr > 0;
    if (nb) {
      this.blobs.instanceMatrix.needsUpdate = true;
      this.blobAttr.needsUpdate = true;
    }
    if (nr) {
      this.rods.instanceMatrix.needsUpdate = true;
      this.rodAttr.needsUpdate = true;
    }
  }

  dispose(): void {
    this.blobs.geometry.dispose();
    this.rods.geometry.dispose();
    this.material.dispose();
    this.blobs.dispose();
    this.rods.dispose();
  }
}
