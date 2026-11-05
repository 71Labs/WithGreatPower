/**
 * The Market District's fee meter, the thing Gas Goblin hijacked: a brass gas-pump gauge on a
 * short post (about 75 tall), its dial on both faces (green, amber, a red MAX), the needle set by
 * the frame's `heat`, a hose on one side and, jammed in a slot in the other, its admin key: page
 * 41 of Aunt Mainnet's recipe book, out of the Right-Clicker's Downloads.
 *
 * Where it is: on its roof until he grabs it; hung under his glider on a strap while `carried`,
 * swinging behind his flight (still under reduced motion); planted on Aunt Mainnet's roof after.
 * While it cools it shakes through a fee spike's wind-up (not under reduced motion).
 *
 * Two draws when it's on screen, the body's boxes and the dials (its glow and the
 * spike's ring are the scene's glow and decal batches).
 */
import { CircleGeometry, Group, Mesh, ShaderMaterial } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import type { Vec3 } from "@wgp/game-core/sim3d/contract";

import type { SharedUniforms } from "../city/materials";
import { rgb } from "../palette";
import { NEEDLE_SWEEP, needleAngle, swingTilt } from "./math";
import { BoxBatch, WOOD_DARK } from "./props";
import { DIAL_FRAGMENT, DIAL_VERTEX } from "./shaders";

/** The meter's height (units), its dial's centre height and radius. */
export const METER_TALL = 75;
const DIAL_Y = 52;
const DIAL_R = 13;
/** Carried: drawn at this size, hung this far under the glider's deck on its strap. */
const CARRIED_SCALE = 0.62;
const STRAP = 26;
/** The glider's deck is about this far under Gas Goblin's centre. */
const DECK_DROP = 36;

const POST = rgb("#3C4156");
const BRASS = rgb("#E2A63C");
const BRASS_DARK = rgb("#B8862E");
const HOSE = rgb("#222433");
const SLOT = rgb("#222433");
const PAGE = rgb("#FFF4DE");
const PAGE_RED = rgb("#E5392C");

export class FeeMeter3D {
  /** The pivot: the meter's base on a roof, or the strap's top under his glider. */
  readonly root = new Group();
  private readonly inner = new Group();
  private readonly boxes: BoxBatch;
  private readonly dial: Mesh;
  private readonly dialMat: ShaderMaterial;
  private strapped: boolean | null = null;
  reducedMotion = false;
  /** Where the dial's centre is in the world this frame (for the glow). */
  readonly dialAt = { x: 0, y: 0, z: 0 };

  constructor(shared: SharedUniforms) {
    this.root.name = "fee-meter";
    this.boxes = new BoxBatch(shared, 16, "fee-meter-body");
    const front = new CircleGeometry(DIAL_R, 28);
    front.translate(0, DIAL_Y, 10.6);
    const back = new CircleGeometry(DIAL_R, 28);
    back.rotateY(Math.PI);
    back.translate(0, DIAL_Y, -10.6);
    const geo = mergeGeometries([front, back])!;
    front.dispose();
    back.dispose();
    this.dialMat = new ShaderMaterial({
      name: "wgp-fee-dial",
      vertexShader: DIAL_VERTEX,
      fragmentShader: DIAL_FRAGMENT,
      uniforms: { uNeedle: { value: 0 }, uHeat: { value: 1 }, uTime: shared.uTime, uStill: { value: 0 }, uSweep: { value: NEEDLE_SWEEP }, uFog: shared.uFog, uFogBands: shared.uFogBands, uFogAmt: shared.uFogAmt },
    });
    this.dial = new Mesh(geo, this.dialMat);
    this.dial.name = "fee-meter-dial";
    this.inner.add(this.boxes.mesh, this.dial);
    this.root.add(this.inner);
    this.build(false);
  }

  /** The body's boxes, with the strap when it's carried. */
  private build(strap: boolean): void {
    if (this.strapped === strap) return;
    this.strapped = strap;
    const b = this.boxes;
    b.clear();
    b.add(0, 0, 0, 26, 3, 26, 0, POST);
    b.add(0, 3, 0, 10, 30, 10, 0, POST);
    b.add(0, 30, 0, 32, 40, 20, 0, BRASS);
    b.add(0, 70, 0, 36, 5, 24, 0, BRASS_DARK);
    // The hose down the right side, its nozzle hooked on.
    b.add(18, 18, 0, 4, 40, 4, 0, HOSE);
    b.add(18, 54, 4, 6, 10, 6, 0, HOSE);
    // The admin key on the left: a recipe page jammed in a slot, its red corner showing.
    b.add(-16.5, 50, 0, 2, 14, 12, 0, SLOT);
    b.add(-20, 47, 0, 7, 22, 1.4, 0, PAGE);
    b.add(-22.6, 64, 0, 2.2, 5, 1.6, 0, PAGE_RED);
    if (strap) {
      b.add(0, METER_TALL, 0, 4, STRAP / CARRIED_SCALE, 4, 0, WOOD_DARK);
      b.add(0, METER_TALL + STRAP / CARRIED_SCALE - 3, 0, 16, 3, 4, 0, WOOD_DARK);
    }
    b.commit();
  }

  /**
   * Place it for this frame: `base` (feet level) on a roof, or under `glider` (Gas Goblin's
   * centre and velocity) while carried; `heat` sets the needle; `shake` 0–1 through a spike's
   * wind-up.
   */
  update(base: Vec3, carried: boolean, glider: { pos: Vec3; vel?: Vec3 } | null, heat: number, shake: number, time: number): void {
    const still = this.reducedMotion;
    this.build(carried);
    if (carried) {
      const at = glider ? glider.pos : { x: base.x, y: base.y + 58, z: base.z };
      this.root.position.set(at.x, at.y - DECK_DROP, at.z);
      const tilt = swingTilt(glider?.vel, still);
      this.root.rotation.set(tilt.x, 0, tilt.z);
      this.inner.position.set(0, -(STRAP + METER_TALL * CARRIED_SCALE), 0);
      this.inner.scale.setScalar(CARRIED_SCALE);
    } else {
      const jig = still || shake <= 0 ? 0 : shake * 2.5;
      this.root.position.set(base.x + Math.sin(time * 47) * jig, base.y, base.z + Math.cos(time * 53) * jig);
      this.root.rotation.set(0, 0, still || shake <= 0 ? 0 : Math.sin(time * 39) * 0.03 * shake);
      this.inner.position.set(0, 0, 0);
      this.inner.scale.setScalar(1);
    }
    this.root.updateMatrixWorld(true);
    const e = this.inner.matrixWorld.elements;
    // The dial's centre in the world: the inner frame's origin plus DIAL_Y up its own y.
    this.dialAt.x = e[12] + e[4] * DIAL_Y;
    this.dialAt.y = e[13] + e[5] * DIAL_Y;
    this.dialAt.z = e[14] + e[6] * DIAL_Y;
    const u = this.dialMat.uniforms;
    u.uNeedle.value = needleAngle(heat, time, still);
    u.uHeat.value = heat;
    u.uStill.value = still ? 1 : 0;
  }

  set visible(on: boolean) {
    this.root.visible = on;
  }

  dispose(): void {
    this.boxes.dispose();
    this.dial.geometry.dispose();
    this.dialMat.dispose();
  }
}
