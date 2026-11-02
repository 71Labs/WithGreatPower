/**
 * The 3D sticker city. Import `SceneCanvas` through next/dynamic with `ssr: false` so
 * three.js stays out of every other route's bundle.
 */
export { Scene, SceneCanvas, type SceneCanvasProps, type SceneHandle, type SceneProps, type SceneStats } from "./Scene";
export { ALL_CAST, SceneEngine } from "./engine";
export { QUALITY_PRESETS, TIERS, detectTier, hasWebGL2, type QualityPreset, type QualityTier } from "./quality";
export { BURST_WORDS, type BurstOptions, type BurstWord } from "./effects";
export { CHASE_TUNING, ChaseCamera, createChaseInput, type ChaseInput, type ChasePose, type Raycast } from "./camera/chase";
export { citySolids, createCityRaycast, raycastSolids, surfaceBelow, type CitySolids } from "./camera/raycast";
export { generateFixtureCity } from "./fixture-city";
