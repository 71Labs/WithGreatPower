/**
 * Playing a 3D night: the fixed-step loop around game-core's Run, the HUD snapshot, scene
 * effects and sound from sim events, the IndexedDB recording that survives a reload, and
 * the ranked, guest and unranked ways a night starts and ends. No three.js here; the
 * scene reads the loop's view.
 */
export { nightAudio } from "./audio";
export { blendFrame, copyFrame, SNAP_DISTANCE, teleported } from "./blend";
export { sceneEffects, type EffectsTarget } from "./effects";
export { hudSnapshot, LegTracker, routeProgress, stopPositions } from "./hud";
export { INTRO_SECONDS, MAX_STEPS, OUTRO_SECONDS, RunLoop, type LoopEvent3D, type LoopOptions, type LoopStatus } from "./loop3d";
export {
  beginLocal,
  beginLocalChapter,
  beginRanked,
  chapterLocalSeed,
  endNight,
  localSeed,
  resumeRecording,
  tonightRank,
  type NightMode,
  type NightOutcome,
  type NightSession,
  type RankedStart,
} from "./night";
export { chapterHud } from "./hud";
export { clearRecording, loadRecording, RECORD_EVERY_MS, RunRecorder, saveRecording, type Recording, type RecordingMode } from "./recorder";
