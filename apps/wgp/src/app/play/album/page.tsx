import type { Metadata } from "next";

import { AlbumScreen } from "@/components/album/album";

export const metadata: Metadata = {
  title: "Sticker album",
  description: "Every villain you’ve caught and every neighbor you’ve met, as stickers.",
};

export default function AlbumPage() {
  return <AlbumScreen />;
}
