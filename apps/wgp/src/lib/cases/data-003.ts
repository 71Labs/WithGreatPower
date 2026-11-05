"use client";

/**
 * Case file 003's folder data: the server's record (`GET /api/cases`, signed in), the save's
 * `cases["case-003"]` and this browser's marks, merged as case 001's are (data.ts). In
 * development `?cases=<name>` swaps in the same typed fixtures, re-dressed as case 003.
 */
import { useEffect, useMemo, useState } from "react";

import { getCases } from "@/lib/api/client";
import { useAccount, useGame } from "@/game/store";

import { CASE_003_ID } from "./content-003";
import { useFixtureParam } from "./data";
import { CASES_FIXTURES, isCasesFixture, type CasesFixture } from "./fixtures";
import { useCaseMarks } from "./local";
import type { CaseRecordApi, CasesResponse } from "./types";
import { badgeView, bestTicks, caseStatus, type BadgeView, type CaseStatus } from "./view";

export interface Case003File {
  id: typeof CASE_003_ID;
  status: CaseStatus;
  /** Best clear, in ticks. */
  best: number | null;
  badge: BadgeView;
  /** The server's list, or this browser's view of it, is still on its way (signed in). */
  checking: boolean;
}

/** A fixture's answer with its case 001 record re-dressed as case 003 (a dev-only view). */
export function asCase003Fixture(fx: CasesFixture): CasesFixture {
  const dress = (c: CaseRecordApi): CaseRecordApi => ({
    ...c,
    id: CASE_003_ID,
    number: "003",
    title: "Fee Strike",
    badge: { ...c.badge, tokenId: "trophy:badge:case-003" },
  });
  const result: CasesFixture["result"] = typeof fx.result === "object" ? { ...fx.result, cases: fx.result.cases.map(dress) } : fx.result;
  const local = fx.local?.["case-001"] ? { [CASE_003_ID]: fx.local["case-001"] } : undefined;
  return { signedIn: fx.signedIn, result, local };
}

/** The server's record for case 003 from a `GET /api/cases` answer, if it's there. */
export const case003Record = (res: CasesResponse | null | undefined): CaseRecordApi | null => res?.cases.find((c) => c.id === CASE_003_ID) ?? null;

type Answer = CasesResponse | "error" | "loading";

export function useCase003(): Case003File & { failed: boolean; signedIn: boolean } {
  const account = useAccount();
  const { save } = useGame();
  const marks = useCaseMarks();
  const fixture = useFixtureParam("cases", isCasesFixture);
  const fx = useMemo(() => (fixture ? asCase003Fixture(CASES_FIXTURES[fixture]) : null), [fixture]);
  const signedIn = fx ? fx.signedIn : account.status === "signed-in";
  const playerId = account.status === "signed-in" ? account.me.player.id : null;
  const key = `${fixture ?? playerId ?? "guest"}`;
  const [answer, setAnswer] = useState<{ key: string; value: Answer } | null>(null);

  useEffect(() => {
    if (fx) {
      let live = true;
      void Promise.resolve().then(() => live && setAnswer({ key, value: fx.result }));
      return () => {
        live = false;
      };
    }
    if (!playerId) return;
    const ctrl = new AbortController();
    getCases(ctrl.signal).then(
      (res) => setAnswer({ key, value: res.ok && Array.isArray(res.data?.cases) ? res.data : "error" }),
      () => {
        // Aborted: a newer request (or none) takes over.
      },
    );
    return () => ctrl.abort();
  }, [fx, playerId, key]);

  const value: Answer = !signedIn ? { signedIn: false, cases: [] } : answer?.key === key ? answer.value : "loading";
  const loading = (!fx && account.status === "loading") || value === "loading";
  const failed = value === "error";
  const api = typeof value === "object" ? case003Record(value) : null;
  const saved = save?.cases?.[CASE_003_ID] ?? null;
  const local = (fx ? fx.local : marks.cases)?.[CASE_003_ID] ?? null;
  const sources = { api, saved, local };
  const status = caseStatus(sources);
  return {
    id: CASE_003_ID,
    status,
    best: bestTicks(sources),
    badge: badgeView({ signedIn, status, badge: api?.badge ?? null, failed }),
    checking: loading && signedIn,
    failed,
    signedIn,
  };
}
