"use client";

/**
 * The 3D night's settings: sound and its two volumes (src/audio/player), the graphics (Auto: picked from the GPU, then the frame
 * rate; or a tier you pin: Low, Medium, High), whether the minimap keeps north up, the steady camera (no roll, no shake, a fixed field of view:
 * on by default when the device asks for reduced motion), and the look speed (how far a drag or the mouse turns the camera). Remembered in this browser;
 * `?tier=low|medium|high` overrides the tier for testing. The pause sheet shows them.
 */
import { useId, type CSSProperties } from "react";

import { SoundSliders } from "@/components/game/sound-sliders";
import { LOOK_SPEED_MAX, LOOK_SPEED_MIN, LOOK_SPEED_STEP, lookSpeed } from "@/game3d/input/bindings";
import { TIERS, detectTier, type QualityTier } from "@/game3d/scene/quality";

const KEY = "wgp:3d-settings:v1";

export interface PlaySettings {
  tier: QualityTier;
  /** False once the player picks a tier (or the URL forces one): the frame-rate probe may no longer change it. */
  adaptive: boolean;
  steady: boolean;
  /** The minimap keeps north up instead of turning with the camera. */
  northUp: boolean;
  /** The look speed: a multiplier on every camera turn (touch, mouse, drag), 0.5–2. */
  look: number;
}

const isTier = (t: unknown): t is QualityTier => t === "low" || t === "medium" || t === "high";

/** The settings to start with: the URL's tier, the remembered choice, or the GPU's guess. */
export function initialSettings(): PlaySettings {
  const forced = new URLSearchParams(window.location.search).get("tier");
  let saved: { tier?: unknown; steady?: unknown; northUp?: unknown; look?: unknown } = {};
  try {
    saved = JSON.parse(window.localStorage.getItem(KEY) ?? "{}") ?? {};
  } catch {
    // Blocked or corrupt storage: the defaults.
  }
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const pinned = isTier(forced) ? forced : isTier(saved.tier) ? saved.tier : null;
  return {
    tier: pinned ?? detectTier(),
    adaptive: pinned === null,
    steady: typeof saved.steady === "boolean" ? saved.steady : reduced,
    northUp: saved.northUp === true,
    look: lookSpeed(saved.look),
  };
}

/** Remember a choice the player made (the probe's own tier changes aren't saved). `tier: null` forgets the pick (Auto). */
export function rememberSettings(next: { tier?: QualityTier | null; steady?: boolean; northUp?: boolean; look?: number }) {
  try {
    const prev = JSON.parse(window.localStorage.getItem(KEY) ?? "{}") ?? {};
    const merged = { ...prev, ...next };
    if (merged.tier === null) delete merged.tier;
    window.localStorage.setItem(KEY, JSON.stringify(merged));
  } catch {
    // Not remembered, but applied for this visit.
  }
}

/** The graphics choice: Auto (the device's guess, then the frame rate) or a pinned tier. */
export type GraphicsChoice = QualityTier | "auto";

const TIER_NAME: Record<QualityTier, string> = { low: "Low", medium: "Medium", high: "High" };
const GRAPHICS: { value: GraphicsChoice; label: string }[] = [{ value: "auto", label: "Auto" }, ...TIERS.map((t) => ({ value: t, label: TIER_NAME[t] }))];

/** "1×", "1.25×": a look speed as the slider says it. */
export const lookSpeedLabel = (v: number) => `${Number(v.toFixed(2))}×`;

/** Quality and comfort, for the pause sheet. `onLook` adds the look speed slider. */
export function SettingsPanel({ settings, onTier, onSteady, onLook }: { settings: PlaySettings; onTier(t: GraphicsChoice): void; onSteady(on: boolean): void; onLook?(v: number): void }) {
  const id = useId();
  const choice: GraphicsChoice = settings.adaptive ? "auto" : settings.tier;
  return (
    <div className="flex flex-col gap-4 rounded-[16px] border-2 border-game-ink bg-game-paper-2 p-3">
      <SoundSliders toggle />
      <div className="flex flex-col gap-2 border-t-2 border-dashed border-game-ink/30 pt-4">
        <p id={`${id}-q`} className="text-[13px] font-bold leading-4">
          Graphics
        </p>
        <div role="radiogroup" aria-labelledby={`${id}-q`} aria-describedby={`${id}-qh`} className="grid grid-cols-4 gap-1 rounded-[12px] border-2 border-game-ink bg-game-paper p-[3px]">
          {GRAPHICS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={choice === value}
              onClick={() => onTier(value)}
              className={`h-11 whitespace-nowrap rounded-[9px] px-1 text-[14px] font-semibold focus-visible:outline-offset-2 motion-safe:transition-[background-color,color] motion-safe:duration-150 ${
                choice === value ? "bg-game-ink text-game-paper" : "text-game-ink pointer-fine:hover:bg-game-paper-2"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <p id={`${id}-qh`} className="text-[12px] leading-4 text-game-muted text-pretty">
          {settings.adaptive
            ? `Auto picked ${TIER_NAME[settings.tier]} for this device, and steps down if frames run slow.`
            : settings.tier === "high"
              ? "High adds moon shadows and glow. Pick Low on older phones."
              : "Low runs best on older phones; High adds moon shadows and glow."}
        </p>
      </div>
      <label htmlFor={`${id}-s`} className="flex min-h-11 cursor-pointer items-center justify-between gap-3">
        <span className="flex flex-col gap-0.5">
          <span className="text-[13px] font-bold leading-4">Steady camera</span>
          <span className="text-[12px] leading-4 text-game-muted">No tilt, no shake, no zoom with speed.</span>
        </span>
        <input
          id={`${id}-s`}
          type="checkbox"
          role="switch"
          checked={settings.steady}
          onChange={(e) => onSteady(e.currentTarget.checked)}
          className="peer sr-only"
        />
        <span
          aria-hidden
          className="relative h-7 w-12 shrink-0 rounded-full border-2 border-game-ink bg-game-paper peer-checked:bg-game-mint peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-game-hero motion-safe:transition-[background-color] motion-safe:duration-150 after:absolute after:left-[2px] after:top-[2px] after:size-5 after:rounded-full after:border-2 after:border-game-ink after:bg-game-paper after:content-[''] motion-safe:after:transition-[translate] motion-safe:after:duration-150 peer-checked:after:translate-x-5"
        />
      </label>
      {onLook ? (
        <div className="flex flex-col gap-1 border-t-2 border-dashed border-game-ink/30 pt-4">
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor={`${id}-l`} className="text-[13px] font-bold leading-4">
              Look speed
            </label>
            <span aria-hidden className="num text-[12px] font-semibold leading-4 text-game-muted">
              {lookSpeedLabel(settings.look)}
            </span>
          </div>
          {/* The sound sliders above bring the sticker track (.wgp-range). */}
          <input
            id={`${id}-l`}
            type="range"
            min={LOOK_SPEED_MIN}
            max={LOOK_SPEED_MAX}
            step={LOOK_SPEED_STEP}
            value={settings.look}
            aria-describedby={`${id}-lh`}
            aria-valuetext={lookSpeedLabel(settings.look)}
            onChange={(e) => onLook(lookSpeed(e.currentTarget.valueAsNumber))}
            className="wgp-range"
            style={{ "--fill": `${((settings.look - LOOK_SPEED_MIN) / (LOOK_SPEED_MAX - LOOK_SPEED_MIN)) * 100}%` } as CSSProperties}
          />
          <p id={`${id}-lh`} className="text-[12px] leading-4 text-game-muted text-pretty">
            How far a drag on the screen, or the mouse, turns the camera.
          </p>
        </div>
      ) : null}
    </div>
  );
}
