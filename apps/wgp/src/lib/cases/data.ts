"use client";

/**
 * The case files' data: the server's record (`GET /api/cases`, signed in), the save's
 * `cases` and this browser's marks, merged into what each case card shows.
 *
 * The source switches in one place: the API by default; in development `?cases=<name>`
 * swaps in a typed fixture (fixtures.ts) for the account, the server's answer and the local
 * marks, so every state can be seen before the gameplay build's endpoint lands. Production
 * builds always read the API.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import { getCases } from "@/lib/api/client";
import { useAccount, useGame } from "@/game/store";

import { CASES_FIXTURES, isCasesFixture, type CasesFixtureName } from "./fixtures";
import { useCaseMarks } from "./local";
import { CHAPTER_ID, type CaseRecordApi, type CasesResponse, type SaveWithCases } from "./types";
import { badgeView, bestTicks, caseStatus, type BadgeView, type CaseStatus } from "./view";

/** A fixture asked for in the URL, outside production. Read in the browser. */
export function readFixtureParam<T extends string>(param: string, ok: (v: string | null) => v is T): T | null {
  if (process.env.NODE_ENV === "production" || typeof window === "undefined") return null;
  const v = new URLSearchParams(window.location.search).get(param);
  return ok(v) ? v : null;
}

const noSubscribe = () => () => {};

/** readFixtureParam for a render: none on the server and while hydrating, then the URL's. */
export function useFixtureParam<T extends string>(param: string, ok: (v: string | null) => v is T): T | null {
  return useSyncExternalStore(
    noSubscribe,
    () => readFixtureParam(param, ok),
    () => null,
  );
}

export interface CaseFile {
  id: typeof CHAPTER_ID;
  status: CaseStatus;
  /** Best clear, in ticks. */
  best: number | null;
  badge: BadgeView;
}

export interface CaseFiles {
  signedIn: boolean;
  /** The account, or the server's list, is still on its way. */
  loading: boolean;
  /** The server's list didn't come; the cards show what this browser knows. */
  failed: boolean;
  /** The cases Bearson has open (empty only if he has none). */
  cases: CaseFile[];
  retry(): void;
  fixture: CasesFixtureName | null;
}

type Answer = CasesResponse | "error" | "loading";

export function useCaseFiles(): CaseFiles {
  const account = useAccount();
  const { save } = useGame();
  const marks = useCaseMarks();
  const fixture = useFixtureParam("cases", isCasesFixture);
  const fx = fixture ? CASES_FIXTURES[fixture] : null;
  const signedIn = fx ? fx.signedIn : account.status === "signed-in";
  const playerId = account.status === "signed-in" ? account.me.player.id : null;
  const [answer, setAnswer] = useState<{ key: string; value: Answer } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const key = `${fixture ?? playerId ?? "guest"}:${attempt}`;

  useEffect(() => {
    if (fx) {
      // A fixture answers like the server would: after this render.
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

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const value: Answer = !signedIn ? { cases: [] } : answer?.key === key ? answer.value : "loading";
  const loading = (!fx && account.status === "loading") || value === "loading";
  const failed = value === "error";
  const list = typeof value === "object" ? value.cases : [];

  // An empty fixture is Bearson with nothing open; otherwise case 001 is always on file.
  if (fixture === "empty") return { signedIn, loading: false, failed: false, cases: [], retry, fixture };

  const api: CaseRecordApi | null = list.find((c) => c.id === CHAPTER_ID) ?? null;
  const saved = (save as SaveWithCases | null)?.cases?.[CHAPTER_ID] ?? null;
  const local = (fx ? fx.local : marks.cases)?.[CHAPTER_ID] ?? null;
  const sources = { api, saved, local };
  const status = caseStatus(sources);
  return {
    signedIn,
    loading,
    failed,
    cases: [{ id: CHAPTER_ID, status, best: bestTicks(sources), badge: badgeView({ signedIn, status, badge: api?.badge ?? null, failed }) }],
    retry,
    fixture,
  };
}
