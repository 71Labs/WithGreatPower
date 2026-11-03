import { neueMontreal } from "./fonts";

/**
 * A Neue Montreal file fetched with the HTML rather than once the stylesheet asks for it, so
 * the first paint already has it (React hoists the link into the head). Nothing in builds
 * without the licensed files.
 */
export function FontPreload({ weight }: { weight: "Regular" | "Medium" | "Bold" }) {
  if (!neueMontreal) return null;
  return <link rel="preload" href={`/fonts/NeueMontreal-${weight}.woff2`} as="font" type="font/woff2" crossOrigin="anonymous" />;
}
