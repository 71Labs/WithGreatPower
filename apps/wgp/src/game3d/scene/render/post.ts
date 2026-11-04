/**
 * The post-processing on the medium and high tiers, with no library: the scene draws into an
 * offscreen target the size of the drawing buffer (multisampled on high), a bloom chain reads
 * the glow every material writes into alpha (post-shaders.ts), and one composite pass draws the
 * picture to the canvas: FXAA where the target isn't multisampled, the speed blur, the bloom,
 * the grade and the vignette.
 *
 * Draw calls: the scene's own, then one per bloom level down, one per level up and one for the
 * composite (10 on high, 8 on medium). Memory: the target (×4 samples on high, resolved once)
 * and the bloom levels, a third of the screen's pixels at most.
 */
import {
  BufferAttribute,
  BufferGeometry,
  HalfFloatType,
  LinearFilter,
  Mesh,
  OrthographicCamera,
  ShaderMaterial,
  UnsignedByteType,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderTarget,
  type Camera,
  type IUniform,
  type Object3D,
  type Texture,
  type TextureDataType,
  type WebGLRenderer,
} from "three";

import type { PostPreset } from "../quality";
import { COMPOSITE_FRAGMENT, DOWN_FRAGMENT, FULLSCREEN_VERTEX, PREFILTER_FRAGMENT, UP_FRAGMENT } from "./post-shaders";

/**
 * The look, picked against the comic palette: a warm-leaning glow, shadows pulled a touch
 * toward indigo and highlights toward the windows' yellow, colour a hair richer, and a
 * vignette that sinks the corners into the night sky's blue.
 */
export const POST_LOOK = {
  bloom: { gain: 1.55, tint: [1.0, 0.96, 0.9] as const, weights: [1, 0.9, 0.85, 0.8, 0.75, 0.7] },
  grade: { low: 0.3, high: 0.16, saturation: 1.07, shoulder: 0.84, lowTint: [0.86, 0.88, 1.12] as const, highTint: [1.06, 1.0, 0.9] as const },
  vignette: { amount: 0.42, start: 0.52, end: 1.15, tint: [0.42, 0.42, 0.66] as const },
  /** The speed blur's strength at full speed-line strength: a smear at the frame's edges only. */
  blur: 0.6,
} as const;

/** Per frame from the scene: how fast the shot feels (the speed lines' strength) and where motion points. */
export interface PostFrame {
  speed: number;
  /** The motion's vanishing point, NDC. */
  focus: Vector2;
}

type Uniforms = Record<string, IUniform>;

function material(fragmentShader: string, uniforms: Uniforms): ShaderMaterial {
  return new ShaderMaterial({ vertexShader: FULLSCREEN_VERTEX, fragmentShader, uniforms, depthTest: false, depthWrite: false });
}

function target(type: TextureDataType, samples = 0, depth = false): WebGLRenderTarget {
  return new WebGLRenderTarget(1, 1, { type, samples, depthBuffer: depth, stencilBuffer: false, minFilter: LinearFilter, magFilter: LinearFilter, generateMipmaps: false });
}

export class Compositor {
  private readonly scene: WebGLRenderTarget;
  private readonly down: WebGLRenderTarget[] = [];
  private readonly up: WebGLRenderTarget[] = [];
  private readonly geo = new BufferGeometry();
  private readonly quad: Mesh;
  private readonly cam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly prefilter: ShaderMaterial;
  private readonly downMat: ShaderMaterial;
  private readonly upMats: ShaderMaterial[] = [];
  private readonly composite: ShaderMaterial;
  private readonly size = new Vector2();
  private readonly want = new Vector2();
  private bloomType: TextureDataType | null = null;

  constructor(readonly preset: PostPreset) {
    this.geo.setAttribute("position", new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.quad = new Mesh(this.geo);
    this.quad.frustumCulled = false;
    this.scene = target(UnsignedByteType, preset.msaa, true);
    this.prefilter = material(PREFILTER_FRAGMENT, { uSrc: { value: null }, uTexel: { value: new Vector2() }, uGain: { value: 1 } });
    this.downMat = material(DOWN_FRAGMENT, { uSrc: { value: null }, uTexel: { value: new Vector2() } });
    const look = POST_LOOK;
    const levels = Math.max(1, preset.bloomLevels);
    const weights = look.bloom.weights.slice(0, levels);
    for (let i = 0; i < levels - 1; i++) {
      this.upMats.push(material(UP_FRAGMENT, { uLow: { value: null }, uCur: { value: null }, uTexel: { value: new Vector2() }, uWeight: { value: weights[i] } }));
    }
    const weightSum = weights.reduce((a, b) => a + b, 0);
    this.composite = material(COMPOSITE_FRAGMENT, {
      uScene: { value: this.scene.texture },
      uBloom: { value: null },
      uTexel: { value: new Vector2() },
      uFxaa: { value: preset.msaa > 0 ? 0 : 1 },
      uBloomGain: { value: look.bloom.gain / weightSum },
      uBloomTint: { value: new Vector3(...look.bloom.tint) },
      uGrade: { value: new Vector4(look.grade.low, look.grade.high, look.grade.saturation, look.grade.shoulder) },
      uLowTint: { value: new Vector3(...look.grade.lowTint) },
      uHighTint: { value: new Vector3(...look.grade.highTint) },
      uVignette: { value: new Vector4(look.vignette.amount, look.vignette.start, look.vignette.end, 1) },
      uVignetteTint: { value: new Vector3(...look.vignette.tint) },
      uBlur: { value: new Vector3(0.5, 0.5, 0) },
    });
  }

  /** The bloom chain at this drawing-buffer size (the levels made on first use, in half floats when the GPU can render them). */
  private resize(gl: WebGLRenderer, w: number, h: number) {
    this.size.set(w, h);
    this.scene.setSize(w, h);
    if (this.bloomType === null) {
      const ext = gl.extensions;
      this.bloomType = ext.has("EXT_color_buffer_float") || ext.has("EXT_color_buffer_half_float") ? HalfFloatType : UnsignedByteType;
      for (let i = 0; i < this.preset.bloomLevels; i++) this.down.push(target(this.bloomType));
      for (let i = 0; i < this.preset.bloomLevels - 1; i++) this.up.push(target(this.bloomType));
    }
    let div = this.preset.bloomScale;
    for (let i = 0; i < this.down.length; i++) {
      const lw = Math.max(1, Math.round(w / div));
      const lh = Math.max(1, Math.round(h / div));
      this.down[i].setSize(lw, lh);
      if (i < this.up.length) this.up[i].setSize(lw, lh);
      div *= 2;
    }
    (this.composite.uniforms.uTexel.value as Vector2).set(1 / w, 1 / h);
    (this.composite.uniforms.uVignette.value as Vector4).w = w / Math.max(1, h);
  }

  private pass(gl: WebGLRenderer, mat: ShaderMaterial, to: WebGLRenderTarget | null) {
    this.quad.material = mat;
    gl.setRenderTarget(to);
    gl.render(this.quad, this.cam);
  }

  /**
   * Start a frame: the renderer's counters then run over every pass until the next frame (the
   * debug stats read the last frame's whole cost, not just the composite).
   */
  beginFrame(gl: WebGLRenderer): void {
    gl.info.autoReset = false;
    gl.info.reset();
  }

  /** Draw a frame: the scene into the target, the bloom chain, then the picture to the canvas. */
  render(gl: WebGLRenderer, scene: Object3D, camera: Camera, frame: PostFrame): void {
    gl.getDrawingBufferSize(this.want);
    if (this.want.x !== this.size.x || this.want.y !== this.size.y || this.bloomType === null) this.resize(gl, this.want.x, this.want.y);

    gl.setRenderTarget(this.scene);
    gl.render(scene, camera);

    const n = this.down.length;
    const p = this.prefilter.uniforms;
    p.uSrc.value = this.scene.texture;
    (p.uTexel.value as Vector2).set(1 / this.size.x, 1 / this.size.y);
    this.pass(gl, this.prefilter, this.down[0]);
    for (let i = 1; i < n; i++) {
      const src = this.down[i - 1];
      this.downMat.uniforms.uSrc.value = src.texture;
      (this.downMat.uniforms.uTexel.value as Vector2).set(1 / src.width, 1 / src.height);
      this.pass(gl, this.downMat, this.down[i]);
    }
    let low: WebGLRenderTarget = this.down[n - 1];
    for (let i = n - 2; i >= 0; i--) {
      const m = this.upMats[i];
      m.uniforms.uLow.value = low.texture;
      m.uniforms.uCur.value = this.down[i].texture;
      (m.uniforms.uTexel.value as Vector2).set(1 / low.width, 1 / low.height);
      this.pass(gl, m, this.up[i]);
      low = this.up[i];
    }

    const c = this.composite.uniforms;
    c.uBloom.value = low.texture as Texture;
    const blur = c.uBlur.value as Vector3;
    blur.set(frame.focus.x * 0.5 + 0.5, frame.focus.y * 0.5 + 0.5, this.preset.speedBlur ? Math.max(0, Math.min(1, frame.speed)) * POST_LOOK.blur : 0);
    this.pass(gl, this.composite, null);
  }

  /** Free the targets and materials, and hand the counters back to the renderer. */
  dispose(gl?: WebGLRenderer): void {
    if (gl) gl.info.autoReset = true;
    this.scene.dispose();
    for (const t of [...this.down, ...this.up]) t.dispose();
    this.geo.dispose();
    for (const m of [this.prefilter, this.downMat, ...this.upMats, this.composite]) m.dispose();
  }
}
