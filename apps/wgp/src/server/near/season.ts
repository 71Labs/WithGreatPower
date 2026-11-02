/**
 * Season commitments. The contract stores a season's Merkle root and the digest of its
 * full results file; we publish the leaves so anyone can check a placement.
 *
 * Leaf: sha256("wgp-season-v1" 0 seasonId 0 rank 0 accountId 0 score), as hex.
 * Tree: pairs are hashed sorted (sha256(min ‖ max)), an odd node moves up as is, so a
 * proof is just the sibling hashes, with no left/right flags.
 */
import { createHash } from "node:crypto";

export interface SeasonLeaf {
  rank: number;
  accountId: string;
  score: number;
}

const sha = (...parts: (Buffer | string)[]) => {
  const h = createHash("sha256");
  for (const p of parts) h.update(p);
  return h.digest();
};

export function leafHash(seasonId: string, leaf: SeasonLeaf): Buffer {
  return sha(["wgp-season-v1", seasonId, String(leaf.rank), leaf.accountId, String(leaf.score)].join("\0"));
}

function parent(a: Buffer, b: Buffer): Buffer {
  return Buffer.compare(a, b) <= 0 ? sha(a, b) : sha(b, a);
}

function levels(leaves: Buffer[]): Buffer[][] {
  if (leaves.length === 0) throw new Error("A season needs at least one leaf");
  const out = [leaves];
  while (out[out.length - 1]!.length > 1) {
    const level = out[out.length - 1]!;
    const next: Buffer[] = [];
    for (let i = 0; i < level.length; i += 2) next.push(i + 1 < level.length ? parent(level[i]!, level[i + 1]!) : level[i]!);
    out.push(next);
  }
  return out;
}

export function merkleRoot(leaves: Buffer[]): string {
  const all = levels(leaves);
  return all[all.length - 1]![0]!.toString("hex");
}

export function merkleProof(leaves: Buffer[], index: number): string[] {
  const proof: string[] = [];
  let i = index;
  for (const level of levels(leaves).slice(0, -1)) {
    const sibling = i % 2 === 0 ? i + 1 : i - 1;
    if (sibling < level.length) proof.push(level[sibling]!.toString("hex"));
    i = Math.floor(i / 2);
  }
  return proof;
}

export function verifyProof(leaf: Buffer, proof: string[], root: string): boolean {
  let node = leaf;
  for (const p of proof) node = parent(node, Buffer.from(p, "hex"));
  return node.toString("hex") === root;
}

/** sha256 hex of the published results file. */
export function fileDigest(contents: string | Uint8Array): string {
  return sha(typeof contents === "string" ? contents : Buffer.from(contents)).toString("hex");
}

export interface SeasonCommitment {
  seasonId: string;
  root: string;
  digest: string;
  top10: string[];
  /** The file to publish: every leaf with its proof. Its sha256 is `digest`. */
  file: string;
}

/** Builds the root, the top 10 and the published results file from a ranked board. */
export function commitSeason(seasonId: string, board: SeasonLeaf[]): SeasonCommitment {
  const ranked = [...board].sort((a, b) => a.rank - b.rank);
  ranked.forEach((l, i) => {
    if (l.rank !== i + 1) throw new Error(`Ranks must run 1..n without gaps (got ${l.rank} at ${i + 1})`);
  });
  const hashes = ranked.map((l) => leafHash(seasonId, l));
  const root = merkleRoot(hashes);
  const file = JSON.stringify(
    { version: "wgp-season-v1", seasonId, root, leaves: ranked.map((l, i) => ({ ...l, proof: merkleProof(hashes, i) })) },
    null,
    2,
  );
  return { seasonId, root, digest: fileDigest(file), top10: ranked.slice(0, 10).map((l) => l.accountId), file };
}
