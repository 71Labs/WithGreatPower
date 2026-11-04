"use client";

import dynamic from "next/dynamic";

// three.js and the crowd load only here, on the client.
const CrowdBench = dynamic(() => import("./bench"), {
  ssr: false,
  loading: () => (
    <p role="status" className="grid h-full place-items-center text-sm font-semibold text-game-paper">
      Gathering the crowd…
    </p>
  ),
});

export function CrowdLab() {
  return (
    <main id="main" className="fixed inset-0 overflow-hidden bg-game-night">
      <CrowdBench />
    </main>
  );
}
