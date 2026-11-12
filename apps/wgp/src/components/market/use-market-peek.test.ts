/**
 * Coming back to a screen that printed a wallet (the Suit lab's Bits): the wallet is read
 * again when the tab is shown, the window is focused or the page is restored, at most once
 * per gap, and never while the page is hidden.
 */
import { describe, expect, it } from "vitest";

import { REVISIT_GAP_MS, watchRevisits, type RevisitSource } from "./use-market-peek";

function source() {
  const win = new EventTarget();
  const doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
  let t = 1_000_000;
  const src: RevisitSource = { win, doc, now: () => t };
  return {
    src,
    win,
    doc,
    advance(ms: number) {
      t += ms;
    },
    show() {
      doc.visibilityState = "visible";
      doc.dispatchEvent(new Event("visibilitychange"));
    },
    hide() {
      doc.visibilityState = "hidden";
      doc.dispatchEvent(new Event("visibilitychange"));
    },
    pageshow(persisted: boolean) {
      win.dispatchEvent(Object.assign(new Event("pageshow"), { persisted }));
    },
  };
}

describe("re-reading the wallet on a revisit", () => {
  it("fires when the tab is shown again, not when it is hidden", () => {
    const s = source();
    let reads = 0;
    watchRevisits(() => reads++, s.src);
    s.hide();
    expect(reads).toBe(0);
    s.show();
    expect(reads).toBe(1);
  });

  it("fires on window focus and on a page restored from the back-forward cache, but not on a first load", () => {
    const s = source();
    let reads = 0;
    watchRevisits(() => reads++, s.src);
    s.pageshow(false);
    expect(reads).toBe(0);
    s.win.dispatchEvent(new Event("focus"));
    expect(reads).toBe(1);
    s.advance(REVISIT_GAP_MS);
    s.pageshow(true);
    expect(reads).toBe(2);
  });

  it("reads once when focus and visibility arrive together, and again after the gap", () => {
    const s = source();
    let reads = 0;
    watchRevisits(() => reads++, s.src);
    s.show();
    s.win.dispatchEvent(new Event("focus"));
    s.advance(REVISIT_GAP_MS - 1);
    s.win.dispatchEvent(new Event("focus"));
    expect(reads).toBe(1);
    s.advance(1);
    s.win.dispatchEvent(new Event("focus"));
    expect(reads).toBe(2);
  });

  it("ignores focus while the page is hidden, and stops when told to", () => {
    const s = source();
    let reads = 0;
    const stop = watchRevisits(() => reads++, s.src);
    s.hide();
    s.win.dispatchEvent(new Event("focus"));
    expect(reads).toBe(0);
    stop();
    s.show();
    s.win.dispatchEvent(new Event("focus"));
    s.pageshow(true);
    expect(reads).toBe(0);
  });
});
