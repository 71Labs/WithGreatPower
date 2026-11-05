/**
 * Development only: `/play/patrol?chapter=investigate|standoff|rescue|done` lays a fixture
 * chapter (src/lib/cases/fixtures.ts) over a normal night's frames, for the overlays only
 * (the chapter HUD, the minimap, the city map), so the case HUD can be seen before the
 * gameplay build sends real chapter frames. `&aim=recover` (or any Right-Clicker state)
 * pins what he's doing in the standoff; it's "aim" otherwise. The scene and the sim never
 * see it. Production builds ignore the parameter (readFixtureParam).
 */
import type { City, RenderFrame3D } from "@wgp/game-core/sim3d/contract";

import { FrameTap } from "@/game3d/nav/tap";
import type { CameraPose } from "@/game3d/nav/waypoint";
import { readFixtureParam } from "@/lib/cases/data";
import { chapterFixture, isChapterFixture, withChapterFixture, type ChapterFixtureName } from "@/lib/cases/fixtures";
import type { RightClickerPhase } from "@/lib/cases/types";

const AIMS: readonly RightClickerPhase[] = ["idle", "aim", "flash", "recover", "copy", "drag", "stunned"];
const isAim = (v: string | null): v is RightClickerPhase => !!v && (AIMS as readonly string[]).includes(v);

export const chapterFixtureName = (): ChapterFixtureName | null => readFixtureParam("chapter", isChapterFixture);

/** A frame tap that hands its listeners the night's frame with the fixture chapter laid over it. */
export class FixtureTap extends FrameTap {
  private fixture: ReturnType<typeof chapterFixture> | null = null;
  private readonly aim = readFixtureParam("aim", isAim) ?? "aim";

  constructor(
    private readonly name: ChapterFixtureName,
    private readonly city: City,
  ) {
    super();
  }

  /** The frame as the overlays see it (the city map reads it once, when it opens). */
  dress(frame: RenderFrame3D): RenderFrame3D {
    // Laid out once, around wherever the hero stands when the night first draws.
    this.fixture ??= chapterFixture(this.name, this.city, { ...frame.hero.pos }, { aim: this.aim });
    return withChapterFixture(frame, this.fixture);
  }

  override run(frame: RenderFrame3D, pose: CameraPose | null, width: number, height: number): void {
    super.run(this.dress(frame), pose, width, height);
  }
}
