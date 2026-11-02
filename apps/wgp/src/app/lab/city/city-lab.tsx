"use client";

import dynamic from "next/dynamic";

// three.js and the scene load only here, on the client.
const CityBench = dynamic(() => import("./bench"), {
  ssr: false,
  loading: () => (
    <p role="status" className="grid h-full place-items-center text-sm font-semibold text-game-paper">
      Building the city…
    </p>
  ),
});

export function CityLab() {
  return (
    <main id="main" className="fixed inset-0 overflow-hidden bg-game-night">
      <CityBench />
    </main>
  );
}
