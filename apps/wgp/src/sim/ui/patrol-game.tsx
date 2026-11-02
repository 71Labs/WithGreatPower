"use client";

/**
 * The real-time patrol: a full-screen layer over the app shell. It builds the sim from
 * the save (resuming at `patrol.index` / `phase`), runs the loop and the canvas outside
 * React, turns sim events into engine actions, and shows the HUD, sheets and results.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from "react";

import { stopMusic } from "@/audio/player";
import { simAudio } from "@/audio/sim-audio";
import { StickerLink, StickerPanel } from "@/components/game/kit";
import { castById, type CastId } from "@wgp/game-core/cast";
import { ALLY_CAST, ERRANDS, SUITS, VILLAINS } from "@wgp/game-core/data";
import { reduce, type Action } from "@wgp/game-core/engine";
import { useGame } from "@/game/store";
import type { Save, Stop } from "@wgp/game-core/types";

import { actionFor, sessionStart } from "../bridge";
import { botInput, createSim, debugSetHp, debugTeleport, debugWin, DT, newBotMemory, resolveErrand, type SimState } from "../core";
import { HudStore, SimLoop, type LoopEvent } from "../loop";
import { CityBackdrop } from "../render/backdrop";
import { GameRenderer } from "../render/renderer";
import { buildSprites } from "../render/sprites";
import { useCoarsePointer, useHeroSave, useReducedMotion, type HeroSave } from "./hooks";
import { Hud, useHud } from "./hud";
import { Results } from "./results";
import { EncounterBanner, ErrandSheet, MotionChoice, PauseMenu, WonCaption } from "./sheets";

declare global {
  interface Window {
    __wgpSim?: Record<string, unknown>;
  }
}

const castOf = (stop: Stop): CastId => (stop.kind === "fight" ? stop.villain : ALLY_CAST[stop.ally]);

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="absolute inset-0 flex items-center justify-center p-4">{children}</div>;
}

function Notice({ nightDone }: { nightDone: boolean }) {
  return (
    <>
      <CityBackdrop className="absolute inset-0" />
      <Centered>
        <StickerPanel as="section" aria-labelledby="notice-title" className="flex w-full max-w-[420px] flex-col gap-3 p-5">
          <h1 id="notice-title" className="text-[24px] font-bold leading-7 tracking-[-0.02em] text-game-ink">
            {nightDone ? "You’ve patrolled tonight" : "No patrol yet tonight"}
          </h1>
          <p className="text-[15px] leading-[22px]">
            {nightDone ? "The city can manage until tomorrow. Probably. Sleep it off from the city." : "Tonight’s route is posted in the city. Start your patrol there and swing back here."}
          </p>
          <StickerLink href="/play" variant="hero" size="lg" className="w-full">
            Back to the city
          </StickerLink>
        </StickerPanel>
      </Centered>
    </>
  );
}

function Loading() {
  return (
    <Centered>
      <p role="status" className="rounded-full border-[2.5px] border-game-ink bg-game-paper px-5 py-2.5 text-[15px] font-semibold shadow-[var(--game-shadow)]">
        Suiting up…
      </p>
    </Centered>
  );
}

const noop = () => () => {};

/** `?debug=1&backdrop=1` shows the menu backdrop alone, for checking it. */
function useBackdropOnly(): boolean {
  return useSyncExternalStore(
    noop,
    () => {
      const q = new URLSearchParams(window.location.search);
      return q.get("debug") === "1" && q.get("backdrop") === "1";
    },
    () => false,
  );
}

export function PatrolGame() {
  const save = useHeroSave();
  const { dispatch } = useGame();
  const backdropOnly = useBackdropOnly();
  let body: React.ReactNode;
  if (backdropOnly) body = <CityBackdrop className="absolute inset-0" />;
  else if (!save) body = <Loading />;
  else if (!save.patrol) body = <Notice nightDone={save.nightDone} />;
  else if (save.patrol.phase === "summary")
    body = (
      <>
        <CityBackdrop className="absolute inset-0" />
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-game-night/50" />
        <Results save={save} onFinish={() => dispatch({ type: "finish-patrol" })} />
      </>
    );
  else body = <PlaySurface key={save.patrol.night} save={save} />;
  return <div className="fixed inset-0 z-[60] overflow-hidden bg-game-night text-game-ink">{body}</div>;
}

interface Session {
  loop: SimLoop;
  send: (a: Action) => void;
  save: () => Save;
}

function PlaySurface({ save }: { save: HeroSave }) {
  const { dispatch } = useGame();
  const [boot] = useState(save);
  const [hudStore] = useState(() => new HudStore());
  const hud = useHud(hudStore);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const session = useRef<Session | null>(null);
  const pointers = useRef(new Set<number>());
  const keys = useRef({ left: false, right: false });
  const autoErrands = useRef(false);
  const lastAnnounce = useRef(0);
  const [ready, setReady] = useState(false);
  const [positions, setPositions] = useState<number[]>([]);
  const [errand, setErrand] = useState<{ index: number; chosen: string | null } | null>(null);
  const [paused, setPaused] = useState(false);
  const [announce, setAnnounce] = useState("");
  const [assist, setAssist] = useState(false);
  const reduced = useReducedMotion();
  const touch = useCoarsePointer();
  const colors = SUITS[save.hero.suit].colors;
  const needsChoice = ready && reduced && !assist;
  const blocked = paused || !!errand || needsChoice;

  const say = useCallback((text: string, urgent = false) => {
    const now = performance.now();
    if (!urgent && now - lastAnnounce.current < 1500) return;
    lastAnnounce.current = now;
    setAnnounce(text);
  }, []);

  const leave = useCallback(() => {
    const ses = session.current;
    if (!ses) return;
    ses.send({ type: "leave-stop" });
    const p = ses.save().patrol;
    if (p) resolveErrand(ses.loop.state, { hp: p.hp, fluid: p.fluid });
    setErrand(null);
  }, []);

  const choose = useCallback(
    (id: string) => {
      const ses = session.current;
      if (!ses) return;
      const p = ses.save().patrol;
      const stop = p?.stops[p.index];
      if (!p || stop?.kind !== "errand" || p.results.length > p.index) return;
      ses.send({ type: "errand", choice: id });
      setErrand((e) => (e ? { ...e, chosen: id } : e));
      if (autoErrands.current) window.setTimeout(leave, 600);
    },
    [leave],
  );

  // Build the sim, the loop and the renderer once, and run the frame loop outside React.
  useEffect(() => {
    let cancelled = false;
    let raf = 0;
    let renderer: GameRenderer | null = null;
    let s: Save = boot;
    const send = (a: Action) => {
      s = reduce(s, a);
      dispatch(a);
    };
    for (let i = 0; i < 3; i++) {
      const st = sessionStart(s);
      if (st.kind === "start") send({ type: "start-patrol" });
      else if (st.kind === "leave") send({ type: "leave-stop" });
      else break;
    }
    const start = sessionStart(s);
    if (start.kind !== "play") return;
    const sim = createSim(start.config);
    const loop = new SimLoop(sim, { hud: hudStore });
    session.current = { loop, send, save: () => s };
    const stops = s.patrol!.stops;
    const reducedNow = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const ids: CastId[] = [...stops.map(castOf), "gwei", "aunt-mainnet"];

    const onEvent = (ev: LoopEvent) => {
      renderer?.onEvent(ev, loop.state);
      if (ev.type !== "countdown" && ev.type !== "go" && ev.type !== "status") {
        const action = actionFor(ev);
        if (action) send(action);
      }
      switch (ev.type) {
        case "encounter": {
          const stop = stops[ev.index] as Extract<Stop, { kind: "fight" }>;
          say(`${VILLAINS[ev.villain].name}${stop.boss ? ", the boss" : ""}${stop.quest ? ", tonight’s quest" : ""}: “${VILLAINS[ev.villain].taunt}”`, true);
          break;
        }
        case "fight-live":
          say("Fight!", true);
          break;
        case "hero-hurt":
          say(`Hit by ${ev.source}, ${ev.damage} damage. Health ${ev.hp}.`);
          break;
        case "villain-hit":
          if (ev.hits > 0) say(`Hit! ${ev.hits} to go.`);
          break;
        case "fight-won":
          say(`Webbed! ${VILLAINS[ev.villain].defeat}`, true);
          break;
        case "ko":
          say("Knocked out. Aunt Mainnet will patch you up.", true);
          break;
        case "errand": {
          const stop = stops[ev.index];
          loop.setHold(false);
          pointers.current.clear();
          setErrand({ index: ev.index, chosen: null });
          if (stop.kind === "errand") say(`${castById(ALLY_CAST[stop.ally]).name} needs a hand.`, true);
          if (autoErrands.current && stop.kind === "errand") {
            const first = ERRANDS.find((x) => x.id === stop.errand)?.choices[0]?.id;
            if (first) window.setTimeout(() => choose(first), 500);
          }
          break;
        }
        case "countdown":
          say(String(ev.value), true);
          break;
        case "go":
          say("Go! Hold to swing.", true);
          break;
      }
    };
    loop.bus.on(onEvent);
    loop.bus.on(simAudio(stops));

    buildSprites(colors, ids).then((sprites) => {
      if (cancelled || !canvasRef.current) return;
      renderer = new GameRenderer(canvasRef.current, sprites, { reducedMotion: reducedNow });
      setPositions(loop.stopProgress());
      setReady(true);
      if (!reducedNow) loop.start();
      let last = performance.now();
      const frame = (now: number) => {
        raf = requestAnimationFrame(frame);
        loop.advance(now);
        renderer!.draw(loop.state, loop.frame, Math.min(0.1, Math.max(0, (now - last) / 1000)));
        last = now;
      };
      raf = requestAnimationFrame(frame);
    });

    // ?debug=1: hooks for screenshots and bots.
    const debug = new URLSearchParams(window.location.search).get("debug") === "1";
    if (debug) {
      const mem = newBotMemory();
      window.__wgpSim = {
        loop,
        get state(): SimState {
          return loop.state;
        },
        /**
         * teleport(): drop in just short of the current stop. teleport(n) for a later stop
         * completes the stops before it in the engine (fights won, first errand choice),
         * then reloads, which resumes swinging toward stop n; call teleport() again once live.
         */
        teleport: (n?: number) => {
          if (n === undefined || n === loop.state.index) {
            const ok = debugTeleport(loop.state);
            loop.markDirty();
            return ok;
          }
          for (let guard = 0; guard < 12; guard++) {
            const p = s.patrol;
            if (!p || p.phase === "summary" || p.index >= n) break;
            const stop = p.stops[p.index];
            if (p.phase === "swing") send({ type: "sim-arrive", hp: loop.state.hp, fluid: loop.state.fluid, perfect: 0, good: 0, miss: 0, combo: loop.state.combo });
            else if (p.results.length <= p.index) {
              if (stop.kind === "fight") send({ type: "sim-fight", won: true, hp: s.patrol!.hp, fluid: s.patrol!.fluid });
              else send({ type: "errand", choice: ERRANDS.find((x) => x.id === stop.errand)?.choices[0].id ?? "" });
            } else send({ type: "leave-stop" });
          }
          window.location.reload();
          return true;
        },
        setHp: (hp: number) => {
          debugSetHp(loop.state, hp);
          loop.markDirty();
        },
        win: () => debugWin(loop.state),
        hold: (h: boolean) => loop.setHold(h),
        ability: (slot: number) => loop.ability(slot),
        gwei: () => loop.gwei(),
        pause: (p: boolean) => loop.setPaused(p),
        autopilot: (on: boolean) => {
          loop.autopilot = on ? (st: SimState) => botInput(st, mem, DT) : null;
          autoErrands.current = on;
        },
        peek: () => {
          const st = loop.state;
          return { status: loop.status, mode: st.mode, index: st.index, x: Math.round(st.hero.x), y: Math.round(st.hero.y), hp: st.hp, rope: !!st.hero.rope, vy: Math.round(st.hero.vy) };
        },
      };
    }

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      loop.dispose();
      renderer?.dispose();
      stopMusic();
      session.current = null;
      if (debug) delete window.__wgpSim;
    };
  }, [boot, dispatch, hudStore, colors, say, choose]);

  const togglePause = useCallback((next?: boolean) => {
    const loop = session.current?.loop;
    if (!loop) return;
    setPaused((p) => {
      const value = next ?? !p;
      loop.setPaused(value);
      return value;
    });
    pointers.current.clear();
  }, []);

  // Keyboard: Space holds the web, A/D steer, 1–4 powers, G Gwei, Esc pauses.
  useEffect(() => {
    const steer = () => session.current?.loop.setSteer((keys.current.right ? 1 : 0) - (keys.current.left ? 1 : 0));
    const down = (e: KeyboardEvent) => {
      const loop = session.current?.loop;
      if (!loop) return;
      if (e.key === "Escape" || ((e.key === "p" || e.key === "P") && !errand)) {
        if (needsChoice) return;
        e.preventDefault();
        togglePause();
        return;
      }
      if (blocked) return;
      const k = e.key.toLowerCase();
      if (e.code === "Space" || k === "arrowup" || k === "w") {
        e.preventDefault();
        if (!e.repeat) loop.setHold(true);
      } else if (k === "a" || k === "arrowleft") {
        e.preventDefault();
        keys.current.left = true;
        steer();
      } else if (k === "d" || k === "arrowright") {
        e.preventDefault();
        keys.current.right = true;
        steer();
      } else if (k >= "1" && k <= "4" && k.length === 1) {
        e.preventDefault();
        loop.ability(Number(k) - 1);
      } else if (k === "g") {
        e.preventDefault();
        loop.gwei();
      }
    };
    const up = (e: KeyboardEvent) => {
      const loop = session.current?.loop;
      if (!loop) return;
      const k = e.key.toLowerCase();
      if (e.code === "Space" || k === "arrowup" || k === "w") {
        if (pointers.current.size === 0) loop.setHold(false);
      } else if (k === "a" || k === "arrowleft") {
        keys.current.left = false;
        steer();
      } else if (k === "d" || k === "arrowright") {
        keys.current.right = false;
        steer();
      }
    };
    const blur = () => {
      keys.current = { left: false, right: false };
      session.current?.loop.setHold(false);
      session.current?.loop.setSteer(0);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [blocked, errand, needsChoice, togglePause]);

  // A hidden tab pauses the game.
  useEffect(() => {
    const onVis = () => {
      if (document.hidden && session.current?.loop.status === "live") togglePause(true);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [togglePause]);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const loop = session.current?.loop;
    if (!loop || blocked) return;
    // On touch, the left two-thirds is the swing area; the right third is for powers.
    if (e.pointerType === "touch" && e.clientX > window.innerWidth * (2 / 3)) return;
    if (e.button > 0) return;
    pointers.current.add(e.pointerId);
    e.currentTarget.setPointerCapture(e.pointerId);
    loop.setHold(true);
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) session.current?.loop.setHold(false);
  };

  const p = save.patrol!;
  const stops = p.stops;
  const errandStop = errand ? stops[errand.index] : null;
  const introStop = hud && hud.mode === "intro" && hud.status !== "loading" ? stops[hud.index] : null;

  // A modal sheet (pause, the motion choice) makes everything behind it inert.
  const modal = paused || needsChoice;

  return (
    <div className="absolute inset-0">
      <div className="absolute inset-0" inert={modal}>
        <div
          className="absolute inset-0 touch-none select-none [-webkit-touch-callout:none]"
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onContextMenu={(e) => e.preventDefault()}
          role="application"
          aria-label="The city. Hold Space or the mouse to swing; keys 1 to 4 use powers; Escape pauses."
        >
          <canvas ref={canvasRef} className="absolute inset-0 block" />
        </div>
        {!ready ? <Loading /> : null}
        {ready ? (
          <Hud
            store={hudStore}
            stops={stops}
            results={p.results}
            positions={positions}
            hero={colors}
            touch={touch}
            onAbility={(slot) => session.current?.loop.ability(slot)}
            onGwei={() => session.current?.loop.gwei()}
            onPause={() => togglePause(true)}
          />
        ) : null}
        {introStop && introStop.kind === "fight" ? <EncounterBanner stop={introStop} index={hud!.index} total={stops.length} /> : null}
        {hud?.mode === "won" && hud.villain ? <WonCaption villain={hud.villain.kind} /> : null}
      </div>
      {errandStop && errandStop.kind === "errand" && !paused ? (
        <ErrandSheet
          stop={errandStop}
          chosen={errand!.chosen}
          onChoose={choose}
          onLeave={leave}
        />
      ) : null}
      {paused ? <PauseMenu loadout={save.hero.loadout.filter((id) => save.hero.powers[id])} onResume={() => togglePause(false)} /> : null}
      {needsChoice ? (
        <MotionChoice
          onPlay={() => {
            const loop = session.current?.loop;
            setAssist(true);
            if (loop) {
              loop.setTimeScale(0.7);
              loop.start();
            }
          }}
        />
      ) : null}
      <p role="status" aria-live="polite" className="sr-only">
        {announce}
      </p>
    </div>
  );
}
