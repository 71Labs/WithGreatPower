/**
 * Development only: `/play/city?marks=race|relays` lays fixture v1.9 map marks (six race
 * gates in a ring round where the hero first stands, or four relays at the corners of a square
 * round it) over the outing's frames, for the overlays only (the minimap, the waypoint, the
 * city map), on the tracked task (or the pickpocket task with none), so the marks can be seen
 * before the task builds send real ones. The scene and the sim never see them. Production
 * builds ignore the parameter (readFixtureParam).
 */
import type { TaskId } from "@wgp/game-core/city";
import type { RenderFrame3D, RoamMark, Vec3 } from "@wgp/game-core/sim3d/contract";

import { marksFixture } from "@/game3d/nav/roam-fixture";
import { FrameTap } from "@/game3d/nav/tap";
import type { CameraPose } from "@/game3d/nav/waypoint";
import { readFixtureParam } from "@/lib/cases/data";

export type RoamMarksFixture = "race" | "relays";

const isMarks = (v: string | null): v is RoamMarksFixture => v === "race" || v === "relays";

export const roamMarksFixture = (): RoamMarksFixture | null => readFixtureParam("marks", isMarks);

/** A frame tap that hands its listeners the outing's frame with the fixture marks laid over it. */
export class RoamFixtureTap extends FrameTap {
  private marks: RoamMark[] | null = null;
  private centre: Vec3 | null = null;

  private tracked: TaskId | null = null;

  constructor(private readonly kind: RoamMarksFixture) {
    super();
  }

  /** Put the marks on this task (the HUD's tracked one). */
  track(task: TaskId | null): void {
    this.tracked = task;
  }

  /** The frame as the overlays see it (the city map reads it once, when it opens). */
  dress(frame: RenderFrame3D): RenderFrame3D {
    const roam = frame.roam;
    if (!roam) return frame;
    const task = this.tracked ?? "pickpocket";
    // Laid out once round where the hero first stands; moved to another task when the tracked one changes.
    this.centre ??= { ...frame.hero.pos };
    if (!this.marks || this.marks[0]?.task !== task) this.marks = this.kind === "race" ? marksFixture("gate", task, this.centre, { passed: 2 }) : marksFixture("relay", task, this.centre, { unplugged: 1 });
    return { ...frame, roam: { ...roam, marks: this.marks } };
  }

  override run(frame: RenderFrame3D, pose: CameraPose | null, width: number, height: number): void {
    super.run(this.dress(frame), pose, width, height);
  }
}
