/**
 * Generates the keys for the game's mainnet accounts, before any of them exist, so the owner
 * only has to fund one address. Nothing touches the network.
 *
 *   cd apps/wgp && pnpm exec tsx ../../scripts/near/keys-mainnet.ts
 *
 * - A payer: an implicit account (64-hex id) that exists as soon as NEAR is sent to it.
 *   scripts/near/setup-mainnet.sh pays for everything else from it.
 * - wgpnear.near (owner and factory), game., relayer. and operator.wgpnear.near: created by
 *   setup-mainnet.sh with these keys.
 *
 * Each key is saved in near-cli's key files (~/.near-credentials/mainnet/<id>.json, mode 600)
 * and never overwritten, so re-running is safe. The ids and the keys the app uses (factory,
 * relayer, operator) are added to apps/wgp/.env.local, which git ignores. Private keys are
 * never printed.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { KeyPair } from "near-api-js";

const CREDS = join(homedir(), ".near-credentials", "mainnet");
const ENV_FILE = resolve(process.cwd(), ".env.local");
const PAYER_MARKER = join(CREDS, "wgpnear-payer.id");
const PARENT = "wgpnear.near";
const NAMED = { parent: PARENT, contract: `game.${PARENT}`, relayer: `relayer.${PARENT}`, operator: `operator.${PARENT}` } as const;

interface KeyFile {
  account_id: string;
  public_key: string;
  private_key: string;
}

function writeKey(file: KeyFile) {
  const path = join(CREDS, `${file.account_id}.json`);
  writeFileSync(path, JSON.stringify(file), { mode: 0o600 });
  chmodSync(path, 0o600);
}

function readKey(accountId: string): KeyFile | null {
  const path = join(CREDS, `${accountId}.json`);
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as KeyFile) : null;
}

function generate(accountId: string): KeyFile {
  const kp = KeyPair.fromRandom("ed25519");
  return { account_id: accountId, public_key: kp.getPublicKey().toString(), private_key: kp.toString() };
}

/** The named account's key, generated once. */
function named(accountId: string): KeyFile {
  const existing = readKey(accountId);
  if (existing) return existing;
  const file = generate(accountId);
  writeKey(file);
  return file;
}

/** The payer: an implicit account, whose id is the hex of its public key. Generated once. */
function payer(): KeyFile {
  if (existsSync(PAYER_MARKER)) {
    const id = readFileSync(PAYER_MARKER, "utf8").trim();
    const existing = readKey(id);
    if (existing) return existing;
  }
  const kp = KeyPair.fromRandom("ed25519");
  const id = Buffer.from(kp.getPublicKey().data).toString("hex");
  const file = { account_id: id, public_key: kp.getPublicKey().toString(), private_key: kp.toString() };
  writeKey(file);
  writeFileSync(PAYER_MARKER, `${id}\n`, { mode: 0o600 });
  return file;
}

/** Sets KEY=value lines in .env.local, replacing earlier values and keeping everything else. */
function upsertEnv(values: Record<string, string>, header: string) {
  let text = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "";
  for (const key of Object.keys(values)) text = text.replace(new RegExp(`^${key}=.*\\n?`, "m"), "");
  if (!text.includes(header)) text = `${text.replace(/\n*$/, "\n")}\n${header}\n`;
  const lines = Object.entries(values).map(([k, v]) => `${k}=${v}`).join("\n");
  text = text.replace(header, `${header}\n${lines}`);
  writeFileSync(ENV_FILE, text.replace(/\n{3,}/g, "\n\n"), { mode: 0o600 });
}

function main() {
  if (!existsSync(join(process.cwd(), "package.json")) || !process.cwd().endsWith("apps/wgp")) {
    throw new Error("Run from apps/wgp: cd apps/wgp && pnpm exec tsx ../../scripts/near/keys-mainnet.ts");
  }
  mkdirSync(CREDS, { recursive: true, mode: 0o700 });
  const p = payer();
  const keys = { parent: named(NAMED.parent), contract: named(NAMED.contract), relayer: named(NAMED.relayer), operator: named(NAMED.operator) };

  upsertEnv(
    {
      WGP_PAYER_ACCOUNT_ID: p.account_id,
      FACTORY_ACCOUNT_ID: NAMED.parent,
      FACTORY_PRIVATE_KEY: keys.parent.private_key,
      RELAYER_ACCOUNT_ID: NAMED.relayer,
      RELAYER_PRIVATE_KEYS: keys.relayer.private_key,
      OPERATOR_ACCOUNT_ID: NAMED.operator,
      OPERATOR_PRIVATE_KEY: keys.operator.private_key,
    },
    "# --- NEAR mainnet game accounts (scripts/near/keys-mainnet.ts). Keys also in ~/.near-credentials/mainnet/.\n# NEAR_NETWORK stays unset locally, so local dev never uses these on mainnet.",
  );

  const listed = readdirSync(CREDS).filter((f) => f.endsWith(".json")).length;
  console.log(`Payer (fund this): ${p.account_id}`);
  for (const [role, file] of Object.entries(keys)) console.log(`${role.padEnd(9)} ${file.account_id}  ${file.public_key}`);
  console.log(`Key files in ${CREDS}: ${listed}. .env.local updated (private keys not shown).`);
}

main();
