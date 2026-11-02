import type { Metadata } from "next";

import { Patrol } from "./patrol";

export const metadata: Metadata = { title: "Patrol" };

/** Tonight's patrol: the 3D city (the 2D game without WebGL 2), full screen over the app shell. */
export default function PatrolPage() {
  return <Patrol />;
}
