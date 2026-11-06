/**
 * The 3D cast in the city: the hero, the night's villains, the allies on their rooftops and
 * Gwei's swing-in assist, each a rigged, cel-shaded, ink-outlined body posed every frame by
 * its animator from the sim's real motion. Also owns the hero's web (shot, taut, released,
 * missed), a caught villain's dangling strand, Doc's chain arms, the blob shadows and the
 * physics debug overlay.
 *
 * The hero is a real human body: the MPFB model in public/models (hero-model.ts), fetched
 * when the cast is first built (the tier is set by then: the low tier takes the lighter file;
 * the patrol page has usually started the download already, files.ts), moving with
 * motion-capture clips (hero-anims.glb) where it stands, runs, lands, gets hit, punches (when
 * a villain within reach takes a hit) and falls. Until the files arrive, or if they can't
 * load, the procedural hero stands in. The cast's files queue behind the hero's.
 *
 * Draw calls: two per visible body (fill and hull), two for all of Sybil's copies, two for
 * Doc's chains, one per visible strand, one for all the shadows.
 */
import { CircleGeometry, DynamicDrawUsage, Group, InstancedMesh, Matrix4, Object3D, Quaternion, ShaderMaterial, Vector3, type PerspectiveCamera } from "three";

import type { CastId } from "@wgp/game-core/cast";
import type { City, RenderFrame3D, Vec3, Zone } from "@wgp/game-core/sim3d/contract";

import { NODE_COLORS, type SuitColors } from "@/components/cast";

import { raycastSolids, surfaceBelow, type CitySolids } from "../camera/raycast";
import type { SharedUniforms } from "../city/materials";
import { C, FOG } from "../palette";
import type { QualityTier } from "../quality";
import { WebLine } from "../web";
import { AllyAnimator, type AllyStyle } from "./anim/allies";
import type { ActorAnimator } from "./anim/actor";
import { yawOf } from "./anim/common";
import { HeroAnimator } from "./anim/hero";
import type { AnimContext } from "./anim/types";
import { RightClickerAnimator } from "./anim/right-clicker";
import { DocAnimator, GoblinAnimator, SandwichAnimator, SybilAnimator } from "./anim/villains";
import { villainsOf, type SceneVillain, type SceneVillainId } from "../chapter/contract";
import { CAST_DEFS } from "./cast";
import type { Lod } from "./cast/kit";
import { CAST_ANIMS, castAssetNow, castModelUrl, loadCastAsset, UNITS_PER_METRE, type CastAsset, type CastBodyId } from "./cast-asset";
import { CastCopies, CastModel } from "./cast-model";
import { queueAfter, RIGHT_CLICKER_ANIMS } from "./files";
import { ARMS, DocChains } from "./chains";
import { RigDebug } from "./debug";
import { heroAssetNow, heroScale, HERO_ANIMS, HERO_MODEL, loadHeroAsset, loadHeroClips, type HeroAsset, type HeroClips } from "./hero-asset";
import { HeroModel } from "./hero-model";
import { CharacterModel, CopyBatch, type BodyModel } from "./model";
import { WebShot } from "./web-shot";

/** The night's villains, and Case file 001's Right-Clicker (scene/chapter/contract.ts). */
type VillainKey = SceneVillainId;
type AllyKey = "aunt-mainnet" | "uncle-gen" | "mary-jpeg" | "bearson" | "gwei";

const ALLY_STYLE: Record<AllyKey, AllyStyle> = {
  "aunt-mainnet": "clasp",
  "uncle-gen": "behind",
  "mary-jpeg": "hips",
  bearson: "crossed",
  gwei: "perch",
};

/** Levels of detail each kind of body is built with, per tier. */
const LODS: Record<QualityTier, { main: Lod[]; ally: Lod[]; copy: Lod; near: number }> = {
  low: { main: ["lo"], ally: ["min"], copy: "min", near: 0 },
  medium: { main: ["hi", "lo"], ally: ["lo", "min"], copy: "min", near: 520 },
  high: { main: ["hi", "lo"], ally: ["lo", "min"], copy: "min", near: 950 },
};

const SHADOW_VERTEX = /* glsl */ `
void main() {
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
}
`;

const SHADOW_FRAGMENT = /* glsl */ `
uniform vec3 uInk;
void main() { gl_FragColor = vec4(uInk, 0.34); }
`;

interface Actor {
  model: BodyModel;
  anim: ActorAnimator;
  flash: number;
  hits: number;
}

/** The Sybil copies' colours on his body's palette (a grey crowd). */
const COPY_GREY: Record<string, string> = { suit: "#A3A3A0", gloss: "#A3A3A0", eye: "#E4E4E1", white: "#E4E4E1", mouth: "#74746F", tooth: "#D6D6D2" };
/** Poses the copies share among them. */
const COPY_POSES = 3;

/** The Sybil copies, either body. */
type Copies = { kind: "proc"; batch: CopyBatch; anim: SybilAnimator } | { kind: "cast"; batch: CastCopies; anims: SybilAnimator[] };

interface Ally extends Actor {
  zone: Zone;
  at: Vec3;
}

const MAX_SHADOWS = 16;
const _a = new Vector3();
const _b = new Vector3();
const _m = new Matrix4();
const _q = new Quaternion();
const _s = new Vector3();
const _up = new Vector3(0, 1, 0);

export class CharacterSystem {
  readonly root = new Group();
  /** The hero's web. */
  readonly web = new WebLine();
  private readonly strand = new WebLine();
  private readonly gweiWeb = new WebLine();
  private readonly shot = new WebShot();
  private readonly gweiShot = new WebShot();
  private hero: { model: BodyModel; anim: HeroAnimator } | null = null;
  private heroClips: HeroClips | null = null;
  /** The body file asked for in this build, once requested. */
  private heroAsked: string | null = null;
  private disposed = false;
  private readonly villains = new Map<VillainKey, Actor>();
  private copies: Copies | null = null;
  /** The cast's clips (the hero's and the cast's files merged), once loaded. */
  private castClips: HeroClips | null = null;
  private castClipsAsked = false;
  /** Cast body files asked for in this build. */
  private readonly castAsked = new Set<string>();
  private readonly chains: DocChains;
  private readonly allies: Ally[] = [];
  private gwei: { model: BodyModel; anim: HeroAnimator; frame: RenderFrame3D; first: Vector3 | null; last: Vector3 } | null = null;
  private readonly shadows: InstancedMesh;
  private readonly shadowMat: ShaderMaterial;
  private readonly shadowGeo: CircleGeometry;
  private readonly debug = new RigDebug();
  private readonly ctx: AnimContext;
  private readonly heroPos = new Vector3();
  private readonly saved = new Vector3();
  private readonly strandPts = new Float32Array(16 * 3);
  private readonly sockets: Vector3[] = Array.from({ length: ARMS }, () => new Vector3());
  private readonly tips: Vector3[] = Array.from({ length: ARMS }, () => new Vector3());
  private readonly tmp = new Object3D();
  private tier: QualityTier = "medium";
  private colors: SuitColors = NODE_COLORS;
  private cast: CastId[] = [];
  private built = false;
  private wantFlip = false;
  private wantMiss = false;
  private wantPunch = false;
  /** The Right-Clicker's own clips (only fetched on a night he's in). */
  private rcClips: HeroClips | null = null;
  private rcClipsAsked = false;
  /** Case file 001's "SAVED!": seconds the hero's pose stays frozen, and a white wash on him (0–1). */
  private heroFreeze = 0;
  heroWash = 0;
  reducedMotion = false;

  constructor(
    private readonly city: City,
    private readonly solids: CitySolids,
    private readonly shared: SharedUniforms,
  ) {
    this.root.name = "wgp-cast";
    this.ctx = {
      ground: (x, z, y) => surfaceBelow(solids, x, z, y),
      ray: (o, d, max) => raycastSolids(solids, o, d, max),
      reducedMotion: false,
      secondary: true,
      hero: this.heroPos,
    };
    this.chains = new DocChains(shared);
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
    this.shadows = new InstancedMesh(this.shadowGeo, this.shadowMat, MAX_SHADOWS);
    this.shadows.instanceMatrix.setUsage(DynamicDrawUsage);
    this.shadows.frustumCulled = false;
    this.shadows.count = 0;
    this.shadows.renderOrder = 2;
    this.root.add(this.shadows, this.chains.group, this.web.mesh, this.strand.mesh, this.gweiWeb.mesh, this.debug.group);
  }

  /** Whether the bodies are built. */
  get ready(): boolean {
    return this.hero !== null;
  }

  /** Build the hero (in the save's suit), the night's villains and the allies. */
  setCast(heroColors: SuitColors, cast: CastId[]): void {
    this.colors = heroColors;
    this.cast = cast;
    if (this.built) {
      this.hero?.model.setColors(CAST_DEFS.hero.colors(heroColors));
      return;
    }
    this.build();
  }

  private build(): void {
    this.built = true;
    const lods = LODS[this.tier];
    const asset = heroAssetNow(this.heroUrl());
    const heroModel: BodyModel = asset && this.heroClips ? this.heroModel(asset) : new CharacterModel(CAST_DEFS.hero, this.shared, lods.main, this.colors);
    this.heroAsked = asset && this.heroClips ? asset.url : null;
    this.hero = { model: heroModel, anim: this.animateHero(heroModel) };
    this.root.add(heroModel.group);
    // The hero's files first (the tier is settled before the first build); the cast's queue
    // behind them, in the order the night meets them (files.ts).
    this.askHero();
    const villainIds = new Set<VillainKey>(["gas-goblin", "sandwich-man", "doc-octochain", "sybil"].filter((id) => this.cast.includes(id as CastId)) as VillainKey[]);
    for (const z of this.city.zones) if (z.villain) villainIds.add(z.villain);
    const met = (id: CastBodyId) => {
      const i = this.cast.indexOf(id as CastId);
      return i < 0 ? this.cast.length : i;
    };
    const bodies = new Set<CastBodyId>([...villainIds, ...this.city.zones.flatMap((z) => (z.ally ? [z.ally] : []))]);
    for (const id of [...bodies].sort((a, b) => met(a) - met(b))) this.askCast(id);
    for (const id of villainIds) this.villain(id);
    for (const z of this.city.zones) {
      if (!z.ally) continue;
      const id = z.ally;
      const asset = this.castNow(id);
      const model: BodyModel = asset ? this.castModel(asset, "ally") : new CharacterModel(CAST_DEFS[id], this.shared, lods.ally);
      const at = z.allyAt ?? z.center;
      const ally: Ally = { model, anim: this.allyAnimator(id, model), zone: z, at, flash: 0, hits: 0 };
      this.allies.push(ally);
      this.root.add(model.group);
    }
  }

  /* ---------------------------------------------------------------- the cast's bodies */

  private castUrl(id: CastBodyId): string {
    return castModelUrl(id, this.tier === "low");
  }

  /** A cast body that's ready now (file and clips), or null. */
  private castNow(id: CastBodyId): CastAsset | null {
    return this.castClips ? castAssetNow(this.castUrl(id)) : null;
  }

  private castModel(asset: CastAsset, role: "main" | "ally"): CastModel {
    const lods: Lod[] = this.tier === "low" ? ["lo"] : ["hi", "lo"];
    void role;
    return new CastModel(asset, this.shared, lods);
  }

  private allyAnimator(id: AllyKey, model: BodyModel): AllyAnimator {
    const anim = new AllyAnimator(model.rig, model.group, ALLY_STYLE[id]);
    if (model instanceof CastModel && this.castClips) anim.setClips(this.castClips, model.k);
    return anim;
  }

  private villainAnimator(id: VillainKey, model: BodyModel): ActorAnimator {
    const anim =
      id === "gas-goblin"
        ? new GoblinAnimator(model.rig, model.group)
        : id === "sandwich-man"
          ? new SandwichAnimator(model.rig, model.group)
          : id === "doc-octochain"
            ? new DocAnimator(model.rig, model.group)
            : id === "right-clicker"
              ? new RightClickerAnimator(model.rig, model.group)
              : new SybilAnimator(model.rig, model.group);
    anim.strandAnchor = (p, out) => this.strandAnchor(p, out);
    if (model instanceof CastModel && this.castClips) anim.setClips(this.castClips, model.k);
    return anim;
  }

  /** Fetch a character's body file and the cast's clips (once each), then swap the body in. `urgent`: ahead of the queue. */
  private askCast(id: CastBodyId, urgent = false): void {
    const url = this.castUrl(id);
    if (this.castAsked.has(url)) return;
    this.castAsked.add(url);
    if (!this.castClipsAsked) {
      this.castClipsAsked = true;
      Promise.all([loadHeroClips(HERO_ANIMS), loadHeroClips(CAST_ANIMS)]).then(
        ([hero, extra]) => {
          const merged: HeroClips = new Map([...hero, ...extra]);
          merged.pelvisRest = hero.pelvisRest;
          merged.restQ = hero.restQ;
          this.castClips = merged;
          this.mergeRcClips();
          // Bodies that arrived first can come in now.
          for (const u of this.castAsked) {
            const a = castAssetNow(u);
            if (a) this.swapCast(a);
          }
        },
        () => {
          // No clips: the procedural cast carries on.
        },
      );
    }
    loadCastAsset(url, urgent).then(
      (asset) => {
        if (this.castClips) this.swapCast(asset);
      },
      () => {
        // No file: the procedural body carries on.
      },
    );
  }

  /** The Right-Clicker's clips (right-clicker-anims.glb), once, merged into the cast's when both are in. */
  private askRcClips(): void {
    if (this.rcClipsAsked) return;
    this.rcClipsAsked = true;
    loadHeroClips(RIGHT_CLICKER_ANIMS).then(
      (clips) => {
        this.rcClips = clips;
        this.mergeRcClips();
      },
      () => {
        // No file: he plays the cast's clips and his procedural poses.
      },
    );
  }

  private mergeRcClips(): void {
    const all = this.castClips;
    const rc = this.rcClips;
    if (!all || !rc || this.disposed) return;
    for (const [name, clip] of rc) all.set(name, clip);
    const a = this.villains.get("right-clicker");
    if (a && a.model instanceof CastModel) a.anim.setClips(all, a.model.k);
  }

  /**
   * Build a villain's body ahead of its fight (hidden) and start its files: a chapter asks for
   * the Right-Clicker while the hero is still finding the clues.
   */
  prepareVillain(id: VillainKey): void {
    if (this.built) this.villain(id);
  }

  /** "SAVED!": hold the hero's pose for `seconds` (the sim freezes him for as long). */
  freezeHero(seconds: number): void {
    this.heroFreeze = Math.max(this.heroFreeze, seconds);
  }

  /** Put a loaded MPFB body in place of a procedural one, wherever that character is. */
  private swapCast(asset: CastAsset): void {
    if (this.disposed || !this.built || !this.castAsked.has(asset.url) || asset.url !== this.castUrl(asset.meta.who as CastBodyId)) return;
    const id = asset.meta.who as CastBodyId;
    const villain = this.villains.get(id as VillainKey);
    if (villain && !(villain.model instanceof CastModel)) {
      const model = this.castModel(asset, "main");
      model.visible = villain.model.visible;
      this.root.remove(villain.model.group);
      villain.model.dispose();
      villain.model = model;
      villain.anim = this.villainAnimator(id as VillainKey, model);
      this.root.add(model.group);
      if (id === "sybil") this.swapCopies(asset);
    }
    for (const a of this.allies) {
      if (a.zone.ally !== id || a.model instanceof CastModel) continue;
      const model = this.castModel(asset, "ally");
      this.root.remove(a.model.group);
      a.model.dispose();
      a.model = model;
      a.anim = this.allyAnimator(id as AllyKey, model);
      this.root.add(model.group);
    }
    // Her body is ready before she's called, so the assist doesn't hitch building it.
    if (id === "gwei" && !this.gwei) this.makeGwei();
    else if (id === "gwei" && this.gwei && !(this.gwei.model instanceof CastModel)) {
      const g = this.gwei;
      const model = this.castModel(asset, "main");
      model.visible = g.model.visible;
      this.root.remove(g.model.group);
      g.model.dispose();
      g.model = model;
      g.anim = new HeroAnimator(model.rig, model.group, this.ctx);
      g.first = null;
      this.root.add(model.group);
    }
  }

  /** The copies as one instanced draw of the Sybil's own body, in grey. */
  private swapCopies(asset: CastAsset): void {
    if (this.copies?.kind === "cast") return;
    if (this.copies) {
      this.root.remove(this.copies.batch.group);
      this.copies.batch.dispose();
    }
    const colors = asset.meta.names.map((n, i) => COPY_GREY[n] ?? (i === 0 ? asset.meta.palette[0] : "#A3A3A0"));
    const batch = new CastCopies(asset, this.shared, colors, 12, COPY_POSES);
    batch.fill.uniforms.uGlitch.value = 1;
    const anims = batch.rigs.map((rig, i) => {
      const a = new SybilAnimator(rig, batch.holders[i], i * 1.37);
      if (this.castClips) a.setClips(this.castClips, UNITS_PER_METRE);
      return a;
    });
    this.copies = { kind: "cast", batch, anims };
    this.root.add(batch.group);
  }

  private heroUrl(): string {
    return this.tier === "low" ? HERO_MODEL.lo : HERO_MODEL.hi;
  }

  private heroModel(asset: HeroAsset): HeroModel {
    return new HeroModel(asset, this.shared, CAST_DEFS.hero.colors(this.colors), CAST_DEFS.hero.height);
  }

  /** The hero's animator, on the clips when the body is the MPFB one. */
  private animateHero(model: BodyModel): HeroAnimator {
    const anim = new HeroAnimator(model.rig, model.group, this.ctx);
    if (model instanceof HeroModel && this.heroClips) anim.setClips(this.heroClips, heroScale(model.asset, CAST_DEFS.hero.height));
    return anim;
  }

  /** Fetch this tier's body file and the clips (once), and put the hero in them when they arrive. */
  private askHero(): void {
    const url = this.heroUrl();
    if (this.heroAsked === url) return;
    this.heroAsked = url;
    const files = Promise.all([loadHeroAsset(url), loadHeroClips(HERO_ANIMS)]);
    // Nothing queued (the cast, their clips) takes bandwidth from these.
    queueAfter(files);
    files.then(
      ([asset, clips]) => {
        this.heroClips = clips;
        const hero = this.hero;
        if (this.disposed || !hero || this.heroUrl() !== url || hero.model instanceof HeroModel) return;
        const model = this.heroModel(asset);
        model.visible = hero.model.visible;
        this.root.remove(hero.model.group);
        hero.model.dispose();
        this.hero = { model, anim: this.animateHero(model) };
        this.root.add(model.group);
      },
      () => {
        // No file (offline, a bad deploy): the procedural hero carries on.
      },
    );
  }

  private villain(id: VillainKey): Actor {
    const have = this.villains.get(id);
    if (have) return have;
    const asset = this.castNow(id);
    const model: BodyModel = asset ? this.castModel(asset, "main") : new CharacterModel(CAST_DEFS[id], this.shared, LODS[this.tier].main);
    const anim = this.villainAnimator(id, model);
    model.visible = false;
    this.root.add(model.group);
    const actor = { model, anim, flash: 0, hits: -1 };
    this.villains.set(id, actor);
    if (id === "right-clicker") this.askRcClips();
    if (id === "sybil" && !this.copies) {
      if (asset) this.swapCopies(asset);
      else {
        const batch = new CopyBatch(CAST_DEFS["sybil-copy"], this.shared, LODS[this.tier].copy, 12);
        batch.fill.uniforms.uGlitch.value = 1;
        this.copies = { kind: "proc", batch, anim: new SybilAnimator(batch.rig, batch.holder) };
        this.root.add(batch.group);
      }
    }
    this.askCast(id);
    return actor;
  }

  /** Change tier: rebuild at its levels of detail. */
  setTier(tier: QualityTier): void {
    if (tier === this.tier) return;
    this.tier = tier;
    if (!this.built) return;
    this.teardown();
    this.build();
  }

  setReducedMotion(on: boolean): void {
    this.reducedMotion = on;
    this.ctx.reducedMotion = on;
  }

  setDebug(on: boolean): void {
    this.debug.group.visible = on;
  }

  /** Somersault the hero (a perfect release). */
  flip(): void {
    this.wantFlip = true;
  }

  /** A web that found nothing: the strand flies out and drops. */
  fizzle(): void {
    this.wantMiss = true;
  }

  /** A strike (the web button in reach of a villain, ruleset 4): the hero throws a jab or a cross. */
  punch(): void {
    this.wantPunch = true;
  }

  /** Where the hero's web is stuck (after the shot lands), for the sparkle. */
  get stuck(): Vec3 | null {
    return this.shot.stuck;
  }

  /** The hero's web fist (world). */
  handPoint(out: Vector3): Vector3 {
    return this.hero ? out.copy(this.hero.anim.grip) : out.set(0, 0, 0);
  }

  /** Triangles drawn by the cast this frame (fills; hulls double it), for budgets. */
  triangles(): number {
    let n = 0;
    const add = (m: BodyModel) => {
      if (m.visible) n += m.triangles;
    };
    if (this.hero) add(this.hero.model);
    for (const v of this.villains.values()) add(v.model);
    for (const a of this.allies) add(a.model);
    if (this.gwei) add(this.gwei.model);
    if (this.copies?.kind === "cast") n += this.copies.batch.body.count * ((this.copies.batch.body.geometry.getIndex()?.count ?? 0) / 3);
    return n;
  }

  /** A body's joint in the world (the hero, the real villain, an ally or Gwei), for the lab's close camera. */
  jointOf(key: string, joint: string, out: Vector3): Vector3 | null {
    let m: BodyModel | null = null;
    if (key === "hero") m = this.hero?.model ?? null;
    else if (this.villains.has(key as VillainKey)) m = this.villains.get(key as VillainKey)!.model;
    else m = this.allies.find((a) => a.zone.ally === key)?.model ?? (key === "gwei" ? (this.gwei?.model ?? null) : null);
    if (!m || !m.visible) return null;
    return out.setFromMatrixPosition(m.rig.get(joint).matrixWorld);
  }

  /** Which way a body faces (yaw, radians; 0 is +z), for the lab's camera. */
  facingOf(key: string): number | null {
    const at = this.jointOf(key, "hips", _a);
    if (!at) return null;
    let m: BodyModel | null = null;
    if (key === "hero") m = this.hero?.model ?? null;
    else if (this.villains.has(key as VillainKey)) m = this.villains.get(key as VillainKey)!.model;
    else m = this.allies.find((a) => a.zone.ally === key)?.model ?? null;
    if (!m) return null;
    // The root bone carries the body's turn: its forward (+z in the model's frame at rest).
    const root = m.rig.bones[0];
    const f = _b.set(0, 0, 1).applyQuaternion(_q.setFromRotationMatrix(_m.extractRotation(root.matrixWorld)).multiply(m.rig.restWorld[0].clone().invert()));
    return Math.atan2(f.x, f.z);
  }

  /** The body animators, for the lab. */
  get heroAnimator(): HeroAnimator | null {
    return this.hero?.anim ?? null;
  }

  private fogMix(p: Vec3, camera: Vector3): number {
    const d = Math.hypot(camera.x - p.x, camera.z - p.z);
    const b = FOG.bands;
    const band = d < b[0] ? 0 : d < b[1] ? 1 : d < b[2] ? 2 : 3;
    // Half the city's fog: bodies are what you play against, so they stay readable.
    return FOG.amount[band] * 0.5;
  }

  private lodFor(model: BodyModel, p: Vec3, camera: Vector3, nearScale = 1): void {
    const near = LODS[this.tier].near * nearScale;
    const d = Math.hypot(camera.x - p.x, camera.y - p.y, camera.z - p.z);
    model.setLod(d < near && model.hasLod("hi") ? "hi" : model.hasLod("lo") ? "lo" : "min");
    model.fill.uniforms.uFogMix.value = this.fogMix(p, camera);
  }

  /** A roof edge above a caught villain to hang the strand from (or straight up). */
  private strandAnchor(p: Vector3, out: Vector3): Vector3 {
    const s = this.solids;
    let best = Infinity;
    out.set(p.x, p.y + 230, p.z);
    for (let i = 0; i < s.count; i++) {
      const top = s.maxY[i];
      if (top < p.y + 90 || top > p.y + 520) continue;
      const x = Math.min(s.maxX[i], Math.max(s.minX[i], p.x));
      const z = Math.min(s.maxZ[i], Math.max(s.minZ[i], p.z));
      const d = Math.hypot(x - p.x, z - p.z);
      if (d > 420 || d < 1) continue;
      const score = d + (top - p.y) * 0.4;
      if (score < best) {
        best = score;
        out.set(x, top, z);
      }
    }
    return out;
  }

  update(frame: RenderFrame3D, camera: PerspectiveCamera, size: { width: number; height: number }, dt: number, time: number): void {
    if (this.hero) this.askHero();
    // Gwei swings in to assist in fights: her body comes once the first fight starts.
    if (this.built && (frame.mode === "fight" || frame.hazards.some((h) => h.kind === "gwei"))) this.askCast("gwei", true);
    const hero = this.hero;
    if (!hero) return;
    const cam = camera.position;
    const ctx = this.ctx;
    this.heroPos.set(frame.hero.pos.x, frame.hero.pos.y, frame.hero.pos.z);
    const debug = this.debug.group.visible;
    if (debug) this.debug.begin();
    let shadows = 0;
    const shadow = (p: Vec3, size: number) => {
      if (shadows >= MAX_SHADOWS) return;
      const ground = surfaceBelow(this.solids, p.x, p.z, p.y);
      const lift = Math.max(0, p.y - ground);
      const s = size * (1 - Math.min(0.65, lift / 700));
      this.tmp.position.set(p.x, ground + 1.5, p.z);
      this.tmp.scale.set(s, 1, s * 0.75);
      this.tmp.updateMatrix();
      this.shadows.setMatrixAt(shadows++, this.tmp.matrix);
    };

    // The hero.
    const ha = hero.anim;
    const hm = hero.model;
    ctx.secondary = true;
    if (this.wantFlip) ha.flip(this.reducedMotion);
    this.wantFlip = false;
    if (this.wantPunch) ha.punch();
    this.wantPunch = false;
    const rival = frame.mode === "fight" ? (frame.villains.find((v) => !v.copy) ?? frame.villains[0]) : undefined;
    ha.lookAt(rival ? rival.pos : null);
    // "SAVED!" (Case file 001): the pose holds still like a screenshot while the sim freezes him.
    if (this.heroFreeze > 0) this.heroFreeze = Math.max(0, this.heroFreeze - dt);
    else ha.update(frame, dt, ctx);
    hm.visible = frame.mode !== "done";
    this.lodFor(hm, frame.hero.pos, cam);
    const flash = frame.hero.hurtFlash > 0 && Math.floor(time * 16) % 2 === 0;
    hm.fill.uniforms.uFlash.value = Math.max(flash ? 0.7 : 0, this.heroWash);
    hm.fill.uniforms.uFade.value = frame.hero.cloak ? 0.55 : 0;
    if (hm.visible) shadow(ha.centre, 40);
    if (debug) this.debugActor(hm, ha.targets, ha.ragdollPoints());

    // The hero's web: shot, taut, let go, or missed.
    const vel = _a.set(frame.hero.vel.x, frame.hero.vel.y, frame.hero.vel.z);
    if (this.wantMiss) {
      const f = frame.hero.facing ?? (Math.hypot(vel.x, vel.z) > 1 ? { x: vel.x, y: 0, z: vel.z } : { x: 0, y: 0, z: 1 });
      const fl = Math.hypot(f.x, f.z) || 1;
      this.shot.miss(ha.grip, _b.set(ha.grip.x + (f.x / fl) * 230, ha.grip.y + 250, ha.grip.z + (f.z / fl) * 230), this.reducedMotion);
    }
    this.wantMiss = false;
    this.shot.update(ha.grip, frame.hero.anchor, vel, dt, this.reducedMotion);
    this.web.setPoints(this.shot.points, this.shot.count, size.width, size.height, this.shot.widthScale);

    // Villains: the real one by id, Sybil's copies as one instanced batch.
    for (const v of this.villains.values()) v.model.visible = false;
    let copies = 0;
    let strandShown = false;
    let docSeen = false;
    for (const v of villainsOf(frame)) {
      if (v.copy) {
        copies++;
        continue;
      }
      const actor = this.villain(v.id);
      const { model, anim } = actor;
      model.visible = true;
      // The SCREENSHOT's cone: he squares up to it.
      if (anim instanceof RightClickerAnimator) anim.aimDir = v.aim?.dir ?? null;
      if (actor.hits >= 0 && v.hits < actor.hits) {
        actor.flash = 0.3;
        anim.struck();
        // A blow in reach: the hero throws a punch with it.
        if (Math.hypot(v.pos.x - this.heroPos.x, v.pos.y - this.heroPos.y, v.pos.z - this.heroPos.z) < 170) ha.punch();
      }
      actor.hits = v.hits;
      actor.flash = Math.max(0, actor.flash - dt);
      anim.update({ pos: v.pos, vel: v.vel, facing: v.facing, state: v.state, stateTicks: v.stateTicks, bank: v.bank }, dt, ctx);
      this.lodFor(model, v.pos, cam);
      model.fill.uniforms.uFlash.value = actor.flash > 0 && Math.floor(time * 16) % 2 === 0 ? 0.7 : 0;
      model.fill.uniforms.uWebbed.value = anim.webbed.value;
      shadow(anim.centre, 50);
      if (anim.dangle.active) {
        const n = anim.strandPoints(this.strandPts);
        this.strand.setPoints(this.strandPts, n, size.width, size.height);
        strandShown = true;
      }
      if (v.id === "doc-octochain") {
        docSeen = true;
        this.updateChains(frame, v, model, dt);
      }
      if (debug) this.debugActor(model, anim.targets, anim.dangle.active ? anim.dangle.v.pos : null);
    }
    if (!strandShown) this.strand.mesh.visible = false;
    if (!docSeen) this.chains.update(dt, this.sockets, null, false);
    else if (debug) this.debug.particles(this.chains.points());
    this.updateCopies(frame, copies, dt, cam);

    // Allies wait on their rooftops; far ones aren't drawn or animated.
    const allyCtx = this.tier !== "low";
    for (const a of this.allies) {
      const d = Math.hypot(cam.x - a.at.x, cam.y - a.at.y, cam.z - a.at.z);
      const show = d < 3200;
      a.model.visible = show;
      if (!show) continue;
      ctx.secondary = allyCtx;
      const near = Math.hypot(this.heroPos.x - a.at.x, this.heroPos.z - a.at.z) < 520;
      // An errand open with them, or (free roam) a line they're saying to you.
      const open = (frame.mode === "errand" && frame.stop === a.zone.index) || !!frame.roam?.folks.some((f) => f.talking && f.cast === a.zone.ally);
      a.anim.update({ pos: a.at, state: open ? "talk" : near ? "wave" : "idle" }, dt, ctx);
      // Allies take their full body only up close (an errand), villains from further out.
      this.lodFor(a.model, a.at, cam, 0.6);
      shadow(a.at, 34);
      if (debug) this.debugActor(a.model, a.anim.targets, null);
    }
    ctx.secondary = true;

    this.updateGwei(frame, dt, size, cam);
    this.shadows.count = shadows;
    this.shadows.instanceMatrix.needsUpdate = true;
    if (debug) this.debug.end();
  }

  private debugActor(model: BodyModel, targets: Vector3[], points: Float32Array | null): void {
    if (!model.visible) return;
    this.debug.rig(model.rig);
    for (const t of targets) this.debug.target(t);
    if (points) this.debug.particles(points);
  }

  private updateChains(frame: RenderFrame3D, v: SceneVillain, model: BodyModel, dt: number): void {
    const sockets = CAST_DEFS["doc-octochain"].sockets!;
    const names = ["armUL", "armUR", "armLL", "armLR"];
    const roots = this.sockets;
    let n = 0;
    let fromSim = false;
    if (v.arms && v.arms.length >= ARMS) {
      // The sim's own shoulder → tip segments: the chains hang exactly where the arms hit.
      for (let i = 0; i < ARMS; i++) {
        roots[i].set(v.arms[i].from.x, v.arms[i].from.y, v.arms[i].from.z);
        this.tips[i].set(v.arms[i].to.x, v.arms[i].to.y, v.arms[i].to.z);
      }
      n = ARMS;
      fromSim = true;
    } else {
      for (const hz of frame.hazards) {
        if (hz.kind !== "arm" || !hz.to || n >= ARMS) continue;
        this.tips[n++].set(hz.to.x, hz.to.y, hz.to.z);
      }
    }
    if (!fromSim) {
      // The boom ends on his harness, from the rig (the MPFB body's file lists its own).
      const own = model instanceof CastModel ? model.asset.meta.sockets : null;
      for (let i = 0; i < ARMS; i++) {
        const o = own?.[names[i]];
        const s = o ? { bone: o.bone, at: [o.at[0] * UNITS_PER_METRE, o.at[1] * UNITS_PER_METRE, o.at[2] * UNITS_PER_METRE] } : sockets[names[i]];
        const bone = model.rig.get(s.bone);
        roots[i].set(s.at[0], s.at[1], s.at[2]).sub(model.rig.joints.get(s.bone)!).applyMatrix4(bone.matrixWorld);
      }
    }
    if (n < ARMS) {
      // No arms in the frame (an old sim): let them hang from the harness.
      for (let i = 0; i < ARMS; i++) this.tips[i].copy(roots[i]).add(_b.set((i % 2 ? -1 : 1) * 14, -46, 6));
    }
    this.chains.update(dt, roots, this.tips, model.visible, fromSim);
  }

  private updateCopies(frame: RenderFrame3D, count: number, dt: number, cam: Vector3): void {
    const c = this.copies;
    if (!c) return;
    c.batch.setCount(count);
    if (count === 0) return;
    // Shared poses, posed at the origin facing +z (the hero far off down +z)…
    const ctx = this.ctx;
    const saved = this.saved.copy(this.heroPos);
    this.heroPos.set(0, 0, 1000);
    const state = frame.villains.find((v) => v.copy)?.state ?? "idle";
    const origin = { x: 0, y: 0, z: 0 };
    if (c.kind === "proc") c.anim.update({ pos: origin, state }, dt, ctx);
    else for (const a of c.anims) a.update({ pos: origin, state }, dt, ctx);
    this.heroPos.copy(saved);
    c.batch.commitPose();
    // …then each copy placed and turned toward the hero.
    let i = 0;
    for (const v of frame.villains) {
      if (!v.copy) continue;
      const yaw = yawOf(this.heroPos.x - v.pos.x, this.heroPos.z - v.pos.z);
      _m.compose(_b.set(v.pos.x, v.pos.y, v.pos.z), _q.setFromAxisAngle(_up, yaw), _s.set(1, 1, 1));
      if (c.kind === "proc") c.batch.setInstance(i, _m);
      else c.batch.setInstance(i, _m, i);
      i++;
    }
    c.batch.commitInstances();
    c.batch.fill.uniforms.uFogMix.value = this.fogMix(frame.villains.find((v) => v.copy)!.pos, cam);
  }

  /** Gwei's body and animator for her assist (hidden until she swings in). */
  private makeGwei(): void {
    const asset = this.castNow("gwei");
    const model: BodyModel = asset ? this.castModel(asset, "main") : new CharacterModel(CAST_DEFS.gwei, this.shared, LODS[this.tier].main);
    model.visible = false;
    this.root.add(model.group);
    const f: RenderFrame3D = {
      tick: 0,
      alpha: 1,
      hero: { pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, anchor: null, grounded: false, hp: 1, maxHp: 1, fluid: 0, hurtFlash: 0, shield: false },
      villains: [],
      hazards: [],
      stop: 0,
      mode: "fight",
      timeScale: 1,
    };
    this.gwei = { model, anim: new HeroAnimator(model.rig, model.group, this.ctx), frame: f, first: null, last: new Vector3() };
  }

  /** Gwei's assist: she swings through on her own web (the hazard named "gwei"). */
  private updateGwei(frame: RenderFrame3D, dt: number, size: { width: number; height: number }, cam: Vector3): void {
    const hz = frame.hazards.find((h) => h.kind === "gwei");
    if (!hz) {
      if (this.gwei) {
        this.gwei.model.visible = false;
        this.gwei.first = null;
      }
      this.gweiWeb.mesh.visible = false;
      return;
    }
    if (!this.gwei) this.makeGwei();
    const g = this.gwei!;
    const p = hz.pos;
    if (!g.first) {
      g.first = new Vector3(p.x, p.y, p.z);
      g.last.set(p.x, p.y, p.z);
    }
    const h = g.frame.hero;
    const k = 1 / Math.max(dt, 1 / 240);
    h.vel.x = (p.x - g.last.x) * k;
    h.vel.y = (p.y - g.last.y) * k;
    h.vel.z = (p.z - g.last.z) * k;
    g.last.set(p.x, p.y, p.z);
    h.pos.x = p.x;
    h.pos.y = p.y;
    h.pos.z = p.z;
    // The sim's anchor when the frame carries it, else a pivot above her path.
    const anchor = hz.to ?? { x: (g.first.x + p.x) / 2, y: Math.max(g.first.y, p.y) + 260, z: (g.first.z + p.z) / 2 };
    h.anchor = h.anchor ?? { x: 0, y: 0, z: 0 };
    h.anchor.x = anchor.x;
    h.anchor.y = anchor.y;
    h.anchor.z = anchor.z;
    g.model.visible = true;
    g.anim.update(g.frame, dt, this.ctx);
    // She swings through fast: her full body only when she passes close.
    this.lodFor(g.model, p, cam, 0.5);
    this.gweiShot.update(g.anim.grip, h.anchor, _a.set(h.vel.x, h.vel.y, h.vel.z), dt, this.reducedMotion);
    this.gweiWeb.setPoints(this.gweiShot.points, this.gweiShot.count, size.width, size.height, this.gweiShot.widthScale);
  }

  private teardown(): void {
    const all: BodyModel[] = [];
    if (this.hero) all.push(this.hero.model);
    for (const v of this.villains.values()) all.push(v.model);
    for (const a of this.allies) all.push(a.model);
    if (this.gwei) all.push(this.gwei.model);
    for (const m of all) {
      this.root.remove(m.group);
      m.dispose();
    }
    if (this.copies) {
      this.root.remove(this.copies.batch.group);
      this.copies.batch.dispose();
    }
    this.hero = null;
    this.heroAsked = null;
    this.villains.clear();
    this.allies.length = 0;
    this.gwei = null;
    this.copies = null;
    this.castAsked.clear();
    this.built = false;
  }

  dispose(): void {
    this.disposed = true;
    this.teardown();
    this.chains.dispose();
    this.web.dispose();
    this.strand.dispose();
    this.gweiWeb.dispose();
    this.debug.dispose();
    this.shadowGeo.dispose();
    this.shadowMat.dispose();
    this.shadows.dispose();
  }
}

