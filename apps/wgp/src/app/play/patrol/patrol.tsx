"use client";

/**
 * The patrol: the 3D city where the browser can draw WebGL 2, the 2D game where it can't.
 * The check runs on the client only, so the server render is the loading state.
 */
import { useSyncExternalStore } from "react";

import { hasWebGL2 } from "@/game3d/scene/quality";

import { Night3D } from "./night";
import { Loading, PatrolGame } from "./status";

let webgl: boolean | null = null;
const noop = () => () => {};
/** Asked once per page load (it makes and drops a throwaway context). */
const canDraw3d = () => (webgl ??= hasWebGL2());

export function Patrol() {
  const ok = useSyncExternalStore(noop, canDraw3d, () => null);
  if (ok === null)
    return (
      <div className="fixed inset-0 z-[60] overflow-hidden bg-game-night text-game-ink">
        <Loading />
      </div>
    );
  return ok ? <Night3D /> : <PatrolGame />;
}
