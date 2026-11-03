"use client";

/**
 * Paper sheets over the game: the encounter banner, the errand sheet, the pause menu
 * (with How to play), and the reduced-motion choice. The 2D and 3D games share them; the
 * 3D night passes `mode="3d"` for its controls and its settings into the pause menu.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";

import { StickerButton, StickerEyebrow, StickerLink, StickerPanel } from "@/components/game/kit";
import { Award, Heart, Link2, MapIcon, Megaphone, ShieldCheck } from "@/components/icons";
import { DISTRICTS, ERRANDS, VILLAINS, type ErrandChoice } from "@wgp/game-core/data";
import type { PowerId, Stop, VillainId } from "@wgp/game-core/types";

import { Chip, Face, Kbd, POWER_HELP, POWER_ICONS } from "./bits";
import { stopCast } from "./hud";

/* ------------------------------------------------------------------ banner */

export function EncounterBanner({ stop, index, total }: { stop: Extract<Stop, { kind: "fight" }>; index: number; total: number }) {
  const v = VILLAINS[stop.villain];
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[34%] flex justify-center px-4 md:top-[30%] short:top-[84px]">
      <StickerPanel className="animate-rise flex w-full max-w-[460px] items-start gap-4 p-4 sm:p-5">
        <Face id={stop.villain} className="size-20 rounded-[24px] border-[5px] sm:size-24" />
        <div className="flex min-w-0 flex-col gap-2">
          <StickerEyebrow>
            <span className="num">{`Stop ${index + 1} of ${total} · ${DISTRICTS[stop.district].name}`}</span>
          </StickerEyebrow>
          <h2 className="text-[26px] font-bold leading-7 tracking-[-0.02em] text-game-ink sm:text-[30px] sm:leading-8">{v.name}</h2>
          <div className="flex flex-wrap gap-1.5">
            <Chip size="sm" className="num">
              Level {stop.level}
            </Chip>
            {stop.boss ? (
              <Chip size="sm" tone="hero">
                Boss
              </Chip>
            ) : null}
            {stop.quest ? (
              <Chip size="sm" tone="gold">
                Quest
              </Chip>
            ) : null}
          </div>
          <p className="relative mt-1 rounded-[14px] border-2 border-game-ink bg-game-paper-2 px-3 py-2 text-[14px] font-medium leading-5">
            “{v.taunt}”
          </p>
        </div>
      </StickerPanel>
    </div>
  );
}

/** After a win, the villain's defeat line, while he hangs there webbed. */
export function WonCaption({ villain }: { villain: VillainId }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-[max(28px,env(safe-area-inset-bottom))] flex justify-center px-4">
      <StickerPanel className="animate-rise flex max-w-[440px] items-center gap-3 rounded-full py-2 pl-2 pr-5">
        <Face id={villain} className="size-10 rounded-full" />
        <p className="text-[14px] font-semibold leading-5">{VILLAINS[villain].defeat}</p>
      </StickerPanel>
    </div>
  );
}

/* ------------------------------------------------------------------ errands */

function ChoiceEffects({ c }: { c: ErrandChoice }) {
  const items = [
    { icon: Award, value: c.xp, label: "XP" },
    { icon: Heart, value: c.heal ?? 0, label: "health" },
    { icon: Link2, value: c.fluid ?? 0, label: "fluid" },
    { icon: ShieldCheck, value: c.responsibility, label: "responsibility" },
    { icon: Megaphone, value: c.reputation, label: "reputation" },
  ].filter((x) => x.value);
  return (
    <ul className="flex flex-wrap gap-1.5">
      {items.map(({ icon: Icon, value, label }) => (
        <li key={label}>
          <Chip size="sm">
            <Icon aria-hidden className="size-3.5" strokeWidth={2.25} />
            <span className="num">
              {value > 0 ? "+" : "−"}
              {Math.abs(value)}
            </span>
            {label}
          </Chip>
        </li>
      ))}
    </ul>
  );
}

export function ErrandSheet({
  stop,
  chosen,
  onChoose,
  onLeave,
}: {
  stop: Extract<Stop, { kind: "errand" }>;
  chosen: string | null;
  onChoose: (choice: string) => void;
  onLeave: () => void;
}) {
  const errand = ERRANDS.find((e) => e.id === stop.errand);
  const first = useRef<HTMLButtonElement>(null);
  const leave = useRef<HTMLButtonElement>(null);
  const choice = errand?.choices.find((c) => c.id === chosen) ?? null;

  useEffect(() => {
    (choice ? leave.current : first.current)?.focus({ preventScroll: true });
  }, [choice]);

  useEffect(() => {
    if (!errand) return;
    const onKey = (e: KeyboardEvent) => {
      if (choice) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onLeave();
        }
        return;
      }
      const n = Number(e.key);
      if (n >= 1 && n <= errand.choices.length) {
        e.preventDefault();
        onChoose(errand.choices[n - 1].id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [errand, choice, onChoose, onLeave]);

  if (!errand) return null;
  return (
    <div className="absolute inset-x-0 bottom-0 flex justify-center p-3 pb-[max(12px,env(safe-area-inset-bottom))] sm:p-6 short:p-3 short:pb-[max(12px,env(safe-area-inset-bottom))]">
      <StickerPanel as="section" aria-labelledby="errand-title" role="dialog" aria-modal="false" className="animate-rise flex max-h-[calc(100dvh-24px)] w-full max-w-[540px] flex-col gap-4 overflow-y-auto overscroll-contain p-4 sm:p-5 short:gap-3 short:p-4">
        <div className="flex items-start gap-3.5">
          <Face id={stopCast(stop)} className="size-16 rounded-[20px] border-4" />
          <div className="flex min-w-0 flex-col gap-1.5">
            <StickerEyebrow>Errand · {DISTRICTS[errand.district].name}</StickerEyebrow>
            <h2 id="errand-title" className="text-[21px] font-bold leading-6 tracking-[-0.015em] text-game-ink">
              {errand.title}
            </h2>
          </div>
        </div>
        {choice ? (
          <div className="flex flex-col gap-3" role="status">
            <p className="text-[15px] font-medium leading-[22px]">{choice.result}</p>
            <ChoiceEffects c={choice} />
          </div>
        ) : (
          <p className="text-[15px] leading-[22px]">{errand.prompt}</p>
        )}
        {choice ? (
          <StickerButton ref={leave} variant="hero" size="lg" onClick={onLeave} className="w-full">
            Swing on
          </StickerButton>
        ) : (
          <div className="flex flex-col gap-2">
            {errand.choices.map((c, i) => (
              <StickerButton
                key={c.id}
                ref={i === 0 ? first : undefined}
                onClick={() => onChoose(c.id)}
                className="h-auto min-h-12 w-full justify-start whitespace-normal py-2.5 text-left leading-5"
              >
                <Kbd>{i + 1}</Kbd>
                <span>{c.label}</span>
              </StickerButton>
            ))}
          </div>
        )}
      </StickerPanel>
    </div>
  );
}

/* ------------------------------------------------------------------ pause */

const VILLAIN_TIPS = [
  { id: "gas-goblin" as const, tip: "Glides above, dropping fee bombs that hurt and burn fluid. Swing up into him; he climbs out of reach after a hit." },
  { id: "sandwich-man" as const, tip: "Runs the rooftops, lunges at where you’re about to be, and leaves bread traps that clap shut. He hops over webs he sees coming." },
  { id: "doc-octochain" as const, tip: "Four chain arms sweep his bridge. When they pull in and he sags, he’s open: hit him then, or stun him with a yank." },
  { id: "sybil" as const, tip: "Copies orbit and shoot goo. Every hit pops a copy; the real one is last." },
];

const SWINGING: Record<"2d" | "3d", string[]> = {
  "2d": [
    "Hold Space, the mouse, or the left two-thirds of a touch screen to shoot a web at the ringed anchor above you. Let go to fly.",
    "Let go while you’re rising fast and forward for a perfect swing: a boost and +1 combo.",
    "Touching the street costs a little health and your combo. Rooftops are safe: you can land and run.",
    "A and D (or the arrow keys) steer in the air.",
  ],
  "3d": [
    "Hold Space, the left mouse button, or the right side of a touch screen to shoot a web at a building ahead. Let go to fly.",
    "Let go while you’re rising fast and forward for a perfect swing: a boost and +1 combo.",
    "Your webs aim for the next stop. To run and steer, use WASD or the arrow keys, or drag on the left side of a touch screen; directions follow the camera.",
    "Click into the game to look around with the mouse (Esc frees the cursor), or drag with two fingers on a touch screen. The camera settles back behind you.",
    "The pin over the next stop (or the arrow at the edge of the screen) and the dotted line on the minimap show the way. Press M, or tap the minimap, for the whole city.",
    "Gold tokens along the streets are a Bit each; cyan rings boost your swing. Both feed your combo, and its multiplier raises what they score. It runs down faster while you stand on a roof.",
    "Touching the street costs a little health and your combo. Rooftops are safe: you can land and run.",
  ],
};

/** The 3D night on a touch screen: thumbs only, no keys. */
const SWINGING_TOUCH = [
  "Hold anywhere on the right side of the screen to shoot a web at a building ahead. Let go to fly.",
  "Let go while you’re rising fast and forward for a perfect swing: a boost and +1 combo.",
  "Your webs aim for the next stop. To run and steer, put your left thumb down anywhere on the left side and drag: a ring shows where it landed, and directions follow the camera.",
  "Drag with two fingers on one side to look around. The camera settles back behind you.",
  "The pin over the next stop (or the arrow at the edge of the screen) and the dotted line on the minimap show the way. Tap the minimap for the whole city.",
  "Gold tokens along the streets are a Bit each; cyan rings boost your swing. Both feed your combo, and its multiplier raises what they score. It runs down faster while you stand on a roof.",
  "Touching the street costs a little health and your combo. Rooftops are safe: you can land and run.",
];

export function HowToPlay({ loadout, mode = "2d", touch = false }: { loadout: PowerId[]; mode?: "2d" | "3d"; /** The 3D night on a touch screen: the thumb controls, not the keys. */ touch?: boolean }) {
  const thumbs = touch && mode === "3d";
  return (
    <div className="flex flex-col gap-5 text-[14px] leading-5">
      <section className="flex flex-col gap-2">
        <h3 className="text-[15px] font-bold text-game-ink">Swinging</h3>
        <ul className="flex list-disc flex-col gap-1.5 pl-5">
          {(thumbs ? SWINGING_TOUCH : SWINGING[mode]).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="text-[15px] font-bold text-game-ink">Fighting</h3>
        <p>
          {thumbs
            ? "Slam into a villain at speed to land a hit, or tap a power by your right thumb. After a hit he guards for a moment. If Gwei Stacy is with you tonight, her face joins the powers in a fight: tap it to call her."
            : "Slam into a villain at speed to land a hit, or use your powers (keys 1–4). After a hit he guards for a moment. G calls Gwei Stacy if she’s with you tonight."}
        </p>
        <ul className="flex flex-col gap-2">
          {VILLAIN_TIPS.map((v) => (
            <li key={v.id} className="flex items-start gap-2.5">
              <Face id={v.id} className="size-8" />
              <p>
                <span className="font-semibold">{VILLAINS[v.id].name}.</span> {v.tip}
              </p>
            </li>
          ))}
        </ul>
      </section>
      {loadout.length ? (
        <section className="flex flex-col gap-2">
          <h3 className="text-[15px] font-bold text-game-ink">Your powers</h3>
          <ul className="flex flex-col gap-2">
            {loadout.map((id, i) => {
              const Icon = POWER_ICONS[id];
              return (
                <li key={id} className="flex items-start gap-2.5">
                  <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full border-2 border-game-ink bg-game-paper-2">
                    <Icon className="size-4" strokeWidth={2} />
                  </span>
                  <p>
                    <span className="font-semibold">
                      <span className="num">{i + 1}</span>.
                    </span>{" "}
                    {POWER_HELP[id]}
                  </p>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

export function PauseMenu({
  loadout,
  onResume,
  mode = "2d",
  touch = false,
  settings,
  onMap,
}: {
  loadout: PowerId[];
  onResume: () => void;
  mode?: "2d" | "3d";
  /** How to play shows the thumb controls (the 3D night on a touch screen). */
  touch?: boolean;
  /** Extra controls under the actions (the 3D night's quality and comfort settings). */
  settings?: ReactNode;
  /** Open the city map (the 3D night). */
  onMap?: () => void;
}) {
  const [help, setHelp] = useState(false);
  const resume = useRef<HTMLButtonElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Either page starts at its top, wherever the other was scrolled to.
    sheet.current?.scrollTo({ top: 0 });
    if (!help) resume.current?.focus({ preventScroll: true });
  }, [help]);
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-game-night/70 p-4">
      <StickerPanel ref={sheet} as="section" role="dialog" aria-modal="true" aria-labelledby="pause-title" className="animate-rise flex max-h-[min(88dvh,720px)] w-full max-w-[420px] flex-col gap-4 overflow-y-auto overscroll-contain p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 id="pause-title" className="text-[24px] font-bold leading-7 tracking-[-0.02em] text-game-ink">
            {help ? "How to play" : "Paused"}
          </h2>
          {help ? (
            <StickerButton size="sm" onClick={() => setHelp(false)}>
              Back to menu
            </StickerButton>
          ) : null}
        </div>
        {help ? (
          <HowToPlay loadout={loadout} mode={mode} touch={touch} />
        ) : (
          <>
            <p className="text-[14px] leading-5 text-game-muted">Your progress is kept. Come back any time and you’ll pick up at this stop.</p>
            {/* Resume first: on a phone held sideways it's on screen without scrolling. */}
            <div className="flex flex-col gap-2.5">
              <StickerButton ref={resume} variant="hero" size="lg" onClick={onResume} className="w-full">
                Resume
              </StickerButton>
              {onMap ? (
                <StickerButton size="lg" onClick={onMap} aria-keyshortcuts="M" className="w-full">
                  <MapIcon aria-hidden className="size-5" strokeWidth={2} />
                  Open the map
                  <Kbd>M</Kbd>
                </StickerButton>
              ) : null}
            </div>
            {settings}
            <div className="flex flex-col gap-2.5">
              <StickerButton size="lg" onClick={() => setHelp(true)} className="w-full">
                How to play
              </StickerButton>
              <StickerLink href="/play/classic" size="lg" className="w-full">
                Play classic mode
              </StickerLink>
              <StickerLink href="/play" size="lg" className="w-full">
                Back to the city
              </StickerLink>
            </div>
          </>
        )}
      </StickerPanel>
    </div>
  );
}

/* ------------------------------------------------------------------ reduced motion */

export function MotionChoice({ onPlay }: { onPlay: () => void }) {
  const play = useRef<HTMLButtonElement>(null);
  useEffect(() => play.current?.focus({ preventScroll: true }), []);
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-game-night/70 p-4">
      <StickerPanel as="section" role="dialog" aria-modal="true" aria-labelledby="motion-title" className="flex w-full max-w-[440px] flex-col gap-4 p-5">
        <StickerEyebrow>Reduced motion</StickerEyebrow>
        <h2 id="motion-title" className="text-[24px] font-bold leading-7 tracking-[-0.02em] text-game-ink">
          This one swings fast
        </h2>
        <p className="text-[15px] leading-[22px]">
          Your device asks for less motion. Play the city with the slow-motion assist on and no screen shake, or play classic mode: the same night, one turn at a time.
        </p>
        <div className="flex flex-col gap-2.5">
          <StickerButton ref={play} variant="hero" size="lg" onClick={onPlay} className="w-full">
            Play the city
          </StickerButton>
          <StickerLink href="/play/classic" size="lg" className="w-full">
            Play classic mode
          </StickerLink>
        </div>
      </StickerPanel>
    </div>
  );
}
