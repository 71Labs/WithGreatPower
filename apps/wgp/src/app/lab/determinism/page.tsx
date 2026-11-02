"use client";

/**
 * /lab/determinism: replays the golden input logs from @wgp/game-core in this browser and
 * compares every hash with the one Node recorded. Playwright opens it in Chromium, WebKit
 * and Firefox and reads `data-status` on <main> ("running", "pass" or "fail") or
 * `window.__wgpDeterminism`.
 */
import { useCallback, useEffect, useState } from "react";

import { GOLDEN_CASES, GOLDEN_EXPECT, GOLDEN_RULESET, replayGolden } from "@wgp/game-core/golden";
import { RULESET_VERSION } from "@wgp/game-core/score";

interface Row {
  name: string;
  note: string;
  expected: string;
  got: string;
  checkpointsMatch: boolean;
  score: number;
  expectedScore: number;
  ticks: number;
  ms: number;
  pass: boolean;
}

type Status = "running" | "pass" | "fail";

declare global {
  interface Window {
    __wgpDeterminism?: { status: Status; rows: Row[]; ruleset: number };
  }
}

function replayAll(): Row[] {
  return GOLDEN_CASES.map((c) => {
    const want = GOLDEN_EXPECT[c.name];
    const t0 = performance.now();
    const res = replayGolden(c);
    const ms = performance.now() - t0;
    const checkpointsMatch = !!want && res.checkpoints.length === want.checkpoints.length && res.checkpoints.every((h, i) => h === want.checkpoints[i]);
    const pass = !!want && res.hash === want.hash && checkpointsMatch && res.score === want.score && res.ticks === want.ticks && res.ok === want.ok;
    return {
      name: c.name,
      note: c.note,
      expected: want?.hash ?? "missing",
      got: res.hash,
      checkpointsMatch,
      score: res.score,
      expectedScore: want?.score ?? 0,
      ticks: res.ticks,
      ms,
      pass,
    };
  });
}

export default function DeterminismLab() {
  const [rows, setRows] = useState<Row[]>([]);
  const [status, setStatus] = useState<Status>("running");

  const run = useCallback(() => {
    setStatus("running");
    // Let the "running" state paint before the replays take the main thread.
    window.setTimeout(() => {
      const next = replayAll();
      const verdict: Status = next.length > 0 && next.every((r) => r.pass) && GOLDEN_RULESET === RULESET_VERSION ? "pass" : "fail";
      setRows(next);
      setStatus(verdict);
      window.__wgpDeterminism = { status: verdict, rows: next, ruleset: RULESET_VERSION };
    }, 0);
  }, []);

  useEffect(() => {
    const id = window.setTimeout(run, 0);
    return () => window.clearTimeout(id);
  }, [run]);

  const failed = rows.filter((r) => !r.pass).length;
  const verdict =
    status === "running" ? "Replaying the golden logs…" : status === "pass" ? `All ${rows.length} replays match Node` : `${failed} of ${rows.length} replays differ from Node`;

  return (
    <main id="main" data-status={status} className="min-h-dvh bg-page px-4 py-10 text-ink sm:px-8">
      <div className="mx-auto flex max-w-5xl flex-col gap-8">
        <header className="flex flex-col gap-3">
          <p className="font-mono text-xs text-ink-subtle">Lab · ruleset {RULESET_VERSION}</p>
          <h1 className="font-display text-3xl font-medium tracking-tight text-balance sm:text-4xl">
            <span className="text-ink-faint">Same inputs, </span>
            <span className="text-ink-strong">same night everywhere</span>
          </h1>
          <p className="max-w-[65ch] text-pretty text-ink-subtle">
            Each golden log is a full recorded night. This page replays them in your browser and checks every state hash against the
            one Node recorded, so the server can trust a run the browser played.
          </p>
        </header>

        <section aria-labelledby="verdict" className="flex flex-wrap items-center justify-between gap-4 rounded-card border border-hairline bg-canvas p-4">
          <p
            id="verdict"
            role="status"
            className={`inline-flex items-center gap-2 rounded-chip px-3 py-1.5 text-sm font-medium ${
              status === "pass" ? "bg-success-fill text-on-success" : status === "fail" ? "bg-danger-fill text-on-danger" : "bg-surface text-ink-subtle"
            }`}
          >
            <span aria-hidden="true">{status === "pass" ? "✓" : status === "fail" ? "✕" : "…"}</span>
            {verdict}
          </p>
          <button
            type="button"
            onClick={run}
            disabled={status === "running"}
            className="inline-flex h-11 items-center rounded-control bg-inverse px-4 text-sm font-medium text-on-inverse hover:bg-inverse-hover active:scale-[0.97] disabled:opacity-60 motion-safe:transition-[scale,background-color] motion-safe:duration-200 motion-safe:ease-out"
          >
            Run the replays again
          </button>
        </section>

        <div className="overflow-x-auto rounded-card border border-hairline bg-canvas">
          <table className="w-full min-w-[720px] text-left text-sm">
            <caption className="sr-only">Golden replays: expected and computed state hashes</caption>
            <thead className="border-b border-hairline text-xs text-ink-subtle">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Case</th>
                <th scope="col" className="px-4 py-3 font-medium">Expected hash</th>
                <th scope="col" className="px-4 py-3 font-medium">This browser</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Score</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Ticks</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Replay</th>
                <th scope="col" className="px-4 py-3 font-medium">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-ink-subtle">
                    Replaying {GOLDEN_CASES.length} logs…
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.name} data-case={r.name} data-pass={r.pass}>
                    <td className="px-4 py-3">
                      <span className="block font-medium text-ink-strong">{r.name}</span>
                      <span className="block text-xs text-pretty text-ink-subtle">{r.note}</span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs break-all">{r.expected}</td>
                    <td className="px-4 py-3 font-mono text-xs break-all" data-hash={r.got}>
                      {r.got}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {r.score.toLocaleString("en-US")}
                      {r.score !== r.expectedScore && <span className="block text-xs text-on-danger">expected {r.expectedScore.toLocaleString("en-US")}</span>}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{r.ticks.toLocaleString("en-US")}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{r.ms.toFixed(1)} ms</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`inline-flex items-center gap-1.5 rounded-chip px-2 py-1 text-xs font-medium ${r.pass ? "bg-success-fill text-on-success" : "bg-danger-fill text-on-danger"}`}>
                        <span aria-hidden="true">{r.pass ? "✓" : "✕"}</span>
                        {r.pass ? "Match" : r.checkpointsMatch ? "Differs" : "Desync"}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
