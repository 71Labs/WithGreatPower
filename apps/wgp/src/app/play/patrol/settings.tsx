"use client";

/**
 * The 3D night's settings: sound and its two volumes (src/audio/player), the quality tier (picked from the GPU, then the frame rate,
 * until you choose one) and the steady camera (no roll, no shake, a fixed field of view:
 * on by default when the device asks for reduced motion). Remembered in this browser;
 * `?tier=low|medium|high` overrides the tier for testing. The pause sheet shows them.
 */
import { useId } from "react";

import { SoundSliders } from "@/components/game/sound-sliders";
import { TIERS, detectTier, type QualityTier } from "@/game3d/scene/quality";

const KEY = "wgp:3d-settings:v1";

export interface PlaySettings {
  tier: QualityTier;
  /** False once the player picks a tier (or the URL forces one): the frame-rate probe may no longer change it. */
  adaptive: boolean;
  steady: boolean;
}

const isTier = (t: unknown): t is QualityTier => t === "low" || t === "medium" || t === "high";

/** The settings to start with: the URL's tier, the remembered choice, or the GPU's guess. */
export function initialSettings(): PlaySettings {
  const forced = new URLSearchParams(window.location.search).get("tier");
  let saved: { tier?: unknown; steady?: unknown } = {};
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
  };
}

/** Remember a choice the player made (the probe's own tier changes aren't saved). */
export function rememberSettings(next: { tier?: QualityTier; steady?: boolean }) {
  try {
    const prev = JSON.parse(window.localStorage.getItem(KEY) ?? "{}") ?? {};
    window.localStorage.setItem(KEY, JSON.stringify({ ...prev, ...next }));
  } catch {
    // Not remembered, but applied for this visit.
  }
}

const TIER_LABEL: Record<QualityTier, string> = { low: "Smooth", medium: "Balanced", high: "Sharp" };

/** Quality and comfort, for the pause sheet. */
export function SettingsPanel({ settings, onTier, onSteady }: { settings: PlaySettings; onTier(t: QualityTier): void; onSteady(on: boolean): void }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-4 rounded-[16px] border-2 border-game-ink bg-game-paper-2 p-3">
      <SoundSliders toggle />
      <div className="flex flex-col gap-2 border-t-2 border-dashed border-game-ink/30 pt-4">
        <p id={`${id}-q`} className="text-[13px] font-bold leading-4">
          Graphics
        </p>
        <div role="radiogroup" aria-labelledby={`${id}-q`} className="grid grid-cols-3 gap-1 rounded-[12px] border-2 border-game-ink bg-game-paper p-[3px]">
          {TIERS.map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={settings.tier === t}
              onClick={() => onTier(t)}
              className={`h-11 whitespace-nowrap rounded-[8px] px-2 text-[14px] font-semibold focus-visible:outline-offset-2 motion-safe:transition-[background-color,color] motion-safe:duration-150 ${
                settings.tier === t ? "bg-game-ink text-game-paper" : "text-game-ink pointer-fine:hover:bg-game-paper-2"
              }`}
            >
              {TIER_LABEL[t]}
            </button>
          ))}
        </div>
        <p className="text-[12px] leading-4 text-game-muted">{settings.adaptive ? "Set from your device until you pick one." : "Smooth runs best on older phones."}</p>
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
    </div>
  );
}
