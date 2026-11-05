/**
 * The night in progress, kept in IndexedDB so a reload picks it up where it was: the
 * run's start save, its seed and the input log so far (game-core's resumeRun replays it
 * back into a live run). One record, keyed by RULESET_VERSION, so a log from another
 * ruleset is never offered; a story chapter's (Case File 001) has its own record, keyed by
 * the chapter and its CHAPTER_RULESET, so a case in progress and tonight's patrol never
 * overwrite each other. Written every few seconds and when the page hides; cleared
 * once the night is submitted or banked. Every call swallows storage errors (private
 * mode, blocked storage): the game plays on, it just can't resume after a reload.
 */
import { CHAPTERS } from "@wgp/game-core/chapters";
import { logRuleset, runLog, type Run } from "@wgp/game-core/replay";
import { RULESET_VERSION } from "@wgp/game-core/sim3d/constants";
import type { ChapterId, Save } from "@wgp/game-core/types";

/** Ranked (server seed), a guest's night, or a signed-in night played off the board. */
export type RecordingMode = "ranked" | "guest" | "unranked";

export interface Recording {
  /** The log's ruleset field: RULESET_VERSION, or the chapter's (game-core logRuleset). */
  ruleset: number;
  mode: RecordingMode;
  /** A story chapter's night (resume it with { chapter }), or null/absent for a patrol night. */
  chapter?: ChapterId | null;
  /** The server's run, for ranked nights. */
  runId: string | null;
  /** Who played it (signed in), so another account on this browser never resumes it. */
  playerId: string | null;
  seed: number;
  /** The save the run started from (patrol started), what resumeRun replays from. */
  start: Save;
  log: Uint8Array;
  ticks: number;
  savedAt: number;
}

const DB_NAME = "wgp-play";
const STORE = "runs";
/** The record's key: tonight's patrol, or a chapter's (by its rules version). */
const keyFor = (chapter: ChapterId | null | undefined) => (chapter ? `case:${chapter}:${CHAPTERS[chapter].ruleset}` : `run:v${RULESET_VERSION}`);
/** How often the log is written while playing. */
export const RECORD_EVERY_MS = 3000;

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  dbPromise ??= new Promise<IDBDatabase | null>((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function request<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return openDb().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) return resolve(null);
        try {
          const req = run(db.transaction(STORE, mode).objectStore(STORE));
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      }),
  );
}

const isRecording = (v: unknown, chapter: ChapterId | null): v is Recording => {
  const r = v as Recording | null;
  return (
    !!r &&
    (r.chapter ?? null) === chapter &&
    r.ruleset === logRuleset(chapter) &&
    r.log instanceof Uint8Array &&
    typeof r.seed === "number" &&
    !!r.start &&
    typeof r.mode === "string"
  );
};

/** Tonight's patrol recording, or (with `chapter`) that chapter's. */
export async function loadRecording(chapter: ChapterId | null = null): Promise<Recording | null> {
  const value = await request<unknown>("readonly", (s) => s.get(keyFor(chapter)));
  return isRecording(value, chapter) ? value : null;
}

export async function saveRecording(rec: Recording): Promise<void> {
  await request("readwrite", (s) => s.put(rec, keyFor(rec.chapter)));
}

export async function clearRecording(chapter: ChapterId | null = null): Promise<void> {
  await request("readwrite", (s) => s.delete(keyFor(chapter)));
}

/** Keeps one run's recording fresh while it plays. */
export class RunRecorder {
  private lastTick = -1;
  private lastEvents = -1;
  private stopped = false;

  constructor(
    private readonly run: Run,
    private readonly meta: { mode: RecordingMode; runId: string | null; playerId: string | null },
  ) {}

  /** Write the log if anything was played since the last write. */
  flush(): Promise<void> {
    const run = this.run;
    if (this.stopped || run.error || !run.sim) return Promise.resolve();
    if (run.sim.tick === this.lastTick && run.events.length === this.lastEvents) return Promise.resolve();
    this.lastTick = run.sim.tick;
    this.lastEvents = run.events.length;
    return saveRecording({
      ruleset: logRuleset(run.chapter),
      chapter: run.chapter,
      ...this.meta,
      seed: run.seed,
      start: run.start,
      log: runLog(run),
      ticks: run.sim.tick,
      savedAt: Date.now(),
    });
  }

  /** Write every few seconds and whenever the page hides; returns the stop function. */
  start(): () => void {
    const timer = window.setInterval(() => void this.flush(), RECORD_EVERY_MS);
    const onHide = () => {
      if (document.visibilityState === "hidden") void this.flush();
    };
    const onPageHide = () => void this.flush();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onPageHide);
    };
  }

  /** The night is over: stop writing (the caller clears the record once it's banked). */
  stop(): void {
    this.stopped = true;
  }
}
