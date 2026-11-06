"use client";

/**
 * Free roam's pause sheet: resume, the map, how to play (the keys on a keyboard, the thumbs on
 * a touch screen), the 3D settings, and the way back to tonight. What the city found so far is
 * filed when the sheet opens.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";

import { StickerButton, StickerLink, StickerPanel } from "@/components/game/kit";
import { MapIcon } from "@/components/icons";
import { Kbd } from "@/sim/ui/bits";

const KEYS: [string, string][] = [
  ["W A S D", "Run (tap to walk, hold to run; hold C to keep it a walk)"],
  ["Shift", "Sprint"],
  ["Space", "Jump; up a wall, off it, or a launch off the end of a zip"],
  ["F or mouse", "Hold to swing on the web; let go to fly"],
  ["Q", "Zip the web to the marked point"],
  ["E", "Talk, take a photo, sync a viewpoint"],
  ["X", "Let go of a wall or a ledge (on a roof’s edge: drop over it and hang)"],
  ["M", "City map"],
  ["Esc", "Pause"],
];

const THUMBS: [string, string][] = [
  ["Left side", "Drag to run, further to go faster. Double-tap and hold to sprint"],
  ["Right side", "Hold to swing on the web; lift to let go"],
  ["Jump", "Jump; up a wall, off it, or a launch off the end of a zip"],
  ["Zip", "Zip the web to the marked point"],
  ["Sprint", "Toggle a sprint"],
  ["Talk", "Appears when someone’s in reach (or a tag to photograph, a mast to sync)"],
  ["Drop", "Let go of a wall or a ledge"],
  ["Two fingers", "Drag to turn the camera"],
];

function Moves({ touch }: { touch: boolean }) {
  return (
    <div className="flex flex-col gap-5 text-[14px] leading-5">
      <section className="flex flex-col gap-2">
        <h3 className="text-[15px] font-bold">Getting around</h3>
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-pretty">
          <li>The street is safe: walk it, run it, fall into it. Nothing here hurts you, and a hard landing rolls.</li>
          <li>Run into a wall with the stick toward it to climb, and pull the stick back to climb down. At the top you pull yourself over; let go of the stick to hang.</li>
          <li>Low things (AC units, ledges) are vaulted at a run. Sprint along a wall and jump to run along it.</li>
          <li>Running off a roof leaps the gap. Fall past a ledge with the stick toward it to catch it.</li>
          <li>The web only swings while you hold it. The zip pulls you to the point the reticle marks.</li>
        </ul>
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="text-[15px] font-bold">{touch ? "Thumbs" : "Keys"}</h3>
        <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-3 gap-y-1.5">
          {(touch ? THUMBS : KEYS).map(([k, v]) => (
            <Row key={k} k={k} v={v} touch={touch} />
          ))}
        </dl>
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="text-[15px] font-bold">The city</h3>
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-pretty">
          <li>Folks with a gold marker have a task for you. Everyone else just has opinions.</li>
          <li>The Daily Rug’s torn pages are blowing across the city: they tell what the Right-Clicker downloaded.</li>
          <li>Climb a district’s mast and sync it to put its pages on the map.</li>
          <li>Each task, page and mast pays XP once. Free roam is never ranked.</li>
        </ul>
      </section>
    </div>
  );
}

function Row({ k, v, touch }: { k: string; v: string; touch: boolean }) {
  return (
    <>
      <dt className="flex flex-wrap items-center gap-1 font-semibold">
        {touch ? k : k.split(" or ").map((part, i) => (i ? <span key={part} className="contents"><span className="font-normal text-game-muted">or</span><Kbd className="!inline-flex">{part}</Kbd></span> : <Kbd key={part} className="!inline-flex">{part}</Kbd>))}
      </dt>
      <dd className="text-pretty">{v}</dd>
    </>
  );
}

export function RoamPause({ onResume, onMap, touch, settings, filing }: { onResume(): void; onMap(): void; touch: boolean; settings: ReactNode; filing: string | null }) {
  const [help, setHelp] = useState(false);
  const resume = useRef<HTMLButtonElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  useEffect(() => {
    sheet.current?.scrollTo({ top: 0 });
    if (!help) resume.current?.focus({ preventScroll: true });
  }, [help]);
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-game-night/70 p-4">
      <StickerPanel ref={sheet} as="section" role="dialog" aria-modal="true" aria-labelledby="roam-pause-title" className="animate-rise flex max-h-[min(88dvh,720px)] w-full max-w-[440px] flex-col gap-4 overflow-y-auto overscroll-contain p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 id="roam-pause-title" className="text-[24px] font-bold leading-7 tracking-[-0.02em]">
            {help ? "How to play" : "Paused"}
          </h2>
          {help ? (
            <StickerButton size="sm" onClick={() => setHelp(false)}>
              Back to the menu
            </StickerButton>
          ) : null}
        </div>
        {help ? (
          <Moves touch={touch} />
        ) : (
          <>
            <p className="text-[14px] leading-5 text-pretty text-game-muted">{filing ?? "What you’ve found is kept. Come back any time: you’ll pick up where you stood."}</p>
            <div className="flex flex-col gap-2.5">
              <StickerButton ref={resume} variant="hero" size="lg" onClick={onResume} className="w-full">
                Resume
              </StickerButton>
              <StickerButton size="lg" onClick={onMap} aria-keyshortcuts="M" className="w-full">
                <MapIcon aria-hidden className="size-5" strokeWidth={2} />
                Open the map
                <Kbd>M</Kbd>
              </StickerButton>
            </div>
            {settings}
            <div className="flex flex-col gap-2.5">
              <StickerButton size="lg" onClick={() => setHelp(true)} className="w-full">
                Show how to play
              </StickerButton>
              <StickerLink href="/play" size="lg" className="w-full">
                Leave the city
              </StickerLink>
            </div>
          </>
        )}
      </StickerPanel>
    </div>
  );
}
