/**
 * X (Twitter) helpers shared by the browser and the server, all pure: the weighted
 * character count X enforces, the @mentions and #hashtags in a post, X handle validation
 * and the intent link a person posts from. Nothing here talks to X.
 *
 * The count follows twitter-text's v3 rules: text is NFC-normalized; every link counts 23
 * (t.co); an emoji counts 2 however many code points it has; other code points count 1 in
 * the Latin and general punctuation ranges and 2 elsewhere (CJK, arrows, the ellipsis).
 */

export const X_MAX = 280;
export const X_URL_LENGTH = 23;
export const X_HANDLE_MAX = 15;

/** The hashtag every drafted post carries, and the account it may tag once a day. */
export const HASHTAG = "#NEARHackathon";
export const NEAR_MENTION = "@NEARProtocol";
export const MAX_TAGS = 3;

/** Code points X counts as 1 (twitter-text v3 `ranges`); everything else is 2. */
function weight(cp: number): number {
  return cp <= 4351 || (cp >= 8192 && cp <= 8205) || (cp >= 8208 && cp <= 8223) || (cp >= 8242 && cp <= 8247) ? 1 : 2;
}

/** Top-level domains X links without a scheme. Not the full list: the ones a game post plausibly carries. */
const TLDS =
  "com|net|org|io|fun|xyz|dev|app|co|gg|ai|me|so|sh|fm|tv|ly|to|is|it|us|uk|de|fr|ng|info|biz|site|online|tech|wtf|lol|club|link|page|art|game|games|world|news|blog";
const URL_SOURCE = `(?<![\\p{L}\\p{N}_@.\\-/])(?:https?:\\/\\/[^\\s]+|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+(?:${TLDS})(?![\\p{L}\\p{N}_-])(?::\\d{1,5})?(?:\\/[^\\s]*)?)`;
const EMOJI_SOURCE =
  "(?:\\p{Regional_Indicator}{2}|[#*0-9]\\uFE0F?\\u20E3|\\p{Extended_Pictographic}(?:\\uFE0F|\\p{Emoji_Modifier})?(?:\\u200D\\p{Extended_Pictographic}(?:\\uFE0F|\\p{Emoji_Modifier})?)*)";
/** Characters a link never ends with: they belong to the sentence around it. */
const TRAILING = /[.,!?:;'"’”)\]]+$/u;

const codePoints = (s: string) => {
  let n = 0;
  for (const ch of s) n += weight(ch.codePointAt(0)!);
  return n;
};

/** The links in `text` as X would find them, trailing punctuation left off. */
export function linksIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.normalize("NFC").matchAll(new RegExp(URL_SOURCE, "giu"))) {
    const url = m[0].replace(TRAILING, "");
    if (url) out.push(url);
  }
  return out;
}

/** The weighted length X counts for `text` (280 at most for a post). */
export function xLength(text: string): number {
  const s = text.normalize("NFC");
  const re = new RegExp(`(${URL_SOURCE})|(${EMOJI_SOURCE})`, "giu");
  let total = 0;
  let last = 0;
  for (const m of s.matchAll(re)) {
    const start = m.index;
    total += codePoints(s.slice(last, start));
    if (m[1] !== undefined) {
      const url = m[1].replace(TRAILING, "");
      total += X_URL_LENGTH + codePoints(m[1].slice(url.length));
    } else {
      const ch = m[2]!;
      // A pictographic sign below U+2000 with no emoji selector (©, ®) is plain text.
      total += ch.codePointAt(0)! < 0x2000 && !/[️⃣]/u.test(ch) ? codePoints(ch) : 2;
    }
    last = start + m[0].length;
  }
  return total + codePoints(s.slice(last));
}

/** The @mentions and #hashtags in `text`, in order, each once (links aren't searched). */
export function tagsIn(text: string): string[] {
  const s = text.normalize("NFC").replace(new RegExp(URL_SOURCE, "giu"), " ");
  const found = s.match(/(?<![\p{L}\p{N}_@])@[A-Za-z0-9_]{1,15}(?![A-Za-z0-9_@])|(?<![\p{L}\p{N}_#&])#[\p{L}\p{N}_]*\p{L}[\p{L}\p{N}_]*/gu) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of found) {
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

/** Why a post can't be approved as written, in words; empty when it can. */
export function postProblems(text: string): string[] {
  const problems: string[] = [];
  const length = xLength(text);
  if (!text.trim()) problems.push("The post is empty.");
  if (length > X_MAX) problems.push(`${length - X_MAX} over X’s ${X_MAX} limit.`);
  const tags = tagsIn(text);
  if (tags.length > MAX_TAGS) problems.push(`${tags.length} tags; keep it to ${MAX_TAGS}.`);
  if (!tags.some((t) => t.toLowerCase() === HASHTAG.toLowerCase())) problems.push(`Add ${HASHTAG}.`);
  return problems;
}

/** The X web intent that opens a post with `text` filled in, for the person to send themselves. */
export function xIntentUrl(text: string): string {
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
}

export type HandleCheck = { ok: true; handle: string } | { ok: false; message: string };

/** An X handle as typed (with or without the @) checked against X's rules: 1–15 of A–Z, a–z, 0–9 and _. */
export function normalizeXHandle(raw: string): HandleCheck {
  const handle = raw.trim().replace(/^@+/, "");
  if (!handle) return { ok: false, message: "Type your X handle, or remove it." };
  if (handle.length > X_HANDLE_MAX) return { ok: false, message: `X handles are at most ${X_HANDLE_MAX} characters.` };
  if (!/^[A-Za-z0-9_]+$/.test(handle)) return { ok: false, message: "Use only letters, numbers and _, like on X." };
  return { ok: true, handle };
}
