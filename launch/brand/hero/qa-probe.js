/**
 * The anomaly probe, evaluated in the play page (`?debug=1`) by qa-anomalies.mjs. It wraps the
 * scene's per-frame update (`__wgpPlay.handle().inspect()`) and, after every drawn frame,
 * measures what the player sees against the city the scene was built from:
 *
 * - feet: each body's lowest sole (ankle or ball of the foot, whichever is lower) against the
 *   surface it stands on, for the hero (on his feet), the villains on foot, the allies and Gwei;
 * - legs: a knee bent backwards, a leg locked straight short of its target, crossed feet, and
 *   a foot or knee jumping between frames while the body is on its feet;
 * - the web: the strand's ends against the fist and the anchor, a strand through a solid, a
 *   strand left taut after the sim let go or missing while it holds, the fist's jitter, and an
 *   anchor with nothing drawn within reach;
 * - the camera: inside a solid or with a wall inside its near plane.
 *
 * Counts per issue (frames), the worst examples with their context, and shot requests (the
 * first and the worst of each) land in `window.__qa`. Nothing here changes the night: the sim,
 * the bot and the log run exactly as without it.
 */
(() => {
  const w = window;
  if (w.__qa) return true;
  const p = w.__wgpPlay;
  const h = p && p.handle && p.handle();
  const eng = h && h.inspect && h.inspect();
  if (!eng || !eng.characters) return false;
  const ch = eng.characters;
  const ctx = ch.ctx;
  const solids = eng.solids;
  const city = eng.cityData;
  /** The solids list buildings and setbacks, then the bridge, then the big props (camera/raycast.ts). */
  const cityBoxes = city.buildings.reduce((n, b) => n + (b.top ? 2 : 1), 0) + (city.bridge ? 1 + city.bridge.towers.length : 0);
  /** Distance along `u` to the first city box (buildings, setbacks, the bridge), or null. */
  const rayCity = (o, u, max, from = 0, to = cityBoxes) => {
    let best = max;
    let found = false;
    for (let i = from; i < to; i++) {
      let t0 = (solids.minX[i] - o.x) / (u.x || 1e-12);
      let t1 = (solids.maxX[i] - o.x) / (u.x || 1e-12);
      let tmin = Math.min(t0, t1);
      let tmax = Math.max(t0, t1);
      t0 = (solids.minY[i] - o.y) / (u.y || 1e-12);
      t1 = (solids.maxY[i] - o.y) / (u.y || 1e-12);
      tmin = Math.max(tmin, Math.min(t0, t1));
      tmax = Math.min(tmax, Math.max(t0, t1));
      if (tmax < tmin) continue;
      t0 = (solids.minZ[i] - o.z) / (u.z || 1e-12);
      t1 = (solids.maxZ[i] - o.z) / (u.z || 1e-12);
      tmin = Math.max(tmin, Math.min(t0, t1));
      tmax = Math.min(tmax, Math.max(t0, t1));
      if (tmax < tmin || tmax < 0) continue;
      // Only a real crossing counts (more than a graze along a face).
      if (tmax - Math.max(tmin, 0) < 2) continue;
      const t = Math.max(0, tmin);
      if (t < best) {
        best = t;
        found = true;
      }
    }
    return found ? best : null;
  };
  /** How much of the segment p0→p1 (length L), past m0 from p0 and short of m1 from p1, is inside boxes [from, to). */
  const insideLength = (p0, p1, L, m0, m1, from, to) => {
    let total = 0;
    const d = { x: p1.x - p0.x, y: p1.y - p0.y, z: p1.z - p0.z };
    for (let i = from; i < to; i++) {
      let t0 = m0 / L;
      let t1 = 1 - m1 / L;
      for (const [o, dd, lo, hi] of [
        [p0.x, d.x, solids.minX[i], solids.maxX[i]],
        [p0.y, d.y, solids.minY[i], solids.maxY[i]],
        [p0.z, d.z, solids.minZ[i], solids.maxZ[i]],
      ]) {
        if (Math.abs(dd) < 1e-9) {
          if (o < lo || o > hi) t1 = -1;
          continue;
        }
        let u0 = (lo - o) / dd;
        let u1 = (hi - o) / dd;
        if (u0 > u1) [u0, u1] = [u1, u0];
        t0 = Math.max(t0, u0);
        t1 = Math.min(t1, u1);
      }
      if (t1 > t0) total += (t1 - t0) * L;
    }
    return total;
  };
  /**
   * What the sim's sphere (centre x y z, radius r) stands on: the highest roof under its
   * centre if that's within reach below, else the highest roof it touches (resting on an edge
   * over a drop), else the street.
   */
  const support = (x, y, z, r, reach) => {
    let under = -1;
    let touch = -1;
    for (let i = 0; i < cityBoxes; i++) {
      const top = solids.maxY[i];
      if (top > y + 0.5) continue;
      const dx = Math.max(solids.minX[i] - x, 0, x - solids.maxX[i]);
      const dz = Math.max(solids.minZ[i] - z, 0, z - solids.maxZ[i]);
      if (dx === 0 && dz === 0) {
        if (under < 0 || top > solids.maxY[under]) under = i;
      } else if (dx * dx + dz * dz + (y - top) * (y - top) <= r * r && (touch < 0 || top > solids.maxY[touch])) touch = i;
    }
    const i = under >= 0 && y - solids.maxY[under] <= reach ? under : touch >= 0 ? touch : under;
    return i < 0 ? 0 : solids.maxY[i];
  };
  const Q = new (ch.root.quaternion.constructor)();
  const HERO_R = 26;
  const V = (x = 0, y = 0, z = 0) => ({ x, y, z });
  const sub = (a, b) => V(a.x - b.x, a.y - b.y, a.z - b.z);
  const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
  const len = (a) => Math.hypot(a.x, a.y, a.z);
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  const rnd = (a, k = 1) => [Math.round(a.x * k) / k, Math.round(a.y * k) / k, Math.round(a.z * k) / k];
  const wp = (bone) => {
    const e = bone.matrixWorld.elements;
    return V(e[12], e[13], e[14]);
  };

  const qa = {
    frames: 0,
    counts: {},
    worst: {},
    first: {},
    shots: [],
    samples: {},
    errors: [],
    started: performance.now(),
    hold: 0,
  };
  w.__qa = qa;
  const now = () => Math.round(performance.now() - qa.started);
  const SEVERITY = {
    "hero-foot-sunk": "high",
    "hero-foot-float": "high",
    "hero-on-edge": "info",
    "hero-knee-backward": "high",
    "hero-leg-locked": "med",
    "hero-feet-crossed": "med",
    "hero-foot-pop": "high",
    "hero-knee-pop": "high",
    "villain-foot-sunk": "high",
    "villain-foot-float": "high",
    "villain-knee-backward": "high",
    "villain-feet-crossed": "med",
    "villain-foot-pop": "med",
    "ally-foot-float": "high",
    "ally-foot-sunk": "high",
    "ally-knee-backward": "high",
    "ally-feet-crossed": "med",
    "gwei-off-tower": "high",
    "gwei-web-missing": "high",
    "gwei-web-hand-gap": "high",
    "web-hand-gap": "high",
    "web-anchor-gap": "high",
    "web-through-building": "high",
    "web-through-prop": "low",
    "web-after-release": "high",
    "web-missing": "high",
    "web-hand-away": "med",
    "web-grip-jitter": "med",
    "web-anchor-air": "high",
    "camera-in-building": "high",
    "camera-near-wall": "med",
  };
  qa.severity = SEVERITY;

  /** Count an issue this frame; keep the 6 worst (by `v`) with their context; ask for shots. */
  const flag = (id, v, info) => {
    qa.counts[id] = (qa.counts[id] || 0) + 1;
    const f = eng.__qaFrame;
    const ex = { v: +v.toFixed(2), t: now(), tick: f ? f.tick : -1, mode: f ? f.mode : "", ...info };
    const list = (qa.worst[id] = qa.worst[id] || []);
    if (list.length < 6 || v > list[list.length - 1].v) {
      list.push(ex);
      list.sort((a, b) => b.v - a.v);
      if (list.length > 6) list.length = 6;
    }
    if (!qa.first[id]) {
      qa.first[id] = ex;
      qa.shots.push({ id, kind: "first", ex });
      qa.hold = 0.45;
    } else if (v > (qa.first[id].shotV || qa.first[id].v) * 1.6 && (qa.first[id].shots || 0) < 2) {
      qa.first[id].shotV = v;
      qa.first[id].shots = (qa.first[id].shots || 0) + 1;
      qa.shots.push({ id, kind: "worse", ex });
      qa.hold = 0.45;
    }
  };
  /** A distribution sample (kept small: every value, rounded, capped). */
  const sample = (id, v) => {
    const s = (qa.samples[id] = qa.samples[id] || []);
    if (s.length < 4000) s.push(Math.round(v * 10) / 10);
  };

  /* ------------------------------------------------------------------ bodies */

  const ground = (x, z, y) => ctx.ground(x, z, y);
  /** Rest heights of the ball joints above the soles, per rig. */
  const ballRest = new WeakMap();
  const legsOf = (rig) => {
    let br = ballRest.get(rig);
    if (br === undefined) {
      const bl = rig.joints.get("ball_l");
      const brr = rig.joints.get("ball_r");
      br = bl && brr ? [bl.y, brr.y] : null;
      ballRest.set(rig, br);
    }
    const out = [];
    for (let i = 0; i < 2; i++) {
      const leg = rig.legs[i];
      const hip = wp(leg.upper);
      const knee = wp(leg.lower);
      const ankle = wp(leg.end);
      const ballBone = br ? rig.bones[rig.index.get(i === 0 ? "ball_l" : "ball_r")] : null;
      const ball = ballBone ? wp(ballBone) : null;
      const soleA = ankle.y - rig.spec.ankle;
      const soleB = ball ? ball.y - br[i] : Infinity;
      const sole = Math.min(soleA, soleB);
      const toe = ball ? sub(ball, ankle) : null;
      out.push({ hip, knee, ankle, ball, sole, toe, l: leg.l1 + leg.l2 });
    }
    return out;
  };
  /** The knee's offset from the hip–ankle line, along the pelvis's forward (negative: bent backwards). */
  const kneeBend = (g, fwd) => {
    const ax = sub(g.ankle, g.hip);
    const L = len(ax) || 1;
    const u = V(ax.x / L, ax.y / L, ax.z / L);
    const k = sub(g.knee, g.hip);
    const t = dot(k, u);
    const n = V(k.x - u.x * t, k.y - u.y * t, k.z - u.z * t);
    // The pelvis's forward, flattened onto the plane across the leg.
    const tt = dot(fwd, u);
    const f = V(fwd.x - u.x * tt, fwd.y - u.y * tt, fwd.z - u.z * tt);
    const fl = len(f);
    return { along: fl > 0.2 ? dot(n, f) / fl : 0, off: len(n), ratio: L / g.l };
  };
  /** The body's forward in the world: its pose's rotation (the rig faces +z at rest). */
  const bodyFwd = (q) => V(2 * (q.x * q.z + q.w * q.y), 2 * (q.y * q.z - q.w * q.x), 1 - 2 * (q.x * q.x + q.y * q.y));
  const fwdOf = (yaw) => V(Math.sin(yaw), 0, Math.cos(yaw));
  const leftOf = (yaw) => V(Math.cos(yaw), 0, -Math.sin(yaw));
  const prevLegs = new Map();

  /**
   * One body's legs: feet against `floor` (the surface it should stand on), the knees, crossing,
   * pops. `who`: "hero" | "villain" | "ally"; `onFeet`: standing or walking now.
   */
  const checkLegs = (who, key, rig, rot, yaw, floor, onFeet, dt, extra) => {
    const g = legsOf(rig);
    const fwd = bodyFwd(rot);
    for (let i = 0; i < 2; i++) {
      const b = kneeBend(g[i], fwd);
      // A knee bent backwards (beyond a straight leg's wobble): the shin folds the wrong way.
      if (b.off > 1.5 && b.along < -1.5) flag(`${who}-knee-backward`, -b.along, { key, leg: i, ...extra, hip: rnd(g[i].hip), knee: rnd(g[i].knee), ankle: rnd(g[i].ankle), fwd: rnd(fwd, 100) });
      if (who === "hero" && onFeet) sample("hero-leg-ratio", b.ratio);
    }
    if (!onFeet) {
      prevLegs.delete(key);
      return g;
    }
    const lowest = Math.min(g[0].sole, g[1].sole);
    const gap = lowest - floor;
    sample(`${who}-foot-gap`, gap);
    // On the run both feet leave the roof between strides (a sprint's flight): only past that.
    const moving = extra && (extra.action === "run" || extra.moving === true);
    if (gap > (moving ? 14 : 4)) flag(`${who}-foot-float`, gap, { key, floor: Math.round(floor), ...extra });
    // A sole below the surface under that foot (a roof, a tower top), not just below the body's.
    for (let i = 0; i < 2; i++) {
      const under = ground(g[i].ankle.x, g[i].ankle.z, floor + 4);
      const sunk = Math.max(under, floor) - g[i].sole;
      if (Math.abs(under - floor) < 40 && sunk > 4) flag(`${who}-foot-sunk`, sunk, { key, leg: i, floor: Math.round(floor), under: Math.round(under), ankleY: +g[i].ankle.y.toFixed(1), ballY: g[i].ball ? +g[i].ball.y.toFixed(1) : null, ankleRest: +rig.spec.ankle.toFixed(1), ...extra });
    }
    // Crossed: the left foot (on +X at rest) to the right of the right foot.
    const L = leftOf(yaw);
    const mid = V((g[0].hip.x + g[1].hip.x) / 2, 0, (g[0].hip.z + g[1].hip.z) / 2);
    const latL = dot(sub(g[0].ankle, mid), L);
    const latR = dot(sub(g[1].ankle, mid), L);
    if (latL < latR - 2) flag(`${who}-feet-crossed`, latR - latL, { key, ...extra });
    // Locked straight with the foot still off the floor: the IK couldn't reach it.
    if (who === "hero") {
      for (let i = 0; i < 2; i++) {
        const b = kneeBend(g[i], fwd);
        if (b.ratio > 0.997 && g[i].sole - floor > 3 && g[1 - i].sole - floor > 3) flag("hero-leg-locked", g[i].sole - floor, { key, leg: i, ...extra });
      }
    }
    // Pops: a foot or knee jumping against the hips between frames, per 60 Hz frame.
    const prev = prevLegs.get(key);
    const hips = V((g[0].hip.x + g[1].hip.x) / 2, (g[0].hip.y + g[1].hip.y) / 2, (g[0].hip.z + g[1].hip.z) / 2);
    const rel = g.map((x) => ({ a: sub(x.ankle, hips), k: sub(x.knee, hips) }));
    if (prev && dt > 0) {
      const k = 1 / 60 / Math.min(Math.max(dt, 1 / 240), 0.1);
      for (let i = 0; i < 2; i++) {
        const ja = dist(rel[i].a, prev[i].a) * k;
        const jk = dist(rel[i].k, prev[i].k) * k;
        sample(`${who}-foot-jump`, ja);
        if (ja > 12) flag(`${who}-foot-pop`, ja, { key, leg: i, ...extra });
        if (who === "hero" && jk > 10) flag("hero-knee-pop", jk, { key, leg: i, ...extra });
      }
    }
    prevLegs.set(key, rel);
    return g;
  };

  /* ------------------------------------------------------------------ the drawn city, for anchors */

  const layout = eng.city.layout;
  /** Distance from a point to the nearest drawn box or tank (approximate for turned boxes). */
  const nearestDrawn = (pt) => {
    let best = Infinity;
    for (const b of layout.boxes) {
      let d;
      if (b.to) {
        const ax = V(b.x, b.y, b.z);
        const ab = sub(b.to, ax);
        const t = Math.max(0, Math.min(1, dot(sub(pt, ax), ab) / (dot(ab, ab) || 1)));
        d = dist(pt, V(ax.x + ab.x * t, ax.y + ab.y * t, ax.z + ab.z * t)) - Math.max(b.w, b.d) / 2;
      } else {
        let lx = pt.x - b.x;
        let lz = pt.z - b.z;
        if (b.yaw) {
          const c = Math.cos(-b.yaw);
          const s = Math.sin(-b.yaw);
          const x = lx * c + lz * s;
          lz = -lx * s + lz * c;
          lx = x;
        }
        const dx = Math.max(0, Math.abs(lx) - b.w / 2);
        const dz = Math.max(0, Math.abs(lz) - b.d / 2);
        const dy = Math.max(0, b.y - pt.y, pt.y - (b.y + b.h));
        d = Math.hypot(dx, dy, dz);
      }
      if (d < best) best = d;
      if (best <= 0) return 0;
    }
    for (const t of layout.tanks) {
      const r = t.w * 0.58;
      const dr = Math.max(0, Math.hypot(pt.x - t.x, pt.z - t.z) - r);
      const dy = Math.max(0, t.y - pt.y, pt.y - (t.y + t.h));
      best = Math.min(best, Math.hypot(dr, dy));
    }
    return best;
  };
  const anchorSeen = new Map();

  /* ------------------------------------------------------------------ per frame */

  let lastGrip = null;
  let lastGrip2 = null;
  let lastPos = null;
  let lastAnchorKey = "";
  const update = eng.update.bind(eng);
  let lastPose = null;
  eng.update = (frame, camera, size, dpr, dt, time, cue) => {
    // Held on a flagged frame: the scene stands still too (camera, bodies, web), so the shot
    // shows exactly the frame that was measured.
    if (qa.hold > 0 && lastPose) return lastPose;
    eng.__qaFrame = frame;
    const pose = update(frame, camera, size, dpr, dt, time, cue);
    lastPose = pose;
    try {
      if (frame) measure(frame, camera, dt);
    } catch (e) {
      if (qa.errors.length < 20) qa.errors.push(String(e && e.stack ? e.stack.slice(0, 300) : e));
    }
    return pose;
  };

  const measure = (f, camera, dt) => {
    qa.frames++;
    const hero = ch.hero;
    if (!hero) return;
    const hp = f.hero.pos;
    const teleport = lastPos && dist(lastPos, hp) > 120;
    lastPos = V(hp.x, hp.y, hp.z);
    if (teleport) {
      prevLegs.clear();
      lastGrip = lastGrip2 = null;
    }
    const ha = hero.anim;
    const heroBody = hero.model.constructor.name;
    const ctxInfo = { base: ha.base, action: f.hero.action || "", body: heroBody, x: Math.round(hp.x), y: Math.round(hp.y), z: Math.round(hp.z) };

    /* The hero's feet: on his feet (the sim says grounded and the animator stands him). */
    const onFeet = f.hero.grounded && ha.base === "ground" && f.mode !== "done" && f.mode !== "ko" && hero.model.visible && (ha.impactT || 0) <= 0;
    const floor = ground(hp.x, hp.z, hp.y + 4);
    if (onFeet) {
      // The sim stands the hero's sphere on the surface (its centre HERO_R above a flat roof,
      // less over an edge); the scene's surface under his centre should be that one.
      const sup = support(hp.x, hp.y, hp.z, HERO_R + 1.5, HERO_R + 4);
      ctxInfo.edge = Math.round(sup - floor);
      sample("hero-sim-ground", hp.y - HERO_R - floor);
      // The sim's sphere resting on a roof's edge, its centre out over a drop (sim behaviour).
      if (Math.abs(sup - floor) > 3) flag("hero-on-edge", Math.abs(sup - floor), { ...ctxInfo, floor: Math.round(floor), support: Math.round(sup) });
    }
    // His feet against what the sim stands him on (under his centre, or the edge his sphere rests on).
    const stand = onFeet ? support(hp.x, hp.y, hp.z, HERO_R + 1.5, HERO_R + 4) : floor;
    if (hero.model.visible && ha.base !== "ko") checkLegs("hero", "hero", hero.model.rig, ha.pose.rot, ha.turn.value, stand, onFeet, dt, ctxInfo);

    /* The web. */
    const shot = ch.shot;
    const web = ch.web.mesh;
    const anchor = f.hero.anchor;
    const grip = ha.grip;
    if (anchor) {
      const drawn = web.visible && shot.count >= 2;
      if (!drawn && shot.state !== "shoot") flag("web-missing", 1, { ...ctxInfo, state: shot.state });
      if (drawn && shot.state === "taut") {
        const pts = shot.points;
        const a0 = V(pts[0], pts[1], pts[2]);
        const last = Math.round((ch.web.geo.drawRange.count || 12) / 12);
        const a1 = V(pts[last * 3], pts[last * 3 + 1], pts[last * 3 + 2]);
        // The fist the strand leaves from, re-read from the bones as drawn this frame.
        const rig = hero.model.rig;
        const fist = V(rig.grip.x, rig.grip.y, rig.grip.z);
        const e = rig.arms[1].end.matrixWorld.elements;
        const fw = V(e[0] * fist.x + e[4] * fist.y + e[8] * fist.z + e[12], e[1] * fist.x + e[5] * fist.y + e[9] * fist.z + e[13], e[2] * fist.x + e[6] * fist.y + e[10] * fist.z + e[14]);
        const hg = dist(a0, fw);
        sample("web-hand-gap", hg);
        if (hg > 2) flag("web-hand-gap", hg, ctxInfo);
        const ag = dist(a1, anchor);
        if (ag > 1) flag("web-anchor-gap", ag, ctxInfo);
        // Through a building: the strand as drawn (it may bend over an edge), how much of it is
        // inside the city's boxes, past the fist and short of the anchor's own face.
        const segs = Math.round((ch.web.geo.drawRange.count || 0) / 12);
        let inside = 0;
        let insideProp = 0;
        for (let k = 0; k < segs; k++) {
          const p0 = V(pts[k * 3], pts[k * 3 + 1], pts[k * 3 + 2]);
          const p1 = V(pts[k * 3 + 3], pts[k * 3 + 4], pts[k * 3 + 5]);
          const SL = dist(p0, p1);
          if (SL < 1) continue;
          const m0 = k === 0 ? 4 : 3;
          const m1 = k === segs - 1 ? 12 : 3;
          inside += insideLength(p0, p1, SL, m0, m1, 0, cityBoxes);
          if (k === segs - 1) insideProp += insideLength(p0, p1, SL, m0, 30, cityBoxes, solids.count);
        }
        sample("web-inside", inside);
        if (segs > 1) qa.wrapped = (qa.wrapped || 0) + 1;
        if (inside > 3) flag("web-through-building", inside, { ...ctxInfo, segs, ax: Math.round(anchor.x), ay: Math.round(anchor.y), az: Math.round(anchor.z) });
        if (insideProp > 3) flag("web-through-prop", insideProp, { ...ctxInfo });
        // The web hand reaching for the line (the line leaves the shoulder's side toward the anchor).
        const sh = wp(rig.arms[1].upper);
        const toA = sub(anchor, sh);
        const toH = sub(fw, sh);
        const cos = dot(toA, toH) / ((len(toA) || 1) * (len(toH) || 1));
        const ang = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
        if (ha.base === "swing") sample("web-hand-angle", ang);
        if (ha.base === "swing" && ang > 50) flag("web-hand-away", ang, ctxInfo);
        // Jitter: the fist's second difference against the hero (per 60 Hz frame²).
        const rel = sub(fw, hp);
        if (lastGrip && lastGrip2 && ha.base === "swing" && dt > 0) {
          const k = (1 / 60 / Math.min(Math.max(dt, 1 / 240), 0.1)) ** 2;
          const j = Math.hypot(rel.x - 2 * lastGrip.x + lastGrip2.x, rel.y - 2 * lastGrip.y + lastGrip2.y, rel.z - 2 * lastGrip.z + lastGrip2.z) * k;
          sample("web-grip-jerk", j);
          if (j > 4) flag("web-grip-jitter", j, ctxInfo);
        }
        lastGrip2 = lastGrip;
        lastGrip = rel;
      } else {
        lastGrip = lastGrip2 = null;
      }
      // The anchor on something drawn.
      const key = `${Math.round(anchor.x)},${Math.round(anchor.y)},${Math.round(anchor.z)}`;
      if (key !== lastAnchorKey) {
        lastAnchorKey = key;
        let d = anchorSeen.get(key);
        const onVillain = (f.villains || []).some((v) => dist(v.pos, anchor) < 90);
        if (d === undefined && !onVillain) {
          d = nearestDrawn(anchor);
          anchorSeen.set(key, d);
          sample("web-anchor-air", d);
          if (d > 10) flag("web-anchor-air", d, { ...ctxInfo, ax: Math.round(anchor.x), ay: Math.round(anchor.y), az: Math.round(anchor.z) });
        }
      }
    } else {
      lastGrip = lastGrip2 = null;
      lastAnchorKey = "";
      if (web.visible && (shot.state === "taut" || shot.state === "shoot")) flag("web-after-release", 1, { ...ctxInfo, state: shot.state });
    }

    /* Villains on foot. */
    for (const [id, a] of ch.villains) {
      if (!a.model.visible) continue;
      const v = (f.villains || []).find((x) => x.id === id && !x.copy);
      if (!v) continue;
      const fl = ground(v.pos.x, v.pos.z, v.pos.y + 4);
      // The villains on foot (Sandwich Man, the Right-Clicker): their animator says when they're down.
      const walker = id === "sandwich-man" || id === "right-clicker";
      const standing = walker && (a.anim.grounded ?? v.pos.y - fl < 50) && v.state !== "webbed" && !a.anim.dangle.active;
      const an = a.anim;
      checkLegs("villain", id, a.model.rig, an.pose.rot, an.turn.value, fl, standing, dt, {
        id,
        state: v.state,
        body: a.model.constructor.name,
        x: Math.round(v.pos.x),
        y: Math.round(v.pos.y),
        z: Math.round(v.pos.z),
        simGap: Math.round(v.pos.y - fl),
        moving: Math.hypot(v.vel ? v.vel.x : 0, v.vel ? v.vel.z : 0) > 40,
        H: rnd(an.H),
        targets: [rnd(an.pose.foot[0]), rnd(an.pose.foot[1])],
        groupY: Math.round(a.model.group.position.y),
        shot: an.clips && an.clips.shot ? an.clips.shot.name : null,
      });
    }

    /* Allies on their roofs; Gwei on her tower. */
    for (const a of ch.allies) {
      if (!a.model.visible) continue;
      const id = a.zone.ally;
      const at = a.at;
      const fl = ground(at.x, at.z, at.y + 4);
      const info = { id, body: a.model.constructor.name, x: Math.round(at.x), y: Math.round(at.y), z: Math.round(at.z), surface: Math.round(fl), state: a.anim.state };
      const g = checkLegs("ally", `ally-${id}`, a.model.rig, a.anim.pose.rot, a.anim.turn.value, fl, true, dt, info);
      if (id === "gwei") {
        // The tower she stands on as the scene draws it: a flat lid (TankSpec.flat), or a cone
        // from its eave up to its point, under each foot.
        const tank = layout.tanks.find((t) => Math.hypot(t.x - at.x, t.z - at.z) < 2);
        const surface = (p) => {
          if (!tank) return fl;
          const eave = tank.y + tank.h * 0.8;
          if (tank.flat) return eave;
          const R = tank.w * 0.58;
          const r = Math.hypot(p.x - tank.x, p.z - tank.z);
          return r >= R ? -Infinity : tank.y + tank.h - (r / R) * (tank.y + tank.h - eave);
        };
        const gaps = g.map((x) => x.sole - surface(x.ball || x.ankle));
        const gap = Math.min(...gaps);
        sample("gwei-gap", gap);
        if (Math.abs(gap) > 3) flag("gwei-off-tower", Math.abs(gap), { ...info, flat: tank ? tank.flat : null, gap: +gap.toFixed(1), soles: g.map((x) => +x.sole.toFixed(1)) });
      }
    }

    /* Gwei's assist: on her own web the whole way across (drawn, from her fist). */
    const gz = (f.hazards || []).find((x) => x.kind === "gwei");
    const gw = ch.gwei;
    if (gz && gw && gw.model.visible) {
      const shot = ch.gweiShot;
      const drawn = ch.gweiWeb.mesh.visible && shot.count >= 2;
      if (!drawn && shot.state !== "shoot") flag("gwei-web-missing", 1, { state: shot.state, x: Math.round(gz.pos.x), y: Math.round(gz.pos.y), z: Math.round(gz.pos.z) });
      if (drawn && shot.state === "taut") {
        const fist = gw.anim.grip;
        const gap = Math.hypot(shot.points[0] - fist.x, shot.points[1] - fist.y, shot.points[2] - fist.z);
        if (gap > 2) flag("gwei-web-hand-gap", gap, {});
      }
    }

    /* The camera. */
    const c = camera.position;
    let inside = -1;
    let near = Infinity;
    for (let i = 0; i < cityBoxes; i++) {
      const dx = Math.max(solids.minX[i] - c.x, 0, c.x - solids.maxX[i]);
      const dy = Math.max(solids.minY[i] - c.y, 0, c.y - solids.maxY[i]);
      const dz = Math.max(solids.minZ[i] - c.z, 0, c.z - solids.maxZ[i]);
      const d = Math.hypot(dx, dy, dz);
      if (d === 0) inside = i;
      if (d < near) near = d;
    }
    if (inside >= 0) {
      const i = inside;
      // How deep: the distance to the box's nearest face.
      const depth = Math.min(c.x - solids.minX[i], solids.maxX[i] - c.x, c.y - solids.minY[i], solids.maxY[i] - c.y, c.z - solids.minZ[i], solids.maxZ[i] - c.z);
      flag("camera-in-building", depth, { ...ctxInfo, cam: rnd(c), box: [solids.minX[i], solids.minY[i], solids.minZ[i], solids.maxX[i], solids.maxY[i], solids.maxZ[i]].map(Math.round), status: p.loop.status });
    }
    else if (near < camera.near * 1.5) flag("camera-near-wall", camera.near * 1.5 - near, { ...ctxInfo, near: +near.toFixed(1) });
  };

  // Hold the sim a beat after an issue is flagged, so its shot shows it (the bot's and the
  // log's ticks are untouched: a held loop just steps no ticks).
  const loop = p.loop;
  const advance = loop.advance.bind(loop);
  loop.advance = (s) => {
    if (qa.hold > 0) {
      qa.hold -= s;
      return;
    }
    return advance(s);
  };
  return true;
})();
