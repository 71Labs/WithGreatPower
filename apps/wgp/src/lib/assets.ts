/**
 * URLs for the big static files in public/ (models, audio, media), with the content version of
 * their folder (`?v=`, a hash next.config.ts takes at build time). next.config.ts serves
 * versioned URLs as immutable for a year, so a repeat visit loads them from the browser's
 * cache without asking the server, and a deploy that changes a file changes its URL.
 * Unversioned (tests, a folder that isn't there) the plain path comes back.
 */
const VERSIONS: Record<string, string | undefined> = {
  models: process.env.WGP_MODELS_V,
  audio: process.env.WGP_AUDIO_V,
  media: process.env.WGP_MEDIA_V,
};

export function assetUrl(path: string): string {
  const v = VERSIONS[path.split("/")[1] ?? ""];
  return v ? `${path}?v=${v}` : path;
}
