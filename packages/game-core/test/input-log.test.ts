import { describe, expect, it } from "vitest";

import {
  decodeInputLog,
  encodeInputCodes,
  encodeInputLog,
  frameCode,
  frameFromCode,
  fromBase64,
  InputLogError,
  LOG_VERSION,
  MAX_LOG_BYTES,
  MAX_TICKS,
  toBase64,
} from "../src/input/log";
import { RULESET_VERSION } from "../src/score";
import type { InputEvent, InputFrame } from "../src/sim3d/contract";

const f = (dir: number, mag: number, web: boolean, shot: InputFrame["shot"] = 0): InputFrame => ({ dir, mag, web, shot });

/** A night-like stream: long holds, stick sweeps, one-shots. */
function sampleFrames(n: number): InputFrame[] {
  const out: InputFrame[] = [];
  for (let i = 0; i < n; i++) {
    const phase = Math.floor(i / 37) % 5;
    const mag = phase === 0 ? 0 : (phase % 3) + 1;
    out.push(f(mag ? (Math.floor(i / 11) * 7) % 64 : 0, mag, Math.floor(i / 23) % 3 !== 0, (i % 97 === 5 ? (((i / 97) | 0) % 5) + 1 : 0) as InputFrame["shot"]));
  }
  return out;
}

function expectCode(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(InputLogError);
    expect((e as InputLogError).code).toBe(code);
    return;
  }
  throw new Error(`expected InputLogError ${code}`);
}

describe("the input log", () => {
  it("round-trips frames and errand events, canonically", () => {
    const frames = sampleFrames(5000);
    const events: InputEvent[] = [
      { tick: 0, kind: "errand-choice", value: 1 },
      { tick: 1200, kind: "errand-choice", value: 0 },
      { tick: 1201, kind: "errand-choice", value: 2 },
      { tick: 5000, kind: "errand-choice", value: 0 },
    ];
    const bytes = encodeInputLog({ frames, events });
    const back = decodeInputLog(bytes);
    expect(back.ruleset).toBe(RULESET_VERSION);
    expect(back.fromTick).toBe(0);
    expect(back.frames).toEqual(frames);
    expect(back.events).toEqual(events);
    expect(encodeInputLog(back)).toEqual(bytes);
    expect(bytes[0]).toBe(LOG_VERSION);
  });

  it("run-length encodes a held input to a few bytes", () => {
    const frames = Array.from({ length: MAX_TICKS }, () => f(0, 0, true));
    const bytes = encodeInputLog({ frames });
    expect(bytes.length).toBeLessThan(16);
    expect(decodeInputLog(bytes).frames).toHaveLength(MAX_TICKS);
  });

  it("keeps fromTick and the frame code helpers consistent", () => {
    for (let dir = 0; dir < 64; dir++) {
      for (const shot of [0, 1, 5] as const) {
        const fr = f(dir, 3, dir % 2 === 0, shot);
        expect(frameFromCode(frameCode(fr))).toEqual(fr);
      }
    }
    const bytes = encodeInputCodes([frameCode(f(4, 2, true))], [], 300);
    expect(decodeInputLog(bytes).fromTick).toBe(300);
  });

  it("refuses frames it can't represent", () => {
    expectCode(() => encodeInputLog({ frames: [f(5, 0, false)] }), "range");
    expectCode(() => encodeInputLog({ frames: [f(64, 1, false)] }), "range");
    expectCode(() => encodeInputLog({ frames: [{ dir: 0, mag: 0, web: false, shot: 6 as 0 }] }), "range");
    expectCode(() => encodeInputLog({ frames: [f(0, 0, false)], events: [{ tick: 5, kind: "errand-choice", value: 0 }] }), "range");
    expectCode(
      () =>
        encodeInputLog({
          frames: sampleFrames(10),
          events: [
            { tick: 4, kind: "errand-choice", value: 0 },
            { tick: 4, kind: "errand-choice", value: 1 },
          ],
        }),
      "range",
    );
    expectCode(() => encodeInputLog({ frames: [], fromTick: MAX_TICKS + 1 }), "range");
  });

  it("rejects every truncation and any trailing byte", () => {
    const bytes = encodeInputLog({ frames: sampleFrames(400), events: [{ tick: 200, kind: "errand-choice", value: 1 }] });
    for (let n = 0; n < bytes.length; n++) {
      expect(() => decodeInputLog(bytes.slice(0, n))).toThrow(InputLogError);
    }
    const longer = new Uint8Array(bytes.length + 1);
    longer.set(bytes);
    expectCode(() => decodeInputLog(longer), "trailing");
  });

  it("rejects non-canonical and out-of-range bytes", () => {
    const head = [LOG_VERSION, RULESET_VERSION, 0];
    // Bad version.
    expectCode(() => decodeInputLog(Uint8Array.from([9, RULESET_VERSION, 0, 0, 0])), "version");
    // A direction with no tilt.
    expectCode(() => decodeInputLog(Uint8Array.from([...head, 1, 4 << 2, 0, 0])), "noncanonical");
    // Unused button bits, and a one-shot of 6.
    expectCode(() => decodeInputLog(Uint8Array.from([...head, 1, 0, 0x10, 0])), "range");
    expectCode(() => decodeInputLog(Uint8Array.from([...head, 1, 0, 6 << 1, 0])), "range");
    // Two runs of the same frame back to back.
    expectCode(() => decodeInputLog(Uint8Array.from([...head, 2, 0, 1, 0, 1, 0])), "noncanonical");
    // A run longer than the frame count.
    expectCode(() => decodeInputLog(Uint8Array.from([...head, 2, 0, 1 | 0x80, 5, 0])), "range");
    // A varint with a redundant zero byte, and one that's too long.
    expectCode(() => decodeInputLog(Uint8Array.from([LOG_VERSION, RULESET_VERSION, 0x80, 0x00, 0, 0])), "noncanonical");
    expectCode(() => decodeInputLog(Uint8Array.from([LOG_VERSION, RULESET_VERSION, 0x80, 0x80, 0x80, 0x80, 0x01, 0, 0])), "range");
    // More ticks than a run may hold.
    const over = encodeInputCodes([], [], 0);
    expect(decodeInputLog(over).frames).toHaveLength(0);
    expectCode(() => decodeInputLog(Uint8Array.from([LOG_VERSION, RULESET_VERSION, 0, 0xf1, 0xa5, 0x03, 0, 1, 0])), "too-long");
    // Events: unknown kind, value too big, past the last frame.
    expectCode(() => decodeInputLog(Uint8Array.from([...head, 1, 0, 0, 1, 0, 3, 0])), "range");
    expectCode(() => decodeInputLog(Uint8Array.from([...head, 1, 0, 0, 1, 0, 0, 16])), "range");
    expectCode(() => decodeInputLog(Uint8Array.from([...head, 1, 0, 0, 1, 2, 0, 0])), "range");
    // Too many bytes overall.
    expectCode(() => decodeInputLog(new Uint8Array(MAX_LOG_BYTES + 1)), "too-long");
  });

  it("has its own strict base64", () => {
    const bytes = encodeInputLog({ frames: sampleFrames(777) });
    for (const sample of [bytes, bytes.slice(0, 1), bytes.slice(0, 2), bytes.slice(0, 3), new Uint8Array(0)]) {
      expect(fromBase64(toBase64(sample))).toEqual(sample);
    }
    expect(toBase64(Uint8Array.from([0xfb, 0xff]))).toBe("+/8=");
    expectCode(() => fromBase64("abc"), "base64");
    expectCode(() => fromBase64("ab=c"), "base64");
    expectCode(() => fromBase64("ab!c"), "base64");
    expectCode(() => fromBase64("AB=="), "base64"); // nonzero unused bits
  });
});
