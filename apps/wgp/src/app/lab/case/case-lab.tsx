"use client";

import dynamic from "next/dynamic";

// three.js and the cast load only here, on the client.
const CaseBench = dynamic(() => import("./bench"), {
  ssr: false,
  loading: () => (
    <p role="status" className="grid h-full place-items-center text-sm font-semibold text-game-paper">
      Building the case…
    </p>
  ),
});

export function CaseLab() {
  return (
    <main id="main" className="fixed inset-0 overflow-hidden bg-game-night">
      <CaseBench />
    </main>
  );
}
