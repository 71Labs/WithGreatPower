"use client";

/**
 * Music and effects volumes (and, in the pause sheet, the sound switch), remembered in this
 * browser by src/audio/player. Native range inputs with real labels, drawn as sticker
 * tracks; letting go of the effects slider plays a tap at the new level.
 */
import { useId, useSyncExternalStore, type CSSProperties } from "react";

import { getMix, playSfx, serverMix, setMix, setSoundEnabled, soundEnabled, subscribeSound, type Mix } from "@/audio/player";

const CSS = `
.wgp-range { -webkit-appearance: none; appearance: none; display: block; width: 100%; height: 44px; margin: 0; background: transparent; cursor: pointer; border-radius: 10px; }
.wgp-range:focus-visible { outline: 2px solid var(--game-hero); outline-offset: 2px; }
.wgp-range::-webkit-slider-runnable-track { height: 12px; border: 2px solid var(--game-ink); border-radius: 999px; background: linear-gradient(to right, var(--game-mint) var(--fill), var(--game-paper) var(--fill)); }
.wgp-range::-moz-range-track { height: 8px; border: 2px solid var(--game-ink); border-radius: 999px; background: var(--game-paper); }
.wgp-range::-moz-range-progress { height: 8px; border: 2px solid var(--game-ink); border-radius: 999px; background: var(--game-mint); }
.wgp-range::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 24px; height: 24px; margin-top: -8px; border: 2px solid var(--game-ink); border-radius: 50%; background: var(--game-paper); box-shadow: var(--game-shadow-sm); }
.wgp-range::-moz-range-thumb { width: 20px; height: 20px; border: 2px solid var(--game-ink); border-radius: 50%; background: var(--game-paper); box-shadow: var(--game-shadow-sm); }
`;

const percent = (v: number) => Math.round(v * 100);

function Slider({ label, hint, value, onChange, onCommit }: { label: string; hint: string; value: number; onChange(v: number): void; onCommit?(): void }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-[13px] font-bold leading-4">
          {label}
        </label>
        <span aria-hidden className="num text-[12px] font-semibold leading-4 text-game-muted">
          {percent(value)}%
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={0}
        max={100}
        step={5}
        value={percent(value)}
        aria-valuetext={`${percent(value)}%`}
        aria-describedby={`${id}-hint`}
        onChange={(e) => onChange(Number(e.currentTarget.value) / 100)}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
        className="wgp-range"
        style={{ "--fill": `${percent(value)}%` } as CSSProperties}
      />
      <p id={`${id}-hint`} className="text-[12px] leading-4 text-game-muted">
        {hint}
      </p>
    </div>
  );
}

/** The volume sliders, with the sound switch on top when `toggle` is set (the pause sheet has no other). */
export function SoundSliders({ toggle = false }: { toggle?: boolean }) {
  const id = useId();
  const on = useSyncExternalStore(subscribeSound, soundEnabled, () => true);
  const mix: Mix = useSyncExternalStore(subscribeSound, getMix, serverMix);
  return (
    <div className="flex flex-col gap-3">
      <style href="wgp-sound-sliders" precedence="medium">
        {CSS}
      </style>
      {toggle ? (
        <label htmlFor={`${id}-on`} className="flex min-h-11 cursor-pointer items-center justify-between gap-3">
          <span className="flex flex-col gap-0.5">
            <span className="text-[13px] font-bold leading-4">Play sound</span>
            <span className="text-[12px] leading-4 text-game-muted">Effects, voices and music</span>
          </span>
          <input
            id={`${id}-on`}
            type="checkbox"
            role="switch"
            checked={on}
            onChange={(e) => setSoundEnabled(e.currentTarget.checked)}
            className="peer sr-only"
          />
          <span
            aria-hidden
            className="relative h-7 w-12 shrink-0 rounded-full border-2 border-game-ink bg-game-paper peer-checked:bg-game-mint peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-game-hero motion-safe:transition-[background-color] motion-safe:duration-150 after:absolute after:left-[2px] after:top-[2px] after:size-5 after:rounded-full after:border-2 after:border-game-ink after:bg-game-paper after:content-[''] motion-safe:after:transition-[translate] motion-safe:after:duration-150 peer-checked:after:translate-x-5"
          />
        </label>
      ) : null}
      <Slider label="Music" hint="The score, from the rooftop to the boss." value={mix.music} onChange={(music) => setMix({ music })} />
      <Slider
        label="Effects and voices"
        hint="Webs, hits, the cast and the city at night."
        value={mix.sfx}
        onChange={(sfx) => setMix({ sfx })}
        onCommit={() => playSfx("ui-tap")}
      />
    </div>
  );
}
