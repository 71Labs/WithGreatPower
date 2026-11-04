/**
 * The tag rules every drafted post follows, enforced while it's written:
 *
 * - at most three tags (@mentions and #hashtags together), and always #NEARHackathon;
 * - @NEARProtocol only on season start and wrap posts, and once a day at most (the queue
 *   decides whether it's free today, src/server/social/queue.ts);
 * - a player is @-tagged only if they gave an X handle and opted in, and only while a tag
 *   is left; otherwise they're named by their in-game handle, as plain text.
 */
import { HASHTAG, MAX_TAGS, NEAR_MENTION } from "@/lib/social/x";

import type { Nameable } from "./players";

export class Tagger {
  /** Players named by their X handle in this post. */
  readonly tagged: Nameable[] = [];
  readonly #mentions: string[] = [];
  readonly #trailing: string[];

  constructor(opts: { near?: boolean } = {}) {
    this.#trailing = opts.near ? [HASHTAG, NEAR_MENTION] : [HASHTAG];
  }

  get tags(): string[] {
    return [...this.#mentions, ...this.#trailing];
  }

  /** How the post names `p`: `@xhandle` when they opted in and a tag is left, else their in-game handle. */
  name(p: Nameable): string {
    if (p.xTagOk && p.xHandle) {
      const tag = `@${p.xHandle}`;
      if (this.#mentions.includes(tag)) return tag;
      if (this.tags.length < MAX_TAGS) {
        this.#mentions.push(tag);
        this.tagged.push(p);
        return tag;
      }
    }
    return p.handle;
  }

  /** The finished post: the body, then the hashtag (and @NEARProtocol) on their own line. */
  finish(body: string): { text: string; tags: string[] } {
    return { text: `${body.trimEnd()}\n\n${this.#trailing.join(" ")}`, tags: this.tags };
  }
}
