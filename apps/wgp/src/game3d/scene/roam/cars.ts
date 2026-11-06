/**
 * Free roam's cars (roam-2), drawn from the sim's frame (`RenderFrame3D.roam.cars`): what's
 * drawn is what hits the hero. The patrol city's decorative traffic (city/traffic.ts) stays off
 * in the City; these take its place, sized as the sim sizes them (CAR_LEN × CAR_WIDE ×
 * CAR_TALL), in the same toon fill and ink as every car.
 *
 * One instanced fill and one instanced ink hull, each car's place and heading a dynamic
 * per-instance attribute written once a frame from the (blended) frame. Two draw calls on
 * every tier: a car that can knock you down is never left undrawn.
 */
import { BackSide, BufferGeometry, DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, ShaderMaterial, Sphere, Vector3 } from "three";

import { CAR_LEN, CAR_TALL, CAR_WIDE } from "@wgp/game-core/sim3d/roam";
import type { City, RoamCarFrame } from "@wgp/game-core/sim3d/contract";

import { CAR_COLORS } from "../palette";
import type { SharedUniforms } from "../city/materials";
import { COMMON } from "../city/shaders";
import { carGeometry, carUniforms, CAR_FRAGMENT, CAR_HULL_FRAGMENT, type CarPart } from "../city/traffic";

/** The sim's car as drawn: a body to the waist of the box and a cabin to its roof (the box's top). */
export const ROAM_BODY: CarPart = { y: 5, h: 22, w: CAR_WIDE, l: CAR_LEN, z: 0 };
export const ROAM_CABIN: CarPart = { y: 27, h: CAR_TALL - 27, w: CAR_WIDE - 6, l: CAR_LEN * 0.55, z: -CAR_LEN * 0.06 };

const PLACE = /* glsl */ `
attribute vec4 aCarAt;   // x, y, z, heading (atan2(x, z) of its way)
vec3 carToWorld(vec3 p, vec3 at, float heading) {
  float c = cos(heading);
  float s = sin(heading);
  return at + vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c);
}
`;

const VERTEX = /* glsl */ `
${COMMON}
${PLACE}
attribute vec3 aColor;
attribute float aPart;
uniform vec3 uFogBands;
varying vec3 vLocal;
flat varying vec3 vN;
flat varying vec3 vColor;
flat varying float vPart;
flat varying float vBand;
flat varying float vTaxi;
varying vec3 vWN;

void main() {
  vec3 at = aCarAt.xyz;
  vec3 world = carToWorld(position, at, aCarAt.w);
  vLocal = position;
  vN = normal;
  vWN = carToWorld(normal, vec3(0.0), aCarAt.w);
  vColor = aColor;
  vPart = aPart;
  vTaxi = aColor.b < 0.5 && aColor.r > 0.9 && aColor.g > 0.8 ? 1.0 : 0.0;
  vBand = fogBand(at.xz, uFogBands);
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const HULL_VERTEX = /* glsl */ `
${COMMON}
${PLACE}
attribute vec3 aHullDir;
uniform float uPxScale;
uniform vec4 uHullPx;
uniform vec3 uFogBands;
flat varying float vBand;

void main() {
  vec3 at = aCarAt.xyz;
  vec3 world = carToWorld(position, at, aCarAt.w);
  vec3 dir = carToWorld(aHullDir, vec3(0.0), aCarAt.w);
  float depth = max(1.0, -(viewMatrix * vec4(world, 1.0)).z);
  float px = mix(uHullPx.x, uHullPx.y, smoothstep(uHullPx.z, uHullPx.w, depth)) * 0.8;
  world += dir * px * depth * uPxScale;
  vBand = fogBand(at.xz, uFogBands);
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

export class RoamCars {
  readonly fill: InstancedMesh;
  readonly hull: InstancedMesh;
  private readonly geo: BufferGeometry;
  private readonly at: Float32Array;
  private readonly atAttr: InstancedBufferAttribute;
  private readonly colorAttr: InstancedBufferAttribute;
  private readonly fillMat: ShaderMaterial;
  private readonly hullMat: ShaderMaterial;
  private painted = -1;

  constructor(
    city: City,
    shared: SharedUniforms,
    readonly max: number,
  ) {
    this.geo = carGeometry(ROAM_BODY, ROAM_CABIN);
    this.at = new Float32Array(max * 4);
    this.atAttr = new InstancedBufferAttribute(this.at, 4).setUsage(DynamicDrawUsage);
    this.colorAttr = new InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.geo.setAttribute("aCarAt", this.atAttr);
    this.geo.setAttribute("aColor", this.colorAttr);
    this.fillMat = new ShaderMaterial({ name: "wgp-roam-car", vertexShader: VERTEX, fragmentShader: CAR_FRAGMENT, uniforms: carUniforms(shared, ROAM_BODY, ROAM_CABIN, 10) });
    this.hullMat = new ShaderMaterial({ name: "wgp-roam-car-ink", vertexShader: HULL_VERTEX, fragmentShader: CAR_HULL_FRAGMENT, side: BackSide, uniforms: { ...shared } });
    this.fill = new InstancedMesh(this.geo, this.fillMat, max);
    this.hull = new InstancedMesh(this.geo, this.hullMat, max);
    // Placed by the shader: the bounds are the whole city.
    const cx = (city.bounds.x0 + city.bounds.x1) / 2;
    const cz = (city.bounds.z0 + city.bounds.z1) / 2;
    const radius = Math.hypot(city.bounds.x1 - city.bounds.x0, city.bounds.z1 - city.bounds.z0) / 2 + 400;
    for (const mesh of [this.fill, this.hull]) {
      mesh.boundingSphere = new Sphere(new Vector3(cx, 0, cz), radius);
      mesh.matrixAutoUpdate = false;
      mesh.count = 0;
    }
    this.fill.name = "roam-cars";
    this.hull.name = "roam-cars-ink";
    this.hull.renderOrder = 1;
  }

  /** Where every car is this frame (the frame's list, in its fixed order). */
  update(cars: readonly RoamCarFrame[]): void {
    const n = Math.min(this.max, cars.length);
    if (this.painted !== n) {
      // Paint by each car's kind (fixed for the outing).
      const col = this.colorAttr.array as Float32Array;
      for (let i = 0; i < n; i++) col.set(CAR_COLORS[cars[i].kind % CAR_COLORS.length], i * 3);
      this.colorAttr.needsUpdate = true;
      this.painted = n;
    }
    const a = this.at;
    for (let i = 0; i < n; i++) {
      const c = cars[i];
      a[i * 4] = c.pos.x;
      a[i * 4 + 1] = c.pos.y;
      a[i * 4 + 2] = c.pos.z;
      a[i * 4 + 3] = c.yaw;
    }
    this.atAttr.needsUpdate = true;
    this.fill.count = this.hull.count = n;
    this.fill.visible = this.hull.visible = n > 0;
  }

  dispose(): void {
    this.geo.dispose();
    this.fillMat.dispose();
    this.hullMat.dispose();
  }
}
