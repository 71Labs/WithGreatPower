"""
Builds "The Node": an athletic adult male from MPFB (MakeHuman: CC0 base mesh, targets and
rig), suited up for the comic render, and saves it as hero/build/hero-base.blend.

    blender -b -P launch/brand/hero/build.py

Nothing is downloaded: the base mesh, targets, rig and weights all ship inside the MPFB
extension. Steps:
  1. MakeHuman macros (male, fit, tall, ideal proportions) plus detail targets for a V-taper.
  2. The "game_engine" skeleton (UE4-style bone names) with MakeHuman's own skin weights.
  3. Bake the targets, drop the helper geometry (joint cubes, tights, hair helpers).
  4. "Suit" the body: smooth away navel, nipples, toe gaps, ear folds, lips and eye sockets,
     the way a full bodysuit and mask would.
  5. Web-pattern coordinates as face-corner attributes, computed in the rest pose so the
     pattern sticks to the body when posed (see web_fields()).
  6. Mask lenses: the hero sticker's teardrops (node.svg), wrapped onto the face and
     skinned to the head bone.
The body stays in MakeHuman's rest A-pose; render.py poses it.
"""

import heapq
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from bl_ext.blender_org.mpfb.services.humanservice import HumanService  # noqa: E402
from bl_ext.blender_org.mpfb.services.locationservice import LocationService  # noqa: E402
from bl_ext.blender_org.mpfb.services.targetservice import TargetService  # noqa: E402

OUT = os.path.join(HERE, "build")
os.makedirs(OUT, exist_ok=True)

# Macro sliders, 0..1 (0.5 is MakeHuman's average). Male, mid-20s, very fit, a touch tall,
# "ideal" (heroic) proportions.
MACROS = {
    "gender": 1.0,
    "age": 0.5,
    "muscle": 0.96,
    "weight": 0.55,
    "proportions": 1.0,
    "height": 0.6,
    "cupsize": 0.5,
    "firmness": 0.5,
    "race": {"asian": 0.2, "caucasian": 0.4, "african": 0.4},
}

# Detail targets on top of the macros: a superhero's V-taper, chest and shoulders, trim waist.
DETAILS = {
    "torso/torso-vshape-incr": 0.5,
    "torso/measure-shoulder-dist-incr": 0.25,
    "torso/torso-muscle-pectoral-incr": 0.25,
    "torso/torso-muscle-dorsi-incr": 0.6,
    "torso/torso-scale-depth-incr": 0.35,
    "torso/measure-waist-circ-decr": 0.1,
    "torso/measure-hips-circ-decr": 0.4,
    "hip/hip-scale-horiz-decr": 0.25,
    "buttocks/buttocks-volume-decr": 0.25,
    "stomach/stomach-tone-incr": 0.8,
    "neck/measure-neck-circ-incr": 0.3,
    "neck/measure-neck-height-incr": 0.4,
    "arms/l-upperarm-shoulder-muscle-incr": 0.5,
    "arms/r-upperarm-shoulder-muscle-incr": 0.5,
    "arms/l-upperarm-muscle-incr": 0.6,
    "arms/r-upperarm-muscle-incr": 0.6,
    "arms/l-lowerarm-muscle-incr": 0.35,
    "arms/r-lowerarm-muscle-incr": 0.35,
    "legs/l-upperleg-muscle-incr": 0.65,
    "legs/r-upperleg-muscle-incr": 0.65,
    "legs/l-lowerleg-muscle-incr": 0.6,
    "legs/r-lowerleg-muscle-incr": 0.6,
    "head/head-scale-horiz-decr": 0.12,
    "head/head-square": 0.3,
}

# The hero sticker's right-eye lens (launch/brand/art/node.svg, 120-unit viewBox): a cubic
# path. The face's web centre in the sticker is (60, 49).
LENS_PATH = [
    ((31, 33), (40, 33), (51, 37.5), (55.5, 45)),
    ((55.5, 45), (58.5, 51.5), (56.5, 59), (50.5, 60.5)),
    ((50.5, 60.5), (43.5, 62), (36.5, 57.5), (34.2, 50)),
    ((34.2, 50), (33, 45.5), (31.8, 39.5), (31, 33)),
]
LENS_UNIT = 0.0024  # metres per sticker unit on the face
LENS_RIM_OUT = 2.9  # sticker units of black rim outside the sticker's path
LENS_RIM_IN = 1.5  # ... and inside it (the sticker strokes 4.2 centred on the path)


# ---------------------------------------------------------------------------------------
# Mesh helpers (numpy over the whole body)


def mesh_arrays(me):
    co = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get("co", co)
    ed = np.empty(len(me.edges) * 2, dtype=np.int64)
    me.edges.foreach_get("vertices", ed)
    return co.reshape(-1, 3), ed.reshape(-1, 2)


def neighbour_mean(co, edges, n):
    acc = np.zeros_like(co)
    cnt = np.zeros(n)
    np.add.at(acc, edges[:, 0], co[edges[:, 1]])
    np.add.at(acc, edges[:, 1], co[edges[:, 0]])
    np.add.at(cnt, edges[:, 0], 1)
    np.add.at(cnt, edges[:, 1], 1)
    return acc / np.maximum(cnt, 1)[:, None]


def taubin(co, edges, strength, iterations, lam=0.55, mu=-0.58):
    """Volume-friendly smoothing; strength is a per-vertex 0..1 weight."""
    n = len(co)
    s = strength[:, None]
    for _ in range(iterations):
        co = co + s * lam * (neighbour_mean(co, edges, n) - co)
        co = co + s * mu * (neighbour_mean(co, edges, n) - co)
    return co


def laplace(co, edges, strength, iterations):
    n = len(co)
    s = strength[:, None]
    for _ in range(iterations):
        co = co + s * 0.6 * (neighbour_mean(co, edges, n) - co)
    return co


def smooth_field(values, edges, iterations):
    n = len(values)
    v = values.copy()
    for _ in range(iterations):
        v = 0.5 * v + 0.5 * neighbour_mean(v.reshape(n, -1), edges, n).reshape(v.shape)
    return v


def group_weights(ob, me, name):
    w = np.zeros(len(me.vertices))
    if name not in ob.vertex_groups:
        return w
    gi = ob.vertex_groups[name].index
    for v in me.vertices:
        for g in v.groups:
            if g.group == gi:
                w[v.index] = g.weight
    return w


def dijkstra(co, edges, sources):
    n = len(co)
    adj = [[] for _ in range(n)]
    lens = np.linalg.norm(co[edges[:, 0]] - co[edges[:, 1]], axis=1)
    for (a, b), l in zip(edges, lens):
        adj[a].append((b, l))
        adj[b].append((a, l))
    dist = np.full(n, np.inf)
    heap = []
    for s, d0 in sources:
        dist[s] = d0
        heap.append((d0, s))
    heapq.heapify(heap)
    while heap:
        d, u = heapq.heappop(heap)
        if d > dist[u]:
            continue
        for v, l in adj[u]:
            nd = d + l
            if nd < dist[v]:
                dist[v] = nd
                heapq.heappush(heap, (nd, v))
    return dist


def geodesic_from_point(co, edges, point, radius=0.02):
    """Distance from a surface point: seeded from every vertex within `radius` of it."""
    d0 = np.linalg.norm(co - point, axis=1)
    near = np.where(d0 < radius)[0]
    if len(near) == 0:
        near = [int(np.argmin(d0))]
    return dijkstra(co, edges, [(int(i), float(d0[i])) for i in near])


# ---------------------------------------------------------------------------------------
# 1–3: the human


def clear_scene():
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.armatures, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
        for block in list(coll):
            coll.remove(block)


def make_human():
    body = HumanService.create_human(
        mask_helpers=True,
        detailed_helpers=True,
        extra_vertex_groups=True,
        feet_on_ground=True,
        scale=0.1,
        macro_detail_dict=MACROS,
    )
    targets = LocationService.get_mpfb_data("targets")
    for name, weight in DETAILS.items():
        TargetService.load_target(body, os.path.join(targets, name + ".target.gz"), weight=weight)

    # The navel's vertices, found from the target that moves them, before targets are baked.
    navel = set()
    sk = TargetService.load_target(body, os.path.join(targets, "stomach/stomach-navel-in.target.gz"), weight=0.0)
    basis = body.data.shape_keys.reference_key
    for i, (a, b) in enumerate(zip(sk.data, basis.data)):
        if (a.co - b.co).length > 1e-5:
            navel.add(i)
    body.shape_key_remove(sk)

    rig = HumanService.add_builtin_rig(body, "game_engine", import_weights=True)
    body.name = "Node"
    rig.name = rig.data.name = "NodeRig"

    # Landmarks from the joint cubes, while the helpers still exist.
    me = body.data
    co, _ = mesh_arrays(me)
    TargetService.bake_targets(body)
    co, _ = mesh_arrays(me)
    marks = {}
    for name in ("joint-l-eye", "joint-r-eye", "joint-head", "joint-head-2", "joint-neck", "joint-mouth"):
        w = group_weights(body, me, name)
        marks[name] = co[w > 0.5].mean(axis=0)

    # Drop every helper vertex (keep the "body" group) and the mask modifier.
    navel_mask = np.zeros(len(me.vertices), dtype=bool)
    navel_mask[list(navel)] = True
    me.attributes.new("navel", "BOOLEAN", "POINT").data.foreach_set("value", navel_mask)
    bm = bmesh.new()
    bm.from_mesh(me)
    dl = bm.verts.layers.deform.active
    gi = body.vertex_groups["body"].index
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if gi not in v[dl]], context="VERTS")
    bm.to_mesh(me)
    bm.free()
    for m in list(body.modifiers):
        if m.type == "MASK":
            body.modifiers.remove(m)
    for vg in list(body.vertex_groups):
        if vg.name.startswith(("helper-", "joint-")) or vg.name in ("HelperGeometry", "JointCubes", "body"):
            body.vertex_groups.remove(vg)
    return body, rig, marks


# ---------------------------------------------------------------------------------------
# 4: the suit


def toe_boxes(body, rig, threshold=0.55, rings=7):
    """Replaces the toes with a smooth sock toe box: the toe faces are cut away at the ball
    of the foot and a new cap is lofted from that ring, rounding to a slight point toward
    the big toe, sole kept flat. The new vertices are skinned to the ball bone."""
    me = body.data
    n_before = None
    for side in ("l", "r"):
        bm = bmesh.new()
        bm.from_mesh(me)
        dl = bm.verts.layers.deform.active
        gb = body.vertex_groups["ball_" + side].index
        ball = rig.data.bones["ball_" + side]
        fwd = Vector(ball.tail_local - ball.head_local)
        fwd.z = 0.0
        fwd.normalize()
        side_dir0 = fwd.cross(Vector((0, 0, 1))).normalized()
        lateral = side_dir0 if (ball.head_local.x * side_dir0.x) > 0 else -side_dir0
        toe_verts = {v for v in bm.verts if v[dl].get(gb, 0.0) > threshold}
        # Cut on a plane behind the toe webs, slanted like the knuckle line (the little
        # toe's web sits further back than the big toe's).
        h0 = Vector(ball.head_local)

        def ahead(v):
            r = v.co - h0
            return r.dot(fwd) + 0.15 * r.dot(lateral) > -0.022

        toe_faces = [f for f in bm.faces if all(ahead(v) for v in f.verts) and any(v[dl].get(gb, 0.0) > 0.05 for v in f.verts)]
        tip_reach = max((v.co - ball.head_local).dot(fwd) for v in toe_verts)
        sole_z = min(v.co.z for v in toe_verts)
        bmesh.ops.delete(bm, geom=toe_faces, context="FACES_ONLY")
        # Drop anything no longer attached to the body (bits between the toes).
        bm.verts.ensure_lookup_table()
        seen, comps = set(), []
        for v in bm.verts:
            if v in seen:
                continue
            comp, stack = [], [v]
            seen.add(v)
            while stack:
                x = stack.pop()
                comp.append(x)
                for e in x.link_edges:
                    o = e.other_vert(x)
                    if o not in seen:
                        seen.add(o)
                        stack.append(o)
            comps.append(comp)
        comps.sort(key=len, reverse=True)
        for comp in comps[1:]:
            bmesh.ops.delete(bm, geom=comp, context="VERTS")
        loose = [v for v in bm.verts if not v.link_faces]
        bmesh.ops.delete(bm, geom=loose, context="VERTS")
        # The opening at the ball of the foot: walk its boundary loop.
        bnd = [e for e in bm.edges if e.is_boundary]
        start_v = bnd[0].verts[0]
        loop = [start_v]
        prev = None
        cur = start_v
        while True:
            nxt = None
            for e in cur.link_edges:
                if e.is_boundary:
                    o = e.other_vert(cur)
                    if o is not prev and (o is not loop[0] or len(loop) > 2):
                        nxt = o
                        break
            if nxt is None or nxt is loop[0]:
                break
            loop.append(nxt)
            prev, cur = cur, nxt
        assert len(bnd) == len(loop), f"toe opening isn't one loop ({len(bnd)} edges, {len(loop)} walked)"
        c0 = sum((v.co for v in loop), Vector()) / len(loop)
        length = max(tip_reach - (c0 - ball.head_local).dot(fwd), 0.03) * 0.97
        side_dir = fwd.cross(Vector((0, 0, 1))).normalized()
        medial = side_dir if (c0.x * side_dir.x) < 0 else -side_dir  # toward the body's midline
        rows = [loop]
        weights0 = [dict(v[dl]) for v in loop]
        bm.verts.index_update()
        if n_before is None:
            n_before = len(bm.verts)
        for k in range(1, rings + 1):
            u = k / (rings + 1)
            centre = c0 + fwd * (length * u) + medial * (0.012 * u * u)
            row = []
            for v in loop:
                rel = v.co - c0
                rel -= fwd * rel.dot(fwd)
                lat = side_dir * rel.dot(side_dir)
                up = rel.z
                g_lat = (1 - u**3) ** (1 / 3)
                g_up = (1 - u**2) ** 0.5 if up > 0 else (1 - u**4) ** 0.25
                p = centre + lat * g_lat + Vector((0, 0, up * g_up))
                p.z = max(p.z, sole_z + 0.004)
                row.append(bm.verts.new(p))
            rows.append(row)
        tip = bm.verts.new(c0 + fwd * length + medial * 0.012 + Vector((0, 0, -0.004)))
        n = len(loop)
        for a, b in zip(rows[:-1], rows[1:]):
            for i in range(n):
                j = (i + 1) % n
                bm.faces.new((a[i], a[j], b[j], b[i]))
        for i in range(n):
            bm.faces.new((rows[-1][i], rows[-1][(i + 1) % n], tip))
        for f in bm.faces:
            f.smooth = True
        # Skin: from the ring's own weights toward the ball bone.
        for k, row in enumerate(rows[1:], start=1):
            t = min(1.0, (k / rings) ** 0.5)
            for i, v in enumerate(row):
                wd = {g: wt * (1 - t) for g, wt in weights0[i].items()}
                wd[gb] = wd.get(gb, 0.0) + t
                for g, wt in wd.items():
                    v[dl][g] = wt
        tip[dl][gb] = 1.0
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        bm.to_mesh(me)
        bm.free()
        me.update()
        print(f"[build] toe box {side}: cut {len(toe_faces)} faces, lofted {rings} rings of {n}")
    # Round the new caps into the foot, with an extra pass along the seam.
    co, edges = mesh_arrays(me)
    sw = np.clip(group_weights(body, me, "ball_l") + group_weights(body, me, "ball_r"), 0, 1)
    seam = np.zeros(len(co))
    seam[n_before:] = 1.0
    seam = np.clip(smooth_field(seam, edges, 3) * 3.0, 0, 1)
    co = laplace(co, edges, seam * 0.8, 6)
    co = taubin(co, edges, smooth_field(sw, edges, 2), 12)
    # Spikes and pinches left where the cut ran through a fold: smooth only vertices that
    # stand far off their neighbours' average (relative to the local edge length).
    feet = np.clip(smooth_field(np.clip(sw + group_weights(body, me, "foot_l") + group_weights(body, me, "foot_r"), 0, 1), edges, 2) * 2, 0, 1)
    elen = np.linalg.norm(co[edges[:, 0]] - co[edges[:, 1]], axis=1)
    avg = np.zeros(len(co))
    cnt = np.zeros(len(co))
    np.add.at(avg, edges[:, 0], elen)
    np.add.at(avg, edges[:, 1], elen)
    np.add.at(cnt, edges[:, 0], 1)
    np.add.at(cnt, edges[:, 1], 1)
    avg /= np.maximum(cnt, 1)
    for _ in range(12):
        off = np.linalg.norm(neighbour_mean(co, edges, len(co)) - co, axis=1) / np.maximum(avg, 1e-6)
        spike = np.clip((off - 0.25) * 4, 0, 1) * feet
        spike = np.clip(smooth_field(spike, edges, 1) * 2, 0, 1)
        co = laplace(co, edges, spike, 2)
    me.vertices.foreach_set("co", co.ravel())
    me.update()


def suit_up(body, rig, marks):
    me = body.data
    co, edges = mesh_arrays(me)
    n = len(co)
    w = lambda g: group_weights(body, me, g)  # noqa: E731

    navel = np.zeros(n, dtype=bool)
    me.attributes["navel"].data.foreach_get("value", navel)
    me.attributes.remove(me.attributes["navel"])

    # Toes into one toe box: everything the toe bone moves, feathered.
    # (The toes are rebuilt as a sock toe box in toe_boxes(), before this.)

    # Ears folded flat under the mask; lips, nipples, navel and genitals softened.
    ears = smooth_field(w("ears"), edges, 3)
    co = laplace(co, edges, np.clip(ears * 1.3, 0, 1), 12)
    soft = np.clip(w("nipple") + w("lips") * 0.7 + w("genitals") + navel * 1.0 + w("fingernails") * 0.6, 0, 1)
    co = taubin(co, edges, smooth_field(soft, edges, 3), 12)

    # Eye sockets closed into smooth lids under the lenses.
    for key in ("joint-l-eye", "joint-r-eye"):
        c = marks[key]
        d = np.linalg.norm(co - c, axis=1)
        s = np.clip((0.03 - d) / 0.012, 0, 1)
        co = laplace(co, edges, s, 40)
    co = taubin(co, edges, np.full(n, 0.25), 2)

    me.vertices.foreach_set("co", co.ravel())
    me.update()


# ---------------------------------------------------------------------------------------
# 5: the web pattern
#
# Each face belongs to one "cell" of the web: the mask (radiating from between the eyes),
# the chest and the back (radiating from a centre), or a limb (lines running along the
# limb, rings around it). Per face corner we store, for that cell:
#   web_p = (cos θ, sin θ, d)      θ: angle of the radial lines, d: radius / distance along limb
#   web_q = (ρ, N, S)              ρ: metres per radian of θ here, N: radial lines, S: ring spacing
#   web_r = (A, B, kind)           ring sag: rings at (d + A·f) / (S·(1 − B·f)) = k
# Corners (not points) so the cells meet on clean face edges without blending.

CELLS = {
    # name: (N radials, ring spacing m, A, B)
    "mask": (14, 0.026, 0.0, 0.16),
    "chest": (18, 0.05, 0.0, 0.12),
    "back": (18, 0.055, 0.0, 0.12),
    "arm_l": (10, 0.05, 0.016, 0.0),
    "arm_r": (10, 0.05, 0.016, 0.0),
    "leg_l": (12, 0.06, 0.02, 0.0),
    "leg_r": (12, 0.06, 0.02, 0.0),
}
CELL_IDS = {name: i for i, name in enumerate(CELLS)}

BONE_CELL = {
    "head": "mask",
    "neck_01": "mask",
    "pelvis": "torso",
    "spine_01": "torso",
    "spine_02": "torso",
    "spine_03": "torso",
    "clavicle_l": "torso",
    "clavicle_r": "torso",
}


def bone_cell(name):
    if name in BONE_CELL:
        return BONE_CELL[name]
    side = name[-1]
    if name.startswith(("thigh", "calf", "foot", "ball")):
        return "leg_" + side
    if name.endswith(("_l", "_r")):
        return "arm_" + side
    return None


def surface_point(bvh, origin, direction):
    hit, *_ = bvh.ray_cast(Vector(origin) - Vector(direction) * 0.5, Vector(direction))
    return np.array(hit)


def angle_jacobian(co, faces, cos_sin):
    """Metres per radian of the angle field, per vertex (1 / |∇θ| over the faces)."""
    n = len(co)
    acc = np.zeros(n)
    cnt = np.zeros(n)
    theta = np.arctan2(cos_sin[:, 1], cos_sin[:, 0])
    for f in faces:
        for k in range(1, len(f) - 1):
            i, j, l = f[0], f[k], f[k + 1]
            p0, p1, p2 = co[i], co[j], co[l]
            t0 = theta[i]
            t1 = t0 + math.remainder(theta[j] - t0, 2 * math.pi)
            t2 = t0 + math.remainder(theta[l] - t0, 2 * math.pi)
            e1, e2 = p1 - p0, p2 - p0
            nrm = np.cross(e1, e2)
            a2 = np.dot(nrm, nrm)
            if a2 < 1e-16:
                continue
            g = (np.cross(nrm, e2) * (t1 - t0) + np.cross(e1, nrm) * (t2 - t0)) / a2
            gl = np.linalg.norm(g)
            for v in (i, j, l):
                acc[v] += gl
                cnt[v] += 1
    grad = acc / np.maximum(cnt, 1)
    return 1.0 / np.maximum(grad, 1e-3)


def web_fields(body, rig, marks):
    me = body.data
    co, edges = mesh_arrays(me)
    n = len(co)
    faces = [tuple(p.vertices) for p in me.polygons]

    bm = bmesh.new()
    bm.from_mesh(me)
    bvh = BVHTree.FromBMesh(bm)
    bm.free()

    # Cell of each vertex: the dominant bone's cell, smoothed, then torso split front/back.
    names = list(CELLS) + ["torso"]
    aff = np.zeros((n, len(names)))
    group_cell = {}
    for vg in body.vertex_groups:
        c = bone_cell(vg.name)
        if c is not None:
            group_cell[vg.index] = names.index(c)
    for v in me.vertices:
        for g in v.groups:
            if g.group in group_cell:
                aff[v.index, group_cell[g.group]] += g.weight
    aff = smooth_field(aff, edges, 6)
    label = np.array(names)[aff.argmax(axis=1)]
    bones = {b.name: b for b in rig.data.bones}
    spine_y = bones["spine_03"].head_local.y
    torso = label == "torso"
    label[torso & (co[:, 1] <= spine_y - 0.005)] = "chest"
    label[torso & (co[:, 1] > spine_y - 0.005)] = "back"

    # Face cells by majority vote of their corners.
    face_cell = []
    for f in faces:
        votes = {}
        for v in f:
            votes[label[v]] = votes.get(label[v], 0) + 1
        face_cell.append(max(votes.items(), key=lambda kv: (kv[1], -CELL_IDS[kv[0]]))[0])

    fields = {}

    # Radial cells. Mask: centre between the eyes, angles in the face's front plane.
    eye_mid = (marks["joint-l-eye"] + marks["joint-r-eye"]) / 2
    o_mask = surface_point(bvh, eye_mid + np.array([0, -0.2, 0.004]), (0, 1, 0))
    chest_z = bones["spine_03"].head_local.z + 0.6 * (bones["neck_01"].head_local.z - bones["spine_03"].head_local.z)
    o_chest = surface_point(bvh, (0, -0.5, chest_z), (0, 1, 0))
    back_z = bones["spine_03"].head_local.z + 0.35 * (bones["neck_01"].head_local.z - bones["spine_03"].head_local.z)
    o_back = surface_point(bvh, (0, 0.5, back_z), (0, -1, 0))
    for name, origin, flip in (("mask", o_mask, 1.0), ("chest", o_chest, 1.0), ("back", o_back, -1.0)):
        d = geodesic_from_point(co, edges, origin, 0.012)
        rel = co - origin
        # Angle in the front (x, z) plane, seen from the cell's side; 0 = up.
        cs = np.stack([rel[:, 2], flip * rel[:, 0]], axis=1)
        cs /= np.maximum(np.linalg.norm(cs, axis=1, keepdims=True), 1e-9)
        rho = angle_jacobian(co, faces, cs)
        fields[name] = (cs, d, rho)

    # Limb cells: cylindrical coordinates around the bone chain, blended by skin weights.
    chains = {
        "arm_l": ["upperarm_l", "lowerarm_l", "hand_l"],
        "arm_r": ["upperarm_r", "lowerarm_r", "hand_r"],
        "leg_l": ["thigh_l", "calf_l", "foot_l"],
        "leg_r": ["thigh_r", "calf_r", "foot_r"],
    }
    for name, chain in chains.items():
        segs = []
        s0 = 0.0
        for bn in chain:
            b = bones[bn]
            h, t = np.array(b.head_local), np.array(b.tail_local)
            if bn.startswith("foot"):
                # Continue the shin's axis through the foot, so the rings wrap the ankle.
                prev = segs[-1]
                t = h + prev[1] * 0.12
            if bn.startswith("hand"):
                mid = np.array(bones["middle_01" + bn[-2:]].head_local)
                t = h + (mid - h) / np.linalg.norm(mid - h) * 0.2
            axis = (t - h) / np.linalg.norm(t - h)
            segs.append((h, axis, s0))
            s0 += np.linalg.norm(t - h) if not bn.startswith(("hand", "foot")) else 0.0
        front = np.array([0.0, -1.0, 0.0])
        # Per-vertex weights over the chain's segments (hand/finger bones count as the hand).
        wseg = np.zeros((n, len(chain)))
        for k, bn in enumerate(chain):
            wseg[:, k] = group_weights(body, me, bn)
            if bn.startswith("hand"):
                for vg in body.vertex_groups:
                    if vg.name.endswith(bn[-2:]) and vg.name.split("_")[0] in ("thumb", "index", "middle", "ring", "pinky"):
                        wseg[:, k] += group_weights(body, me, vg.name)
            if bn.startswith("foot"):
                wseg[:, k] += group_weights(body, me, "ball" + bn[-2:])
        wseg = smooth_field(wseg, edges, 4) + 1e-6
        wseg /= wseg.sum(axis=1, keepdims=True)
        s = np.zeros(n)
        cvec = np.zeros((n, 2))
        rad = np.zeros(n)
        for k, (h, axis, sk) in enumerate(segs):
            rel = co - h
            along = rel @ axis
            perp = rel - along[:, None] * axis
            ref = front - (front @ axis) * axis
            ref /= np.linalg.norm(ref)
            ref2 = np.cross(axis, ref)
            c2 = np.stack([perp @ ref, perp @ ref2], axis=1)
            r = np.linalg.norm(c2, axis=1)
            c2 /= np.maximum(r, 1e-9)[:, None]
            s += wseg[:, k] * (sk + along)
            cvec += wseg[:, k, None] * c2
            rad += wseg[:, k] * r
        cvec /= np.maximum(np.linalg.norm(cvec, axis=1, keepdims=True), 1e-9)
        rho = angle_jacobian(co, faces, cvec)
        fields[name] = (cvec, s, rho)

    # Write the corner attributes.
    loops_v = np.empty(len(me.loops), dtype=np.int64)
    me.loops.foreach_get("vertex_index", loops_v)
    loop_face = np.empty(len(me.loops), dtype=np.int64)
    for p in me.polygons:
        loop_face[p.loop_start : p.loop_start + p.loop_total] = p.index
    P = np.zeros((len(loops_v), 3))
    Q = np.zeros((len(loops_v), 3))
    R = np.zeros((len(loops_v), 3))
    face_cell = np.array(face_cell)
    for name, (cs, d, rho) in fields.items():
        N, S, A, B = CELLS[name]
        sel = face_cell[loop_face] == name
        v = loops_v[sel]
        P[sel] = np.stack([cs[v, 0], cs[v, 1], d[v]], axis=1)
        Q[sel] = np.stack([rho[v], np.full(len(v), N), np.full(len(v), S)], axis=1)
        R[sel] = np.stack([np.full(len(v), A), np.full(len(v), B), np.full(len(v), CELL_IDS[name])], axis=1)
    for name, arr in (("web_p", P), ("web_q", Q), ("web_r", R)):
        if name in me.attributes:
            me.attributes.remove(me.attributes[name])
        me.attributes.new(name, "FLOAT_VECTOR", "CORNER").data.foreach_set("vector", arr.ravel().astype(np.float32))
    # Rest positions too, for anything else that wants body-locked coordinates.
    if "rest" in me.attributes:
        me.attributes.remove(me.attributes["rest"])
    me.attributes.new("rest", "FLOAT_VECTOR", "POINT").data.foreach_set("vector", co.ravel().astype(np.float32))
    counts = {k: int((face_cell == k).sum()) for k in CELLS}
    print("[build] web cells (faces):", counts)
    return {"o_mask": o_mask, "o_chest": o_chest, "o_back": o_back}


# ---------------------------------------------------------------------------------------
# 6: lenses


def bezier(p0, p1, p2, p3, t):
    u = 1 - t
    return tuple(u**3 * a + 3 * u * u * t * b + 3 * u * t * t * c + t**3 * d for a, b, c, d in zip(p0, p1, p2, p3))


def lens_outline(samples=24):
    pts = []
    for seg in LENS_PATH:
        for k in range(samples):
            pts.append(bezier(*seg, k / samples))
    return pts


def offset_outline(pts, dist):
    """Offsets a closed outline outward (dist > 0) along smoothed vertex normals."""
    n = len(pts)
    arr = np.array(pts, dtype=float)
    # The path runs clockwise on screen (SVG y points down), so (t.y, -t.x) points outward.
    out = []
    for i in range(n):
        a, b = arr[i - 1], arr[(i + 1) % n]
        t = b - a
        t /= np.linalg.norm(t)
        nrm = np.array([t[1], -t[0]])
        out.append(arr[i] + nrm * dist)
    res = np.array(out)
    # Relax a little so the tip doesn't spike.
    for _ in range(3):
        res = 0.5 * res + 0.25 * (np.roll(res, 1, axis=0) + np.roll(res, -1, axis=0))
    return [tuple(p) for p in res]


def lens_mesh(outline, grid=1.6):
    """A 2-D triangulated disc inside `outline` (sticker units)."""
    from mathutils.geometry import delaunay_2d_cdt

    xs = [p[0] for p in outline]
    ys = [p[1] for p in outline]
    verts = [Vector(p) for p in outline]
    nb = len(verts)
    edges = [(i, (i + 1) % nb) for i in range(nb)]
    poly = np.array(outline)

    def inside(x, y):
        c = False
        for i in range(nb):
            x1, y1 = poly[i]
            x2, y2 = poly[(i + 1) % nb]
            if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1 + 1e-12) + x1:
                c = not c
        return c

    y = min(ys) + grid / 2
    while y < max(ys):
        x = min(xs) + grid / 2
        while x < max(xs):
            if inside(x, y):
                dmin = min(math.hypot(x - px, y - py) for px, py in outline)
                if dmin > grid * 0.5:
                    verts.append(Vector((x, y)))
            x += grid
        y += grid
    out = delaunay_2d_cdt(verts, edges, [list(range(nb))], 1, 1e-6)  # 1: triangles inside the outline
    return [tuple(v) for v in out[0]], out[2]


def smooth_surface_bvh(body):
    """BVH of the body as the renderer sees it (two subdivision levels), so the lenses
    clear the smoothed surface rather than the cage."""
    tmp = body.copy()
    tmp.data = body.data.copy()
    bpy.context.collection.objects.link(tmp)
    for m in list(tmp.modifiers):
        tmp.modifiers.remove(m)
    sub = tmp.modifiers.new("s", "SUBSURF")
    sub.levels = 2
    dg = bpy.context.evaluated_depsgraph_get()
    ev = tmp.evaluated_get(dg)
    me = ev.to_mesh()
    bm = bmesh.new()
    bm.from_mesh(me)
    bvh = BVHTree.FromBMesh(bm)
    bm.free()
    ev.to_mesh_clear()
    data = tmp.data
    bpy.data.objects.remove(tmp, do_unlink=True)
    bpy.data.meshes.remove(data)
    return bvh


def add_lenses(body, rig, marks, mask_origin):
    """White lenses with thick black rims, wrapped onto the mask and skinned to the head.
    Each lens is a smooth shell: its distance from the skull centre is relaxed over the
    lens, but never closer than `lift` above the (subdivided) skin."""
    bvh = smooth_surface_bvh(body)

    head_c = (marks["joint-head"] + marks["joint-head-2"]) / 2
    centre = np.array([0.0, head_c[1] + 0.01, mask_origin[2]])  # inside the skull, at eye level
    radius = np.linalg.norm(mask_origin - centre)

    outline = lens_outline()
    parts = {
        "rim": (offset_outline(outline, LENS_RIM_OUT), 0.0030),
        "lens": (offset_outline(outline, -LENS_RIM_IN), 0.0042),
    }
    lens_objs = []
    for side in (-1, 1):  # -1: hero's right eye (the sticker's left), +1: mirrored
        rim_bvh = None
        for part, (shape, lift) in parts.items():
            verts2, faces2 = lens_mesh(shape)
            dirs, dist = [], []
            for x, y in verts2:
                # Sticker → face: x from the centre line, y up from the web centre.
                fx = (x - 60) * LENS_UNIT * (-side)
                fy = -(y - 49) * LENS_UNIT
                # Wrap onto a sphere around the skull centre, then onto the real surface.
                lon, lat = fx / radius, fy / radius
                d = np.array([math.sin(lon) * math.cos(lat), -math.cos(lon) * math.cos(lat), math.sin(lat)])
                hit, nrm, _i, dd = bvh.ray_cast(Vector(centre), Vector(d))
                floor_d = (dd if hit is not None else radius) + lift
                if rim_bvh is not None:
                    # The lens always sits just proud of its own rim shell.
                    rh, _n, _j, rd = rim_bvh.ray_cast(Vector(centre), Vector(d))
                    if rh is not None:
                        floor_d = max(floor_d, rd + 0.0011)
                dirs.append(d)
                dist.append(floor_d)
            dirs = np.array(dirs)
            floor = np.array(dist)
            r = floor.copy()
            tri = np.array(faces2)
            edges = np.concatenate([tri[:, [0, 1]], tri[:, [1, 2]], tri[:, [2, 0]]])
            for _ in range(60):
                r = np.maximum(floor, 0.5 * r + 0.5 * neighbour_mean(r[:, None], edges, len(r))[:, 0])
            pos = centre + dirs * r[:, None]
            if part == "rim":
                rim_bvh = BVHTree.FromPolygons([tuple(p) for p in pos], [tuple(f) for f in faces2])
            lm = bpy.data.meshes.new(f"lens_{part}")
            lm.from_pydata([tuple(p) for p in pos], [], [tuple(f) for f in faces2])
            lm.update()
            for p in lm.polygons:
                if Vector(p.normal).dot(Vector(p.center) - Vector(centre)) < 0:
                    p.flip()
            lm.update()
            ob = bpy.data.objects.new(f"lens_{part}", lm)
            bpy.context.collection.objects.link(ob)
            lens_objs.append((ob, part))

    # Materials by slot name; render.py swaps in the comic shaders.
    for ob, part in lens_objs:
        name = "Lens" if part == "lens" else "LensRim"
        mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
        ob.data.materials.append(mat)
        vg = ob.vertex_groups.new(name="head")
        vg.add(list(range(len(ob.data.vertices))), 1.0, "REPLACE")

    # Join into the body so it's one skinned mesh.
    bpy.ops.object.select_all(action="DESELECT")
    for ob, _ in lens_objs:
        ob.select_set(True)
    body.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.join()


def main():
    clear_scene()
    body, rig, marks = make_human()
    # MakeHuman's materials are irrelevant under a suit.
    body.data.materials.clear()
    body.data.materials.append(bpy.data.materials.new("Suit"))
    toe_boxes(body, rig)
    suit_up(body, rig, marks)
    origins = web_fields(body, rig, marks)
    add_lenses(body, rig, marks, origins["o_mask"])
    for k, v in origins.items():
        body[k] = [float(x) for x in v]
    for k, v in marks.items():
        body[k] = [float(x) for x in v]

    dims = body.dimensions
    print(f"[build] body {len(body.data.vertices)} verts, {len(body.data.polygons)} faces, {dims.z:.3f} m tall")
    path = os.path.join(OUT, "hero-base.blend")
    bpy.ops.wm.save_as_mainfile(filepath=path, compress=True)
    if os.path.exists(path + "1"):
        os.remove(path + "1")  # Blender's backup copy


main()
