import type { Metadata, Viewport } from "next";

import { Patrol } from "./patrol";

export const metadata: Metadata = { title: "Patrol" };

/**
 * Edge to edge on a phone: the city draws under the notch, the home indicator and the
 * rounded corners, and the HUD keeps inside them with env(safe-area-inset-*), which only
 * reports the insets with viewport-fit=cover. The browser's bars take the night's colour.
 */
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#22264f" };

/** Tonight's patrol: the 3D city (the 2D game without WebGL 2), full screen over the app shell. */
export default function PatrolPage() {
  return <Patrol />;
}
