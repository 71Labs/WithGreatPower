"use client";

import { CaseClosed, type CaseFiling } from "@/components/cases/case-closed";
import { KitStyles } from "@/components/game/kit";
import { useFixtureParam } from "@/lib/cases/data";
import { FIXTURE_TICKS, FIXTURE_TX } from "@/lib/cases/fixtures";
import { badgeView } from "@/lib/cases/view";
import { CityBackdrop } from "@/sim/render/backdrop";

const VIEWS = {
  queued: { filing: { kind: "filed", badge: badgeView({ signedIn: true, status: "closed", badge: { status: "queued", tx: null } }) } },
  minted: { filing: { kind: "filed", badge: badgeView({ signedIn: true, status: "closed", badge: { status: "minted", tx: FIXTURE_TX } }) } },
  guest: { filing: { kind: "guest" } },
  filing: { filing: { kind: "filing" } },
  failed: { filing: { kind: "failed", message: "You look offline." } },
  rejected: { filing: { kind: "not-filed", reason: "The server’s replay of your night ended somewhere different, so this clear wasn’t filed. You can play the case again." } },
  open: { filing: { kind: "guest" }, closed: false },
} satisfies Record<string, { filing: CaseFiling; closed?: boolean }>;

type View = keyof typeof VIEWS;
const isView = (v: string | null): v is View => !!v && Object.hasOwn(VIEWS, v);

export function CaseLab() {
  const view: { filing: CaseFiling; closed?: boolean } = VIEWS[useFixtureParam("view", isView) ?? "queued"];
  return (
    <div data-wgp-night="" className="fixed inset-0 z-[60] overflow-hidden bg-game-night text-game-ink">
      <KitStyles />
      <CityBackdrop className="absolute inset-0" />
      <CaseClosed heroName="Night Owl" closed={view.closed ?? true} ticks={FIXTURE_TICKS} filing={view.filing} edition={0} onRetry={() => {}} record={false} />
    </div>
  );
}
