"use client";

/**
 * Free roam's city map (M, the map button, or the pause sheet): the whole city north up, with
 * who has a task for you (a gold marker until it's done), where each task's next step is, the
 * Daily Rug pages (each district's show once its viewpoint is synced), the viewpoint masts, the
 * pickpocket bot while it's out, and you. The list beside it says the same in words. The city
 * waits while it's open; Esc or M closes it.
 */
import { useEffect, useId, useRef } from "react";

import type { SuitColors } from "@/components/cast";
import { StickerEyebrow, StickerIconButton, StickerPanel } from "@/components/game/kit";
import { Check, Newspaper, Rocket, X } from "@/components/icons";
import { NAV_COLORS as K } from "@/game3d/nav/colors";
import { drawCity } from "@/game3d/nav/draw";
import { compass, fitCity, metres, toMap } from "@/game3d/nav/map";
import { Chip, Face, HeroFace, Kbd } from "@/sim/ui/bits";
import { DISTRICTS } from "@wgp/game-core/data";
import { FOLKS, TASKS, TASK_DONE, TASK_IDS, VIEW_NAMES, taskStep, type TaskId } from "@wgp/game-core/city";
import type { CastId } from "@wgp/game-core/cast";
import type { City, RenderFrame3D, RoamFrame, Vec3 } from "@wgp/game-core/sim3d/contract";
import { roamWorld } from "@wgp/game-core/sim3d/roam";

const PAD = 0.035;

/** Where each task's next step is: the giver, the receiver, the bot, or nothing (its items are pinned). */
function taskTarget(id: TaskId, stage: number, roam: RoamFrame): { at: Vec3; who: string } | null {
  const w = roamWorld();
  const giver = w.folks.find((f) => f.gives === id)!;
  // roam-3: Uncle Gen gives Cross-chain and takes it back, but his `takes` is the bread's.
  const taker = w.folks.find((f) => f.takes === id) ?? giver;
  if (stage === 0) return { at: giver, who: FOLKS[giver.key].name };
  if (stage === TASK_DONE) return null;
  if (id === "bread") return { at: taker, who: FOLKS[taker.key].name };
  if (id === "pickpocket") return stage === 1 ? (roam.bot ? { at: roam.bot.pos, who: "the pickpocket bot" } : null) : { at: taker, who: FOLKS[taker.key].name };
  return stage === 2 ? { at: taker, who: FOLKS[taker.key].name } : null;
}

export interface RoamMapProps {
  city: City;
  frame: RenderFrame3D;
  hero: SuitColors;
  onClose(): void;
  still: boolean;
  touch: boolean;
}

export function RoamMap({ city, frame, hero, onClose, still, touch }: RoamMapProps) {
  const id = useId();
  const canvas = useRef<HTMLCanvasElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const roam = frame.roam!;
  const w = roamWorld();

  useEffect(() => {
    close.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const ro = new ResizeObserver(([entry]) => {
      const s = Math.round(entry.contentRect.width);
      if (!s) return;
      el.width = el.height = Math.round(s * dpr);
      const view = fitCity(city.bounds, s, s, s * PAD);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, s, s);
      drawCity(ctx, city, view, null, 1.25);
      // You: an inked arrow the way you face.
      const h = frame.hero.pos;
      const f = frame.hero.facing ?? { x: 1, y: 0, z: 0 };
      const p = toMap(view, h.x, h.z);
      const a = Math.atan2(f.z, f.x) + view.rotation;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(a);
      ctx.beginPath();
      ctx.moveTo(13, 0);
      ctx.lineTo(-9, -9);
      ctx.lineTo(-4, 0);
      ctx.lineTo(-9, 9);
      ctx.closePath();
      ctx.fillStyle = hero.suit;
      ctx.strokeStyle = K.ink;
      ctx.lineWidth = 2.5;
      ctx.lineJoin = "round";
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [city, frame, hero.suit]);

  const unit = fitCity(city.bounds, 1, 1, PAD);
  const pin = (x: number, z: number) => {
    const p = toMap(unit, x, z);
    return { left: `${p.x * 100}%`, top: `${p.y * 100}%` };
  };
  const stages = Object.fromEntries(roam.tasks.map((t) => [t.id, t])) as unknown as Record<TaskId, { stage: number; got: number }>;
  const synced = new Set(w.views.map((v, i) => (roam.views[i]?.synced ? v.district : null)).filter(Boolean));
  const h = frame.hero.pos;
  const active = TASK_IDS.find((t) => stages[t].stage > 0 && stages[t].stage < TASK_DONE) ?? null;
  const target = active ? taskTarget(active, stages[active].stage, roam) : null;
  const where = target ? `${TASKS[active!].title}: ${target.who} is ${metres(Math.hypot(target.at.x - h.x, target.at.z - h.z))} m ${compass(target.at.x - h.x, target.at.z - h.z)} of you.` : "Talk to someone with a gold marker to pick up a task.";
  const hidden = roam.pages.filter((p, i) => !p.found && !synced.has(w.pages[i].district)).length;

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-game-night/70 p-3 sm:p-4">
      <StickerPanel
        as="section"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-where`}
        className="animate-rise flex max-h-[calc(100dvh-24px)] w-full max-w-[920px] flex-col gap-4 overflow-y-auto overscroll-contain p-4 sm:p-5"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1.5">
            <StickerEyebrow>Free roam</StickerEyebrow>
            <h2 id={`${id}-title`} className="text-[24px] font-bold leading-7 tracking-[-0.02em] text-game-ink">
              City map
            </h2>
            <p id={`${id}-where`} className="text-[14px] leading-5 text-pretty text-game-muted">
              {where}
            </p>
          </div>
          <StickerIconButton ref={close} label="Close the map" onClick={onClose} aria-keyshortcuts="Escape M">
            <X aria-hidden strokeWidth={2.25} />
          </StickerIconButton>
        </div>

        <div className="flex flex-col gap-4 md:flex-row md:items-start">
          <div className="relative mx-auto aspect-square w-full max-w-[min(100%,calc(100dvh-220px),560px)] shrink-0 overflow-hidden rounded-[18px] border-[2.5px] border-game-ink bg-game-paper-2 md:w-[min(56vw,calc(100dvh-200px),560px)]">
            <canvas ref={canvas} aria-hidden className="absolute inset-0 block size-full" />
            <div aria-hidden className="contents">
              {/* Viewpoints: a mast, checked once synced. */}
              {roam.views.map((v, i) => (
                <span key={`v${i}`} className="absolute -translate-x-1/2 -translate-y-1/2" style={pin(v.pos.x, v.pos.z)}>
                  <span className={`grid size-7 place-items-center rounded-full border-2 border-game-ink ${v.synced ? "bg-game-mint" : "bg-game-paper"} shadow-[var(--game-shadow-sm)]`}>
                    {v.synced ? <Check className="size-3.5" strokeWidth={3} /> : <Rocket className="size-3.5" strokeWidth={2.25} />}
                  </span>
                </span>
              ))}
              {/* Pages: shown once their district's mast is synced (found ones always). */}
              {roam.pages.map((p, i) =>
                p.found || synced.has(w.pages[i].district) ? (
                  <span key={`p${i}`} className="absolute -translate-x-1/2 -translate-y-1/2" style={pin(p.pos.x, p.pos.z)}>
                    <span className={`grid size-5 place-items-center rounded-[6px] border-2 border-game-ink ${p.found ? "bg-game-paper-2 opacity-60" : "bg-white"}`}>
                      <Newspaper className="size-3" strokeWidth={2.5} />
                    </span>
                  </span>
                ) : null,
              )}
              {/* Mary's pixels and Gas Goblin's tags, while their task is on. */}
              {stages.pixels.stage === 1
                ? roam.pixels.map((p, i) =>
                    p.found ? null : <span key={`x${i}`} className="absolute size-3 -translate-x-1/2 -translate-y-1/2 border-2 border-game-ink bg-[#4FC3F7]" style={pin(p.pos.x, p.pos.z)} />,
                  )
                : null}
              {stages.graffiti.stage === 1
                ? roam.tags.map((t, i) =>
                    t.shot ? null : <span key={`t${i}`} className="absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rotate-45 border-2 border-game-ink bg-[#7CD957]" style={pin(t.pos.x, t.pos.z)} />,
                  )
                : null}
              {/* Task givers: their face, a gold ring until the task's done. */}
              {w.folks
                .filter((f) => f.gives)
                .map((f) => {
                  const st = stages[f.gives!].stage;
                  return (
                    <span key={`f${f.id}`} className="absolute -translate-x-1/2 -translate-y-1/2" style={pin(f.x, f.z)}>
                      <span className="relative block">
                        {st !== TASK_DONE ? <span className={`absolute -inset-1.5 rounded-full border-[3px] border-game-gold ${still ? "" : "wgp-pulse"}`} /> : null}
                        {f.cast ? (
                          <Face id={f.cast as CastId} className={`size-8 ring-2 ring-game-ink ${st === TASK_DONE ? "opacity-60" : ""}`} />
                        ) : (
                          <span className="grid size-8 place-items-center rounded-full border-2 border-game-ink bg-game-gold text-[13px] font-bold">{FOLKS[f.key].name.slice(0, 1)}</span>
                        )}
                        {st === TASK_DONE ? (
                          <span className="absolute -bottom-1.5 -right-1.5 grid size-5 place-items-center rounded-full border-2 border-game-ink bg-game-mint">
                            <Check className="size-3" strokeWidth={3} />
                          </span>
                        ) : null}
                      </span>
                    </span>
                  );
                })}
              {target ? (
                <span className="absolute -translate-x-1/2 -translate-y-1/2" style={pin(target.at.x, target.at.z)}>
                  <span className={`block size-10 rounded-full border-[3px] border-game-hero ${still ? "" : "wgp-ping"}`} />
                </span>
              ) : null}
              {roam.bot && roam.bot.state !== "caught" ? (
                <span className="absolute -translate-x-1/2 -translate-y-1/2" style={pin(roam.bot.pos.x, roam.bot.pos.z)}>
                  <span className="grid size-6 place-items-center rounded-[8px] border-2 border-game-ink bg-game-hero text-[10px] font-bold text-white">BOT</span>
                </span>
              ) : null}
            </div>
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-4">
            <section aria-labelledby={`${id}-tasks`} className="flex flex-col gap-2">
              <h3 id={`${id}-tasks`} className="text-[15px] font-bold">
                Tasks
              </h3>
              <ol className="flex flex-col gap-2">
                {TASK_IDS.map((t) => {
                  const st = stages[t];
                  const giver = w.folks.find((f) => f.gives === t)!;
                  return (
                    <li key={t} aria-current={t === active ? "step" : undefined} className={`flex items-center gap-3 rounded-[14px] border-2 px-2.5 py-2 ${t === active ? "border-game-ink bg-game-paper" : "border-transparent bg-game-paper-2"}`}>
                      {giver.cast ? <Face id={giver.cast as CastId} className="size-9" /> : <span className="grid size-9 shrink-0 place-items-center rounded-[10px] border-2 border-game-ink bg-game-gold text-[15px] font-bold">{FOLKS[giver.key].name.slice(0, 1)}</span>}
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="text-[14px] font-semibold leading-5">{TASKS[t].title}</span>
                        <span className="text-[12px] leading-4 text-pretty text-game-muted">{taskStep(t, st.stage, st.got)}</span>
                      </span>
                      <Chip size="xs" flat tone={st.stage === TASK_DONE ? "mint" : st.stage > 0 ? "gold" : "muted"}>
                        {st.stage === TASK_DONE ? <Check aria-hidden className="size-3" strokeWidth={3} /> : null}
                        {st.stage === TASK_DONE ? "Done" : st.stage > 0 ? "Under way" : "New"}
                      </Chip>
                    </li>
                  );
                })}
              </ol>
            </section>
            <section aria-labelledby={`${id}-finds`} className="flex flex-col gap-1.5">
              <h3 id={`${id}-finds`} className="text-[15px] font-bold">
                Finds
              </h3>
              <p className="num text-[14px] leading-5">
                {roam.pages.filter((p) => p.found).length} of {roam.pages.length} Daily Rug pages · {roam.views.filter((v) => v.synced).length} of {roam.views.length} viewpoints
              </p>
              <p className="text-[13px] leading-[18px] text-pretty text-game-muted">
                {hidden ? `${hidden} pages aren’t on the map yet: sync a district’s mast to reveal its pages.` : "Every page left is on the map."}
              </p>
              <ul className="flex flex-wrap gap-1.5">
                {w.views.map((v, i) => (
                  <li key={i}>
                    <Chip size="xs" flat tone={roam.views[i]?.synced ? "mint" : "muted"}>
                      {roam.views[i]?.synced ? <Check aria-hidden className="size-3" strokeWidth={3} /> : null}
                      {VIEW_NAMES[v.district] ?? DISTRICTS[v.district].name}
                    </Chip>
                  </li>
                ))}
              </ul>
            </section>
            <p className="flex items-center gap-2 text-[13px] leading-5 text-game-muted">
              <HeroFace colors={hero} className="size-6 rounded-full" />
              The arrow is you; the red ring is your next step.
            </p>
            {touch ? null : (
              <p aria-hidden className="hidden items-center gap-1.5 text-[12px] leading-4 text-game-muted pointer-fine:flex">
                <Kbd>M</Kbd>
                <span>or</span>
                <Kbd>Esc</Kbd>
                <span>closes the map.</span>
              </p>
            )}
          </div>
        </div>
      </StickerPanel>
    </div>
  );
}
