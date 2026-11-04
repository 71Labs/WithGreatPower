/**
 * WOFF2 → TrueType/OpenType, for the card images. `next/og` (Satori) reads TTF, OTF and
 * WOFF but not WOFF2, and the licensed Neue Montreal files ship only as WOFF2. This is
 * the W3C WOFF2 decoder, cut down to single fonts: Brotli (Node's zlib) unpacks the
 * tables, then the glyf/loca and hmtx transforms are undone. Font collections and the
 * metadata block aren't supported; a caller falls back to the bundled font on any throw.
 *
 * Reference: https://www.w3.org/TR/WOFF2/ (sections 4 and 5).
 */
import { brotliDecompressSync } from "node:zlib";

const KNOWN_TAGS = [
  "cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm", "glyf", "loca", "prep", "CFF ", "VORG", "EBDT",
  "EBLC", "gasp", "hdmx", "kern", "LTSH", "PCLT", "VDMX", "vhea", "vmtx", "BASE", "GDEF", "GPOS", "GSUB", "EBSC", "JSTF", "MATH",
  "CBDT", "CBLC", "COLR", "CPAL", "SVG ", "sbix", "acnt", "avar", "bdat", "bloc", "bsln", "cvar", "fdsc", "feat", "fmtx", "fvar",
  "gvar", "hsty", "just", "lcar", "mort", "morx", "opbd", "prop", "trak", "Zapf", "Silf", "Glat", "Gloc", "Feat", "Sill",
];

class Reader {
  pos = 0;
  constructor(readonly buf: Buffer) {}
  #need(n: number) {
    if (this.pos + n > this.buf.length) throw new Error("WOFF2: truncated");
  }
  u8() {
    this.#need(1);
    return this.buf[this.pos++]!;
  }
  u16() {
    this.#need(2);
    const v = this.buf.readUInt16BE(this.pos);
    this.pos += 2;
    return v;
  }
  i16() {
    this.#need(2);
    const v = this.buf.readInt16BE(this.pos);
    this.pos += 2;
    return v;
  }
  u32() {
    this.#need(4);
    const v = this.buf.readUInt32BE(this.pos);
    this.pos += 4;
    return v;
  }
  bytes(n: number) {
    this.#need(n);
    const out = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
  /** UIntBase128: 1–5 bytes, 7 bits each, high bit = more. */
  base128() {
    let value = 0;
    for (let i = 0; i < 5; i++) {
      const b = this.u8();
      if (i === 0 && b === 0x80) throw new Error("WOFF2: bad UIntBase128");
      value = value * 128 + (b & 0x7f);
      if (value > 0xffffffff) throw new Error("WOFF2: UIntBase128 overflow");
      if (!(b & 0x80)) return value;
    }
    throw new Error("WOFF2: UIntBase128 too long");
  }
  /** 255UInt16. */
  u255() {
    const code = this.u8();
    if (code === 253) return this.u16();
    if (code === 255) return this.u8() + 253;
    if (code === 254) return this.u8() + 506;
    return code;
  }
}

const u16 = (v: number) => {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(v & 0xffff);
  return b;
};
const i16 = (v: number) => {
  const b = Buffer.alloc(2);
  b.writeInt16BE(v);
  return b;
};

const withSign = (flag: number, base: number) => (flag & 1 ? base : -base);

/** Undoes the glyf transform (WOFF2 §5.1): returns glyf, loca, the loca format and each glyph's xMin. */
function rebuildGlyf(data: Buffer): { glyf: Buffer; loca: Buffer; indexFormat: number; xMins: number[] } {
  const r = new Reader(data);
  r.u16(); // reserved
  const optionFlags = r.u16();
  const numGlyphs = r.u16();
  const indexFormat = r.u16();
  const sizes = Array.from({ length: 7 }, () => r.u32());
  let at = r.pos;
  const stream = (n: number) => {
    const s = new Reader(data.subarray(at, at + n));
    if (s.buf.length < n) throw new Error("WOFF2: truncated glyf stream");
    at += n;
    return s;
  };
  const [nContourS, nPointsS, flagS, glyphS, compositeS, bboxS, instructionS] = sizes.map(stream) as [Reader, Reader, Reader, Reader, Reader, Reader, Reader];
  void optionFlags; // The overlap bitmap (bit 0) only sets OVERLAP_SIMPLE, which renderers ignore.
  const bboxBitmap = bboxS.bytes(((numGlyphs + 31) >> 5) << 2);

  const glyphs: Buffer[] = [];
  const xMins: number[] = [];
  for (let g = 0; g < numGlyphs; g++) {
    const nContours = nContourS.i16();
    const explicitBbox = (bboxBitmap[g >> 3]! & (0x80 >> (g & 7))) !== 0;
    if (nContours === 0) {
      glyphs.push(Buffer.alloc(0));
      xMins.push(0);
      continue;
    }
    if (nContours === -1) {
      const start = compositeS.pos;
      let flags: number;
      let instructions = false;
      do {
        flags = compositeS.u16();
        compositeS.u16(); // glyph index
        let skip = flags & 0x0001 ? 4 : 2;
        if (flags & 0x0008) skip += 2;
        else if (flags & 0x0040) skip += 4;
        else if (flags & 0x0080) skip += 8;
        compositeS.bytes(skip);
        if (flags & 0x0100) instructions = true;
      } while (flags & 0x0020);
      if (!explicitBbox) throw new Error("WOFF2: composite glyph without a bbox");
      const bbox = bboxS.bytes(8);
      const parts = [i16(-1), bbox, compositeS.buf.subarray(start, compositeS.pos)];
      if (instructions) {
        const n = glyphS.u255();
        parts.push(u16(n), instructionS.bytes(n));
      }
      glyphs.push(Buffer.concat(parts));
      xMins.push(bbox.readInt16BE(0));
      continue;
    }

    const endPts: number[] = [];
    let points = 0;
    for (let c = 0; c < nContours; c++) {
      points += nPointsS.u255();
      endPts.push(points - 1);
    }
    const xs: number[] = [];
    const ys: number[] = [];
    const onCurve: boolean[] = [];
    let x = 0;
    let y = 0;
    for (let p = 0; p < points; p++) {
      const raw = flagS.u8();
      const flag = raw & 0x7f;
      const n = flag < 84 ? 1 : flag < 120 ? 2 : flag < 124 ? 3 : 4;
      const b = glyphS.bytes(n);
      let dx: number;
      let dy: number;
      if (flag < 10) {
        dx = 0;
        dy = withSign(flag, ((flag & 14) << 7) + b[0]!);
      } else if (flag < 20) {
        dx = withSign(flag, (((flag - 10) & 14) << 7) + b[0]!);
        dy = 0;
      } else if (flag < 84) {
        const b0 = flag - 20;
        dx = withSign(flag, 1 + (b0 & 0x30) + (b[0]! >> 4));
        dy = withSign(flag >> 1, 1 + ((b0 & 0x0c) << 2) + (b[0]! & 0x0f));
      } else if (flag < 120) {
        const b0 = flag - 84;
        dx = withSign(flag, 1 + (Math.floor(b0 / 12) << 8) + b[0]!);
        dy = withSign(flag >> 1, 1 + (((b0 % 12) >> 2) << 8) + b[1]!);
      } else if (flag < 124) {
        dx = withSign(flag, (b[0]! << 4) + (b[1]! >> 4));
        dy = withSign(flag >> 1, ((b[1]! & 0x0f) << 8) + b[2]!);
      } else {
        dx = withSign(flag, (b[0]! << 8) + b[1]!);
        dy = withSign(flag >> 1, (b[2]! << 8) + b[3]!);
      }
      x += dx;
      y += dy;
      xs.push(x);
      ys.push(y);
      onCurve.push(!(raw >> 7));
    }
    const instructionLength = glyphS.u255();
    const instructions = instructionS.bytes(instructionLength);
    let bbox: [number, number, number, number];
    if (explicitBbox) bbox = [bboxS.i16(), bboxS.i16(), bboxS.i16(), bboxS.i16()];
    else bbox = points ? [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] : [0, 0, 0, 0];

    const flags: number[] = [];
    const xBytes: Buffer[] = [];
    const yBytes: Buffer[] = [];
    let px = 0;
    let py = 0;
    for (let p = 0; p < points; p++) {
      let f = onCurve[p] ? 0x01 : 0;
      const ddx = xs[p]! - px;
      const ddy = ys[p]! - py;
      px = xs[p]!;
      py = ys[p]!;
      if (ddx === 0) f |= 0x10;
      else if (ddx >= -255 && ddx <= 255) {
        f |= 0x02 | (ddx > 0 ? 0x10 : 0);
        xBytes.push(Buffer.of(Math.abs(ddx)));
      } else xBytes.push(i16(ddx));
      if (ddy === 0) f |= 0x20;
      else if (ddy >= -255 && ddy <= 255) {
        f |= 0x04 | (ddy > 0 ? 0x20 : 0);
        yBytes.push(Buffer.of(Math.abs(ddy)));
      } else yBytes.push(i16(ddy));
      flags.push(f);
    }
    glyphs.push(
      Buffer.concat([
        i16(nContours),
        ...bbox.map(i16),
        ...endPts.map(u16),
        u16(instructionLength),
        instructions,
        Buffer.from(flags),
        ...xBytes,
        ...yBytes,
      ]),
    );
    xMins.push(bbox[0]);
  }

  // Pad each glyph so every offset stays representable in the loca format.
  const align = indexFormat === 0 ? 2 : 4;
  const offsets: number[] = [0];
  const padded: Buffer[] = [];
  let total = 0;
  for (const g of glyphs) {
    const pad = (align - (g.length % align)) % align;
    padded.push(pad ? Buffer.concat([g, Buffer.alloc(pad)]) : g);
    total += g.length + pad;
    offsets.push(total);
  }
  const format = indexFormat === 0 && total / 2 > 0xffff ? 1 : indexFormat;
  const loca = Buffer.alloc(offsets.length * (format === 0 ? 2 : 4));
  offsets.forEach((o, i) => (format === 0 ? loca.writeUInt16BE(o / 2, i * 2) : loca.writeUInt32BE(o, i * 4)));
  return { glyf: Buffer.concat(padded), loca, indexFormat: format, xMins };
}

/** Undoes the hmtx transform (WOFF2 §5.4): left side bearings left out are the glyphs' xMin. */
function rebuildHmtx(data: Buffer, numGlyphs: number, numHMetrics: number, xMins: number[]): Buffer {
  const r = new Reader(data);
  const flags = r.u8();
  const advances = Array.from({ length: numHMetrics }, () => r.u16());
  const lsbs = Array.from({ length: numHMetrics }, (_, i) => (flags & 1 ? xMins[i] ?? 0 : r.i16()));
  const rest = Array.from({ length: numGlyphs - numHMetrics }, (_, i) => (flags & 2 ? xMins[numHMetrics + i] ?? 0 : r.i16()));
  return Buffer.concat([...advances.flatMap((a, i) => [u16(a), i16(lsbs[i]!)]), ...rest.map(i16)]);
}

function checksum(table: Buffer): number {
  let sum = 0;
  const padded = table.length % 4 ? Buffer.concat([table, Buffer.alloc(4 - (table.length % 4))]) : table;
  for (let i = 0; i < padded.length; i += 4) sum = (sum + padded.readUInt32BE(i)) >>> 0;
  return sum;
}

/** Decodes a single-font WOFF2 file into the TrueType (or CFF OpenType) file it was made from. */
export function woff2ToSfnt(input: Uint8Array): Buffer {
  const file = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  const r = new Reader(file);
  if (r.u32() !== 0x774f4632) throw new Error("Not a WOFF2 file");
  const flavor = r.u32();
  if (flavor === 0x74746366) throw new Error("WOFF2 font collections aren't supported");
  r.u32(); // length
  const numTables = r.u16();
  r.u16(); // reserved
  r.u32(); // totalSfntSize
  const compressedSize = r.u32();
  r.bytes(24); // versions, metadata and private blocks

  const tables: { tag: string; transformed: boolean; length: number; data?: Buffer }[] = [];
  for (let i = 0; i < numTables; i++) {
    const flags = r.u8();
    const tag = (flags & 0x3f) === 0x3f ? r.bytes(4).toString("latin1") : KNOWN_TAGS[flags & 0x3f];
    if (!tag) throw new Error("WOFF2: unknown table tag");
    const version = (flags >> 6) & 3;
    const origLength = r.base128();
    const transformed = tag === "glyf" || tag === "loca" ? version === 0 : version !== 0;
    tables.push({ tag, transformed, length: transformed ? r.base128() : origLength });
  }
  const data = brotliDecompressSync(r.bytes(compressedSize));
  let offset = 0;
  for (const t of tables) {
    t.data = data.subarray(offset, offset + t.length);
    offset += t.length;
  }

  const out = new Map<string, Buffer>();
  const byTag = new Map(tables.map((t) => [t.tag, t]));
  let xMins: number[] = [];
  const glyf = byTag.get("glyf");
  if (glyf?.transformed) {
    const rebuilt = rebuildGlyf(glyf.data!);
    out.set("glyf", rebuilt.glyf);
    out.set("loca", rebuilt.loca);
    xMins = rebuilt.xMins;
    const head = byTag.get("head");
    if (head) {
      const copy = Buffer.from(head.data!);
      copy.writeInt16BE(rebuilt.indexFormat, 50);
      out.set("head", copy);
    }
  }
  for (const t of tables) {
    if (out.has(t.tag)) continue;
    if (t.tag === "hmtx" && t.transformed) {
      const numGlyphs = byTag.get("maxp")!.data!.readUInt16BE(4);
      const numHMetrics = byTag.get("hhea")!.data!.readUInt16BE(34);
      out.set("hmtx", rebuildHmtx(t.data!, numGlyphs, numHMetrics, xMins));
    } else {
      out.set(t.tag, Buffer.from(t.data!));
    }
  }
  if (out.has("head")) out.get("head")!.writeUInt32BE(0, 8); // checkSumAdjustment, recomputed below

  const tags = [...out.keys()].sort();
  const entrySelector = Math.floor(Math.log2(tags.length));
  const searchRange = 2 ** entrySelector * 16;
  const header = Buffer.alloc(12 + 16 * tags.length);
  header.writeUInt32BE(flavor, 0);
  header.writeUInt16BE(tags.length, 4);
  header.writeUInt16BE(searchRange, 6);
  header.writeUInt16BE(entrySelector, 8);
  header.writeUInt16BE(tags.length * 16 - searchRange, 10);
  const bodies: Buffer[] = [];
  let at = header.length;
  tags.forEach((tag, i) => {
    const table = out.get(tag)!;
    const rec = 12 + i * 16;
    header.write(tag, rec, 4, "latin1");
    header.writeUInt32BE(checksum(table), rec + 4);
    header.writeUInt32BE(at, rec + 8);
    header.writeUInt32BE(table.length, rec + 12);
    const pad = (4 - (table.length % 4)) % 4;
    bodies.push(table, Buffer.alloc(pad));
    at += table.length + pad;
  });
  const font = Buffer.concat([header, ...bodies]);
  const headAt = tags.indexOf("head");
  if (headAt >= 0) {
    const headOffset = header.readUInt32BE(12 + headAt * 16 + 8);
    font.writeUInt32BE((0xb1b0afba - checksum(font)) >>> 0, headOffset + 8);
  }
  return font;
}
