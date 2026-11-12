import type { MetadataRoute } from "next";

/**
 * The web app manifest: lets a phone add the game to its home screen, where it opens full
 * screen on Tonight. No service worker and no push: the icon on the home screen is the
 * reminder. The colours are the night sky's (--game-night).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "With Great Power",
    short_name: "WGP",
    description: "A free 3D web-swinging parody game in your browser, on NEAR.",
    id: "/play",
    start_url: "/play?source=homescreen",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#22264f",
    theme_color: "#22264f",
    categories: ["games", "entertainment"],
    icons: [
      { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/brand/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
