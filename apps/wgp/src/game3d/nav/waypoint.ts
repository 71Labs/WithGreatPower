/**
 * Waypoint placement: where the next stop lands on screen, and when it's off screen (or
 * behind the camera) where the edge arrow sits and which way it points. Pure: the chase
 * pose (position, target, vertical FOV) is all the camera there is, the same way the
 * scene builds it (lookAt with +y up, no roll).
 */
import type { Vec3 } from "@wgp/game-core/sim3d/contract";

export interface CameraPose {
  position: Vec3;
  target: Vec3;
  /** Vertical field of view, degrees. */
  fov: number;
}

export interface Projected {
  /** Screen px (CSS), from the top left. Meaningless when `behind`. */
  x: number;
  y: number;
  /** Distance along the view direction; ≤ 0 is behind the camera. */
  depth: number;
  behind: boolean;
  /** The point's bearing off the view direction, radians (+ is to the right), for points behind. */
  bearing: number;
}

/** Insets of the box the waypoint stays inside, CSS px from each edge. */
export interface SafeInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface Placement {
  /** In the safe box and in front: draw the pin at (x, y). Else an edge arrow at (x, y) pointing along `angle`. */
  onScreen: boolean;
  x: number;
  y: number;
  /** Screen angle of the arrow, radians, 0 along +x and clockwise (y is down). */
  angle: number;
}

/** Project a world point with the chase pose into a w × h CSS px viewport. */
export function project(p: Vec3, cam: CameraPose, w: number, h: number): Projected {
  let fx = cam.target.x - cam.position.x;
  let fy = cam.target.y - cam.position.y;
  let fz = cam.target.z - cam.position.z;
  const fl = Math.hypot(fx, fy, fz) || 1;
  fx /= fl;
  fy /= fl;
  fz /= fl;
  // right = forward × up(0, 1, 0); up' = right × forward.
  let rx = -fz;
  let rz = fx;
  const rl = Math.hypot(rx, rz);
  if (rl < 1e-9) {
    // Looking straight up or down: any right will do.
    rx = 1;
    rz = 0;
  } else {
    rx /= rl;
    rz /= rl;
  }
  const ux = -rz * fy;
  const uy = rz * fx - rx * fz;
  const uz = rx * fy;

  const dx = p.x - cam.position.x;
  const dy = p.y - cam.position.y;
  const dz = p.z - cam.position.z;
  const xc = dx * rx + dz * rz;
  const yc = dx * ux + dy * uy + dz * uz;
  const zc = dx * fx + dy * fy + dz * fz;

  const t = Math.tan((cam.fov * Math.PI) / 360);
  const aspect = w / Math.max(1, h);
  const behind = zc <= 1e-3;
  const z = behind ? 1e-3 : zc;
  const ndcX = xc / (z * t * aspect);
  const ndcY = yc / (z * t);
  return { x: ((ndcX + 1) / 2) * w, y: ((1 - ndcY) / 2) * h, depth: zc, behind, bearing: Math.atan2(xc, zc) };
}

/** A screen rectangle, CSS px. */
export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface WaypointLayout {
  /** The edge arrow's box. */
  arrow: SafeInsets;
  /** The pin's box: its tip is the point and it stands about 84 px tall, so it starts lower. */
  pin: SafeInsets;
  /** HUD rectangles the arrow may not sit in: it slides along its edge past them. */
  avoid: Rect[];
  /** The same for the pin's tip, grown by the pin's size: a pin there turns into the arrow. */
  avoidPin: Rect[];
}

/** The pin's size about its tip: half its width each side, its height above. */
const PIN_HALF = 28;
const PIN_TALL = 84;

/**
 * Where the waypoint may go on a w × h screen, clear of the HUD. Phones: below the route
 * bar, clear of the minimap (top right, under the bar) and the power arc (bottom right).
 * Tablets: below the route bar, clear of the minimap (top right) and the arc. Desktops:
 * below the route bar, clear of the health card (top left), the minimap (bottom left) and
 * above the powers.
 */
export function waypointLayout(w: number, h: number, touch: boolean): WaypointLayout {
  const phone = touch && w < 768;
  let arrow: SafeInsets;
  let avoid: Rect[];
  if (phone) {
    arrow = { top: 222, right: 48, bottom: 120, left: 48 };
    avoid = [
      { x0: w - 150, y0: 180, x1: w, y1: 330 },
      { x0: w - 250, y0: h - 250, x1: w, y1: h },
    ];
  } else if (touch) {
    arrow = { top: 132, right: 52, bottom: 120, left: 52 };
    avoid = [
      { x0: w - 210, y0: 0, x1: w, y1: 270 },
      { x0: w - 270, y0: h - 280, x1: w, y1: h },
    ];
  } else {
    arrow = { top: 116, right: 52, bottom: 136, left: 52 };
    avoid = [
      { x0: 0, y0: 0, x1: 260, y1: 170 },
      { x0: 0, y0: h - 250, x1: 260, y1: h },
    ];
  }
  const avoidPin = avoid.map((r) => ({ x0: r.x0 - PIN_HALF, y0: r.y0, x1: r.x1 + PIN_HALF, y1: r.y1 + PIN_TALL }));
  return { arrow, pin: { ...arrow, top: arrow.top + PIN_TALL - 14, bottom: Math.round(arrow.bottom / 2) }, avoid, avoidPin };
}

function box(w: number, h: number, inset: SafeInsets) {
  const left = inset.left;
  const right = Math.max(left, w - inset.right);
  const top = inset.top;
  const bottom = Math.max(top, h - inset.bottom);
  return { left, right, top, bottom };
}

const within = (r: Rect, x: number, y: number) => x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1;

/** Whether a projected point is in front of the camera, inside the safe box and outside every avoided rectangle. */
export function inBox(pr: Projected, w: number, h: number, inset: SafeInsets, avoid: readonly Rect[] = []): boolean {
  const b = box(w, h, inset);
  if (pr.behind || pr.x < b.left || pr.x > b.right || pr.y < b.top || pr.y > b.bottom) return false;
  return !avoid.some((r) => within(r, pr.x, pr.y));
}

/**
 * Where to draw the waypoint. In front and inside the safe box: there. Otherwise on the
 * safe box's edge along the line from the screen centre toward the point; a point behind
 * the camera goes to the bottom edge, to the side you'd turn toward.
 */
export function place(pr: Projected, w: number, h: number, inset: SafeInsets, avoid: readonly Rect[] = []): Placement {
  if (inBox(pr, w, h, inset, avoid)) return { onScreen: true, x: pr.x, y: pr.y, angle: Math.PI / 2 };
  return { onScreen: false, ...edgePoint(pr, w, h, inset, avoid) };
}

/**
 * The point on the safe box's edge toward a projected point, and the arrow's angle (used
 * even for a point inside the box). A point landing in an avoided rectangle slides along
 * its edge to the rectangle's nearer side; the angle still points at the stop.
 */
export function edgePoint(pr: Projected, w: number, h: number, inset: SafeInsets, avoid: readonly Rect[] = []): { x: number; y: number; angle: number } {
  const { left, right, top, bottom } = box(w, h, inset);
  // From the centre of the safe box (the screen centre, pulled inside the box if the insets are lopsided).
  const cx = Math.min(right, Math.max(left, w / 2));
  const cy = Math.min(bottom, Math.max(top, h / 2));
  let dx: number;
  let dy: number;
  if (pr.behind) {
    dx = Math.sin(pr.bearing);
    dy = Math.max(0.35, -Math.cos(pr.bearing));
  } else {
    dx = pr.x - cx;
    dy = pr.y - cy;
  }
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) dy = 1;
  const tx = dx > 0 ? (right - cx) / dx : dx < 0 ? (left - cx) / dx : Infinity;
  const ty = dy > 0 ? (bottom - cy) / dy : dy < 0 ? (top - cy) / dy : Infinity;
  const k = Math.min(tx, ty);
  let x = cx + dx * k;
  let y = cy + dy * k;
  const angle = Math.atan2(dy, dx);
  for (const r of avoid) {
    if (!within(r, x, y)) continue;
    if (tx <= ty) {
      // On the left or right edge: up or down past the rectangle, whichever is nearer and still on the edge.
      const up = r.y0;
      const down = r.y1;
      y = (Math.abs(y - up) <= Math.abs(y - down) && up >= top) || down > bottom ? Math.max(top, up) : down;
    } else {
      // On the top or bottom edge: left or right past it.
      const l = r.x0;
      const rr = r.x1;
      x = (Math.abs(x - l) <= Math.abs(x - rr) && l >= left) || rr > right ? Math.max(left, l) : rr;
    }
  }
  return { x, y, angle };
}
