"use client";

/**
 * Free roam's page: which city to walk into. A guest plays from the browser's save (what the
 * city found is filed there); signed in, from the server's save (the server files each outing
 * from a replay of its log). Without WebGL 2 there's no city to roam, so it says so. Opened
 * with no hero (a deep link), a guest gets the quick start's ready hero in place and a
 * signed-in player goes to choose theirs, as on every game page (useNoHeroStep).
 */
import { useState, useSyncExternalStore } from "react";

import { cityRecord } from "@wgp/game-core/city";
import { SUITS } from "@wgp/game-core/data";
import type { Save } from "@wgp/game-core/types";

import { useNoHeroStep } from "@/components/game/ui";
import { useAccount } from "@/game/store";
import { beginRoam, type RoamSession } from "@/game3d/session/roam";
import { prefetchHero } from "@/game3d/scene/characters/files";
import { hasWebGL2 } from "@/game3d/scene/quality";

import { initialSettings } from "../patrol/settings";
import { Loading, Notice } from "../patrol/status";
import { CitySurface } from "./surface";

let webgl: boolean | null = null;
const noop = () => () => {};
const canDraw3d = () => (webgl ??= hasWebGL2());

// The 3D code first, then the hero's body and clips, while the page boots.
if (typeof window !== "undefined" && canDraw3d()) {
  import("./stage").then(
    () => prefetchHero(initialSettings().tier),
    () => {},
  );
}

const flag = (name: string) => typeof window !== "undefined" && new URLSearchParams(window.location.search).get(name) === "1";

export function City() {
  const ok = useSyncExternalStore(noop, canDraw3d, () => null);
  const account = useAccount();
  const save = useNoHeroStep();
  const [flags] = useState(() => ({ autopilot: flag("autopilot"), debug: flag("debug") }));
  const ready = account.status !== "loading" && !!save;
  const player = account.status === "signed-in" ? account.me.player.id : null;

  let body;
  if (ok === null || !ready) body = <Loading label="Heading into the city…" />;
  else if (!ok) body = <Notice title="The city needs 3D" body="This browser can’t draw the 3D city, so there’s nowhere to roam. Nights still play in the classic 2D game." href="/play" action="Back to tonight" />;
  // No hero yet: useNoHeroStep is making a guest the ready one, or sending a signed-in player to choose theirs.
  else if (!save?.hero) body = <Loading label="Heading into the city…" />;
  else body = <Outing key={player ?? "guest"} save={save} player={player} autopilot={flags.autopilot && process.env.NODE_ENV !== "production"} debug={flags.debug} />;
  return <div className="fixed inset-0 z-[60] overflow-hidden bg-game-night text-game-ink">{body}</div>;
}

/** One outing per visit (and per account): it starts from where the save's city record left off. */
function Outing({ save, player, autopilot, debug }: { save: Save; player: string | null; autopilot: boolean; debug: boolean }) {
  const [session] = useState<RoamSession>(() => beginRoam(cityRecord(save), player ? "signed-in" : "guest", player));
  return <CitySurface session={session} colors={SUITS[save.hero!.suit].colors} autopilot={autopilot} debug={debug} />;
}
