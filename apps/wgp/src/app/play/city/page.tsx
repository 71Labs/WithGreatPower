import type { Metadata, Viewport } from "next";

import { City } from "./city";

export const metadata: Metadata = { title: "City" };

/** Edge to edge on a phone, as a night: the city draws under the notch, the HUD keeps inside the safe area. */
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#22264f" };

/** Free roam: the whole city at your own pace, no timer, full screen over the app shell. */
export default function CityPage() {
  return <City />;
}
