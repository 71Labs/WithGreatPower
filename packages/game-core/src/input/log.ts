/**
 * The input log: everything a run's player did, as compact canonical bytes. The browser
 * records it while you play; the server replays it to verify the score.
 *
 *   u8      LOG_VERSION (1)
 *   varint  ruleset: RULESET_VERSION when recorded
 *   varint  fromTick: frame i applies on the step from tick fromTick + i to fromTick + i + 1
 *   varint  frame count
 *   runs    until the count is covered, each:
 *             u8 stick    dir << 2 | mag (dir 0–63, mag 0–3; dir must be 0 when mag is 0)
 *             u8 buttons  bit 0 web held, bits 1–3 the one-shot (0 none, 1–4 ability, 5 Gwei),
 *                         bits 4–6 zero, bit 7 set when the frame repeats
 *             varint      (run length − 2), only when bit 7 is set
 *   varint  event count
 *   events  each: varint tick delta (from fromTick for the first, else from the previous
 *           event's tick + 1, so ticks strictly increase), u8 kind (0: errand-choice),
 *           varint value (the chosen option's index)
 *
 * Varints are unsigned LEB128, minimal, at most 4 bytes. The encoding is canonical: runs
 * are maximal, so encode(decode(bytes)) gives back the same bytes. The decoder refuses
 * anything else: truncated, trailing, overlong or non-canonical bytes, out-of-range values,
 * more than MAX_TICKS ticks, or more than MAX_LOG_BYTES bytes.
 */
import { MAX_TICKS, RULESET_VERSION } from "../sim3d/constants";
import type { InputEvent, InputFrame } from "../sim3d/contract";

export const LOG_VERSION = 1;
/** The largest log accepted (the architecture budget: 2–15 KB a night, capped at 64 KB). */
export const MAX_LOG_BYTES = 65_536;
/** Events are errand choices: four stops a night, so this is generous. */
export const MAX_LOG_EVENTS = 64;
/** Errand options are indexed 0–15 at most. */
export const MAX_EVENT_VALUE = 15;
export { MAX_TICKS };

const REPEAT = 0x80;
const WEB = 0x01;
const MAX_VARINT_BYTES = 4;
const EVENT_KINDS: readonly InputEvent["kind"][] = ["errand-choice"];

export type InputLogErrorCode = "truncated" | "version" | "range" | "trailing" | "noncanonical" | "too-long" | "base64";

/** A malformed input log. `code` says what was wrong. */
export class InputLogError extends Error {
  readonly code: InputLogErrorCode;
  constructor(code: InputLogErrorCode, message: string) {
    super(message);
    this.name = "InputLogError";
    this.code = code;
  }
}

export interface InputLog {
  ruleset: number;
  fromTick: number;
  frames: InputFrame[];
  events: InputEvent[];
}

const isInt = (v: unknown, lo: number, hi: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;

/** Whether `f` is a well-formed, canonical InputFrame. */
export function isInputFrame(f: unknown): f is InputFrame {
  if (typeof f !== "object" || f === null) return false;
  const x = f as Record<string, unknown>;
  return isInt(x.dir, 0, 63) && isInt(x.mag, 0, 3) && (x.mag !== 0 || x.dir === 0) && typeof x.web === "boolean" && isInt(x.shot, 0, 5);
}

/** A frame as one 16-bit code: the stick byte, and the button byte (without the repeat flag) above it. */
export function frameCode(f: InputFrame): number {
  return ((f.dir << 2) | f.mag) | (((f.web ? WEB : 0) | (f.shot << 1)) << 8);
}

export function frameFromCode(code: number): InputFrame {
  const stick = code & 0xff;
  const buttons = code >> 8;
  return { dir: stick >> 2, mag: stick & 3, web: (buttons & WEB) !== 0, shot: ((buttons >> 1) & 7) as InputFrame["shot"] };
}

export const sameFrame = (a: InputFrame, b: InputFrame) => a.dir === b.dir && a.mag === b.mag && a.web === b.web && a.shot === b.shot;

function writeVarint(out: number[], value: number) {
  let rest = value;
  while (rest >= 0x80) {
    out.push((rest & 0x7f) | 0x80);
    rest = Math.floor(rest / 0x80);
  }
  out.push(rest);
}

/**
 * Encode frame codes (see frameCode) and events as a log. Throws InputLogError "range" on
 * a bad frame, event or length, and "too-long" past MAX_LOG_BYTES.
 */
export function encodeInputCodes(codes: ArrayLike<number>, events: readonly InputEvent[], fromTick = 0, ruleset = RULESET_VERSION): Uint8Array {
  if (!isInt(fromTick, 0, MAX_TICKS)) throw new InputLogError("range", `fromTick ${fromTick} is outside 0..${MAX_TICKS}`);
  if (codes.length > MAX_TICKS - fromTick) throw new InputLogError("range", `${codes.length} frames from tick ${fromTick} run past tick ${MAX_TICKS}`);
  if (!isInt(ruleset, 0, 0x0fffffff)) throw new InputLogError("range", `ruleset ${ruleset} is not a small integer`);
  if (events.length > MAX_LOG_EVENTS) throw new InputLogError("range", `${events.length} events is more than ${MAX_LOG_EVENTS}`);
  const out: number[] = [LOG_VERSION];
  writeVarint(out, ruleset);
  writeVarint(out, fromTick);
  writeVarint(out, codes.length);
  let i = 0;
  while (i < codes.length) {
    const code = codes[i];
    if (!isInputFrame(frameFromCode(code)) || frameCode(frameFromCode(code)) !== code) throw new InputLogError("range", `frame ${i} is not a valid InputFrame`);
    let run = 1;
    while (i + run < codes.length && codes[i + run] === code) run += 1;
    out.push(code & 0xff, (code >> 8) | (run > 1 ? REPEAT : 0));
    if (run > 1) writeVarint(out, run - 2);
    i += run;
  }
  writeVarint(out, events.length);
  let prev = -1;
  for (let k = 0; k < events.length; k++) {
    const e = events[k];
    const kind = EVENT_KINDS.indexOf(e.kind);
    const last = fromTick + codes.length;
    if (kind < 0 || !isInt(e.value, 0, MAX_EVENT_VALUE) || !isInt(e.tick, fromTick, last) || e.tick <= prev) {
      throw new InputLogError("range", `event ${k} is out of range or out of order`);
    }
    writeVarint(out, k === 0 ? e.tick - fromTick : e.tick - prev - 1);
    out.push(kind);
    writeVarint(out, e.value);
    prev = e.tick;
  }
  if (out.length > MAX_LOG_BYTES) throw new InputLogError("too-long", `the log is ${out.length} bytes, over ${MAX_LOG_BYTES}`);
  return Uint8Array.from(out);
}

/** Encode frames and events as a log (see encodeInputCodes). */
export function encodeInputLog(log: { frames: readonly InputFrame[]; events?: readonly InputEvent[]; fromTick?: number; ruleset?: number }): Uint8Array {
  const codes = log.frames.map((f, i) => {
    if (!isInputFrame(f)) throw new InputLogError("range", `frame ${i} is not a valid InputFrame`);
    return frameCode(f);
  });
  return encodeInputCodes(codes, log.events ?? [], log.fromTick ?? 0, log.ruleset ?? RULESET_VERSION);
}

interface Reader {
  bytes: Uint8Array;
  pos: number;
}

function readVarint(r: Reader, what: string): number {
  let value = 0;
  let scale = 1;
  for (let i = 0; i < MAX_VARINT_BYTES; i++) {
    if (r.pos >= r.bytes.length) throw new InputLogError("truncated", `${what} is cut short`);
    const byte = r.bytes[r.pos++];
    value += (byte & 0x7f) * scale;
    if ((byte & 0x80) === 0) {
      if (i > 0 && byte === 0) throw new InputLogError("noncanonical", `${what} has a redundant zero byte`);
      return value;
    }
    scale *= 0x80;
  }
  throw new InputLogError("range", `${what} is longer than ${MAX_VARINT_BYTES} bytes`);
}

function readByte(r: Reader, what: string): number {
  if (r.pos >= r.bytes.length) throw new InputLogError("truncated", `${what} is cut short`);
  return r.bytes[r.pos++];
}

/**
 * Decode a log into frame codes (one per tick) and events, strictly. Throws InputLogError
 * on anything but a canonical, in-range log.
 */
export function decodeInputCodes(bytes: Uint8Array): { ruleset: number; fromTick: number; codes: Uint16Array; events: InputEvent[] } {
  if (!(bytes instanceof Uint8Array)) throw new InputLogError("range", "an input log is a Uint8Array");
  if (bytes.length > MAX_LOG_BYTES) throw new InputLogError("too-long", `the log is ${bytes.length} bytes, over ${MAX_LOG_BYTES}`);
  if (bytes.length === 0) throw new InputLogError("truncated", "empty input log");
  const r: Reader = { bytes, pos: 0 };
  const version = readByte(r, "version");
  if (version !== LOG_VERSION) throw new InputLogError("version", `input log version ${version} is not ${LOG_VERSION}`);
  const ruleset = readVarint(r, "ruleset");
  const fromTick = readVarint(r, "fromTick");
  if (fromTick > MAX_TICKS) throw new InputLogError("too-long", `fromTick ${fromTick} is past ${MAX_TICKS}`);
  const count = readVarint(r, "frame count");
  if (count > MAX_TICKS - fromTick) throw new InputLogError("too-long", `${count} frames from tick ${fromTick} run past tick ${MAX_TICKS}`);
  const codes = new Uint16Array(count);
  let n = 0;
  let prev = -1;
  while (n < count) {
    const stick = readByte(r, `frame ${n}`);
    const flagged = readByte(r, `frame ${n}`);
    const mag = stick & 3;
    const dir = stick >> 2;
    if (mag === 0 && dir !== 0) throw new InputLogError("noncanonical", `frame ${n} has a direction with no tilt`);
    const buttons = flagged & 0x7f;
    if (buttons & 0x70) throw new InputLogError("range", `frame ${n} sets unused button bits`);
    if (((buttons >> 1) & 7) > 5) throw new InputLogError("range", `frame ${n} has one-shot ${(buttons >> 1) & 7}`);
    const code = stick | (buttons << 8);
    const run = flagged & REPEAT ? readVarint(r, `run at frame ${n}`) + 2 : 1;
    if (run > count - n) throw new InputLogError("range", `a run of ${run} overruns the ${count} frames`);
    if (code === prev) throw new InputLogError("noncanonical", `frame ${n} repeats the run before it`);
    codes.fill(code, n, n + run);
    n += run;
    prev = code;
  }
  const eventCount = readVarint(r, "event count");
  if (eventCount > MAX_LOG_EVENTS) throw new InputLogError("range", `${eventCount} events is more than ${MAX_LOG_EVENTS}`);
  const events: InputEvent[] = [];
  let tick = fromTick - 1;
  for (let k = 0; k < eventCount; k++) {
    const delta = readVarint(r, `event ${k}`);
    tick = k === 0 ? fromTick + delta : tick + 1 + delta;
    if (tick > fromTick + count) throw new InputLogError("range", `event ${k} at tick ${tick} is past the last frame`);
    const kind = readByte(r, `event ${k}`);
    if (kind >= EVENT_KINDS.length) throw new InputLogError("range", `event ${k} has unknown kind ${kind}`);
    const value = readVarint(r, `event ${k}`);
    if (value > MAX_EVENT_VALUE) throw new InputLogError("range", `event ${k} has value ${value}`);
    events.push({ tick, kind: EVENT_KINDS[kind], value });
  }
  if (r.pos !== bytes.length) throw new InputLogError("trailing", `${bytes.length - r.pos} bytes after the last event`);
  return { ruleset, fromTick, codes, events };
}

/** Decode a log into InputFrames and events (see decodeInputCodes). */
export function decodeInputLog(bytes: Uint8Array): InputLog {
  const { ruleset, fromTick, codes, events } = decodeInputCodes(bytes);
  const frames: InputFrame[] = new Array(codes.length);
  for (let i = 0; i < codes.length; i++) frames[i] = frameFromCode(codes[i]);
  return { ruleset, fromTick, frames, events };
}

/* ------------------------------------------------------------------- base64 */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function digitOf(c: number): number {
  if (c >= 65 && c <= 90) return c - 65;
  if (c >= 97 && c <= 122) return c - 71;
  if (c >= 48 && c <= 57) return c + 4;
  if (c === 43) return 62;
  if (c === 47) return 63;
  return -1;
}

/** Standard padded base64 (RFC 4648) with no Buffer or btoa, identical in browsers and Node. */
export function toBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const rest = bytes.length - i;
    const n = (bytes[i] << 16) | ((rest > 1 ? bytes[i + 1] : 0) << 8) | (rest > 2 ? bytes[i + 2] : 0);
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63];
    out += rest > 1 ? ALPHABET[(n >> 6) & 63] : "=";
    out += rest > 2 ? ALPHABET[n & 63] : "=";
  }
  return out;
}

/**
 * Strict base64: a length that's a multiple of 4, the standard alphabet only, padding only
 * at the end and zero unused bits, so every byte string has exactly one accepted text.
 */
export function fromBase64(text: string): Uint8Array {
  if (typeof text !== "string" || text.length % 4 !== 0) throw new InputLogError("base64", "base64 length is not a multiple of 4");
  const pad = text.endsWith("==") ? 2 : text.endsWith("=") ? 1 : 0;
  const out = new Uint8Array((text.length / 4) * 3 - pad);
  let o = 0;
  for (let i = 0; i < text.length; i += 4) {
    const last = i + 4 === text.length;
    const d = [0, 0, 0, 0];
    for (let k = 0; k < 4; k++) {
      const padded = last && ((pad === 2 && k >= 2) || (pad === 1 && k === 3));
      if (padded) continue;
      const v = digitOf(text.charCodeAt(i + k));
      if (v < 0) throw new InputLogError("base64", `bad base64 character at ${i + k}`);
      d[k] = v;
    }
    const n = (d[0] << 18) | (d[1] << 12) | (d[2] << 6) | d[3];
    out[o++] = (n >> 16) & 0xff;
    if (last && pad === 2) {
      if (n & 0xffff) throw new InputLogError("base64", "base64 has nonzero unused bits");
      break;
    }
    out[o++] = (n >> 8) & 0xff;
    if (last && pad === 1) {
      if (n & 0xff) throw new InputLogError("base64", "base64 has nonzero unused bits");
      break;
    }
    out[o++] = n & 0xff;
  }
  return out;
}
