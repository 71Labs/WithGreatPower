import { describe, expect, it } from "vitest";

import { capturePointer } from "./pointer";

describe("capturePointer", () => {
  it("captures an active pointer", () => {
    const seen: number[] = [];
    const target = { setPointerCapture: (id: number) => void seen.push(id) } as unknown as Element;
    expect(capturePointer(target, 7)).toBe(true);
    expect(seen).toEqual([7]);
  });

  it("swallows the error a synthetic or already-released pointer raises", () => {
    const target = {
      setPointerCapture: () => {
        throw new DOMException("No active pointer with the given id is found.", "InvalidStateError");
      },
    } as unknown as Element;
    expect(capturePointer(target, 1)).toBe(false);
  });
});
