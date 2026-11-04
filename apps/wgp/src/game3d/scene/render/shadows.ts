/**
 * Moon shadows on the high tier: buildings, props, water towers and the cast cast flat comic
 * shadows from the key light (the direction every face tint and cel band already uses), so a
 * shadow falls exactly where the shading says the dark side is.
 *
 * One orthographic shadow camera looks down the key light over a square that follows the
 * hero (a little ahead of it, toward where the camera looks). The square never turns or
 * changes size, and its centre snaps to whole shadow texels in the light's own plane, so the
 * texels stay put on the world as it moves: no crawling edges. The depth pass draws the back
 * faces of the casters (the boxes are closed), so the lit faces sit well in front of what's
 * stored and need almost no bias. The materials sample it with hardware PCF and fade it out
 * toward the square's edge (city/shaders.ts SHADOW_FRAGMENT).
 *
 * Draw calls: one per caster batch the square touches (a few city sectors, the water
 * towers, the bodies). Memory: a 2048² depth texture and an R8 colour target three needs.
 */
import {
  BackSide,
  DepthTexture,
  FrontSide,
  LessEqualCompare,
  LinearFilter,
  Matrix4,
  MeshBasicMaterial,
  OrthographicCamera,
  RedFormat,
  UnsignedByteType,
  UnsignedIntType,
  Vector3,
  WebGLRenderTarget,
  type Mesh,
  type Object3D,
  type Scene,
  type WebGLRenderer,
} from "three";

import type { SharedUniforms } from "../city/materials";
import { KEY_LIGHT } from "../characters/materials";

/** The layer casters are on (layer 0 is everything the main camera draws). */
export const SHADOW_LAYER = 5;

export const SHADOW = {
  /** Half the square's side, world units (the hero is 88 tall; a block is ~360 across). */
  half: 1150,
  /** How far ahead of the hero the square sits, toward the camera's view, world units. */
  lead: 380,
  /** The camera's distance up the light from the square's centre, and its depth range. */
  distance: 4200,
  /** Normal offset in shadow texels, and constant depth bias in world units. */
  normalTexels: 1.5,
  bias: 1.2,
  /**
   * City boxes thinner than this across both short sides (poles, legs, masts, hangers, wires)
   * cast nothing: a stick's shadow is a few texels wide and would print as a dotted line.
   */
  stick: 12,
} as const;

const _c = new Vector3();
const _right = new Vector3();
const _up = new Vector3();
const _fwd = new Vector3();

export class MoonShadows {
  readonly camera: OrthographicCamera;
  private readonly target: WebGLRenderTarget;
  private readonly depth: DepthTexture;
  private readonly material = new MeshBasicMaterial({ colorWrite: false, side: BackSide });
  private readonly texel: number;
  private readonly bias = new Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
  private scan = 0;

  constructor(
    readonly size: number,
    private readonly shared: SharedUniforms,
  ) {
    const s = SHADOW.half;
    this.camera = new OrthographicCamera(-s, s, s, -s, 1, SHADOW.distance * 2);
    this.camera.layers.set(SHADOW_LAYER);
    // A fixed orientation down the light; only the position moves.
    this.camera.position.copy(KEY_LIGHT);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateMatrixWorld();
    this.depth = new DepthTexture(size, size, UnsignedIntType);
    this.depth.compareFunction = LessEqualCompare;
    this.depth.magFilter = LinearFilter;
    this.depth.minFilter = LinearFilter;
    this.target = new WebGLRenderTarget(size, size, { format: RedFormat, type: UnsignedByteType, depthBuffer: true, stencilBuffer: false, depthTexture: this.depth, generateMipmaps: false });
    this.texel = (2 * s) / size;
    // Instanced city boxes thin in two of their three sizes are dropped (moved off the map).
    this.material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace(
        "#include <project_vertex>",
        `#include <project_vertex>
#ifdef USE_INSTANCING
  {
    vec3 sz = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
    float middle = max(min(sz.x, sz.y), min(max(sz.x, sz.y), sz.z));
    if (middle < ${SHADOW.stick.toFixed(1)}) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
  }
#endif`,
      );
    };
    const p = shared.uShadowParams.value;
    p.set(1, SHADOW.bias / (SHADOW.distance * 2), SHADOW.normalTexels * this.texel, 1 / size);
    shared.uShadowMap.value = this.depth;
  }

  /**
   * Follow the hero (or a point the camera looks at, before a run): the square's centre a
   * little ahead along the camera's view, snapped to whole texels in the light's plane.
   */
  follow(at: { x: number; y: number; z: number }, viewX: number, viewZ: number): void {
    const len = Math.hypot(viewX, viewZ) || 1;
    _c.set(at.x + (viewX / len) * SHADOW.lead, at.y, at.z + (viewZ / len) * SHADOW.lead);
    const cam = this.camera;
    _right.setFromMatrixColumn(cam.matrixWorld, 0);
    _up.setFromMatrixColumn(cam.matrixWorld, 1);
    _fwd.setFromMatrixColumn(cam.matrixWorld, 2);
    const t = this.texel;
    const x = Math.round(_c.dot(_right) / t) * t;
    const y = Math.round(_c.dot(_up) / t) * t;
    const z = _c.dot(_fwd);
    cam.position.set(0, 0, 0).addScaledVector(_right, x).addScaledVector(_up, y).addScaledVector(_fwd, z + SHADOW.distance);
    cam.updateMatrixWorld();
    this.shared.uShadowMatrix.value.copy(this.bias).multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);
  }

  /**
   * Mark the cast's filled bodies as casters (bodies arrive as their files load; the hulls
   * and Sybil's instanced copies stay off). Cheap, so it runs every half second.
   */
  scanCast(root: Object3D): void {
    if (this.scan++ % 30 !== 0) return;
    root.traverse((o) => {
      const m = o as Mesh;
      if ((m as { isSkinnedMesh?: boolean }).isSkinnedMesh && !Array.isArray(m.material) && m.material.side === FrontSide) m.layers.enable(SHADOW_LAYER);
    });
  }

  /** The depth pass: the casters into the shadow map. */
  render(gl: WebGLRenderer, scene: Scene): void {
    const override = scene.overrideMaterial;
    scene.overrideMaterial = this.material;
    gl.setRenderTarget(this.target);
    gl.render(scene, this.camera);
    scene.overrideMaterial = override;
  }

  dispose(): void {
    this.shared.uShadowMap.value = null;
    this.shared.uShadowParams.value.x = 0;
    this.target.dispose();
    this.depth.dispose();
    this.material.dispose();
  }
}
