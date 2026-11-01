"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { COLUMN, IconTile } from "@/components/frame";
import { GameLoading, useHeroSave, type HeroSave } from "@/components/game/ui";
import { AlertTriangle, BadgeCheck, Check, City, Sparkles } from "@/components/icons";
import { Button, LinkButton } from "@/components/ui";
import { SWING } from "@/game/data";
import { reduce } from "@/game/engine";
import { useGame } from "@/game/store";
import type { MoveId, SwingGrade } from "@/game/types";

import { ErrandStop } from "./errand";
import { FightStop } from "./fight";
import { PatrolHeader } from "./patrol-header";
import { districtName, PatrolMotion, stopName, stopWhat } from "./shared";
import { PatrolSummary } from "./summary";
import { SwingGame } from "./swing";

interface Toast {
  n: number;
  grade: SwingGrade;
  text: string;
}

const TOAST_MS = 3800;

/** What the header says is happening, per phase. */
function headlineFor(save: HeroSave): string {
  const p = save.patrol!;
  const stop = p.stops[p.index];
  switch (p.phase) {
    case "briefing":
      return "Route posted";
    case "swing":
      return `Swinging to ${districtName(stop)}`;
    case "stop":
      if (stop.kind === "errand") return stopWhat(stop);
      if (p.fight?.result === "won") return `Caught ${stopName(stop)}`;
      if (p.fight?.result === "lost") return "Knocked out";
      return `Fighting ${stopName(stop)}`;
    case "summary":
      return save.nightDone ? "All banked" : "The night’s haul";
  }
}

/** A friendly panel for when there's no patrol to play here. */
function Notice({ icon, title, children, action }: { icon: ReactNode; title: string; children: ReactNode; action: ReactNode }) {
  return (
    <section aria-labelledby="patrol-notice" className="rounded-panel bg-canvas p-2 shadow-[var(--shadow-panel)]">
      <div className="flex flex-col items-start gap-5 rounded-card bg-surface px-5 py-8 sm:px-8 sm:py-10">
        <IconTile size={44}>{icon}</IconTile>
        <div className="flex flex-col gap-2">
          <h1 id="patrol-notice" className="font-display text-[26px] font-medium leading-8 tracking-[-0.03em] text-ink-strong">
            {title}
          </h1>
          <p className="max-w-[52ch] text-[15px] leading-6 text-ink-subtle">{children}</p>
        </div>
        {action}
      </div>
    </section>
  );
}

/**
 * One night's patrol, driven by `save.patrol.phase`: swing to a stop, fight or run the
 * errand there, repeat, then bank the night's haul.
 */
export function PatrolScreen() {
  const save = useHeroSave();
  const { dispatch } = useGame();
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  /** After a phase change, put focus and the page back at the top of the patrol. */
  function settle() {
    requestAnimationFrame(() => {
      document.getElementById("patrol-title")?.focus({ preventScroll: true });
      if (window.scrollY > 0) {
        const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        window.scrollTo({ top: 0, behavior: smooth ? "smooth" : "auto" });
      }
    });
  }

  if (!save) return <GameLoading />;
  const p = save.patrol;

  function onSwing(grade: SwingGrade) {
    if (!save?.patrol) return;
    const before = save.patrol;
    const after = reduce(save, { type: "swing", grade }).patrol ?? before;
    const xp = after.swingXp - before.swingXp;
    const text =
      grade === "miss"
        ? `${SWING.miss.label} · −${Math.abs(SWING.miss.hp)} health · combo lost`
        : `${SWING[grade].label} · +${xp} XP · combo ${after.combo}`;
    dispatch({ type: "swing", grade });
    window.clearTimeout(toastTimer.current);
    setToast({ n: (toast?.n ?? 0) + 1, grade, text });
    toastTimer.current = window.setTimeout(() => setToast(null), TOAST_MS);
    settle();
  }

  const onMove = (move: MoveId) => dispatch({ type: "move", move });
  const onChoose = (choice: string) => dispatch({ type: "errand", choice });
  const onLeave = () => {
    dispatch({ type: "leave-stop" });
    settle();
  };

  let body: ReactNode;
  if (!p) {
    body = save.nightDone ? (
      <Notice icon={<BadgeCheck strokeWidth={2} />} title="You’ve patrolled tonight" action={<LinkButton href="/play">Back to tonight</LinkButton>}>
        The city can manage until tomorrow. Probably. Sleep it off from the Tonight page.
      </Notice>
    ) : (
      <Notice icon={<City strokeWidth={2} />} title="No patrol yet tonight" action={<LinkButton href="/play">Go to tonight</LinkButton>}>
        Tonight’s route is posted on the Tonight page. Start your patrol there and swing back here.
      </Notice>
    );
  } else {
    const stop = p.stops[p.index];
    let phase: ReactNode = null;
    if (p.phase === "briefing") {
      phase = (
        <Notice
          icon={<City strokeWidth={2} />}
          title="Tonight’s route is posted"
          action={
            <Button type="button" size="lg" onClick={() => dispatch({ type: "start-patrol" })}>
              Swing out
            </Button>
          }
        >
          Four stops, with a boss at the end. Swing between them, and let go at the right moment for a combo.
        </Notice>
      );
    } else if (p.phase === "swing") {
      phase = <SwingGame key={`swing-${p.index}`} save={save} onDone={onSwing} />;
    } else if (p.phase === "stop") {
      phase =
        stop.kind === "fight" && p.fight ? (
          <FightStop key={`fight-${p.index}`} save={save} onMove={onMove} onLeave={onLeave} />
        ) : (
          <ErrandStop key={`errand-${p.index}`} save={save} onChoose={onChoose} onLeave={onLeave} />
        );
    } else {
      phase = <PatrolSummary save={save} onFinish={() => dispatch({ type: "finish-patrol" })} />;
    }
    body = (
      <>
        <PatrolHeader save={save} headline={headlineFor(save)} />
        {phase}
      </>
    );
  }

  const ToastIcon = toast?.grade === "perfect" ? Sparkles : toast?.grade === "miss" ? AlertTriangle : Check;

  return (
    <div className={`${COLUMN} flex flex-col gap-4 px-4 pb-10 pt-4 sm:gap-5 sm:px-10 sm:pb-16 sm:pt-6`}>
      <PatrolMotion />
      {body}

      {/* The swing result. Always mounted, so screen readers announce each new one. */}
      <div className="pointer-events-none fixed inset-x-0 bottom-[calc(80px+env(safe-area-inset-bottom))] z-30 flex justify-center px-4 md:bottom-8">
        <div role="status" aria-live="polite" aria-atomic="true">
          {toast ? (
            <div
              key={toast.n}
              className="animate-rise flex items-center gap-3 rounded-[16px] bg-canvas py-2 pl-2 pr-4 shadow-[var(--shadow-overlay)]"
            >
              <IconTile size={36}>
                <ToastIcon strokeWidth={2} />
              </IconTile>
              <span className="num text-[14px] font-medium leading-5 text-ink-strong">{toast.text}</span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
