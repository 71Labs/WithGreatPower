"""
Builds the rest of the cast as real human bodies, the same way as the hero (build.py): an
MPFB (MakeHuman, CC0) body per character on the same 53-bone "game_engine" skeleton, dressed
and exported for the game as apps/wgp/public/models/cast-<id>.glb and cast-<id>-lo.glb.

    blender -b -P launch/brand/hero/build_cast.py -- --who mary-jpeg [--preview out.png] [--no-export] [--blend]

Nothing is downloaded and nothing is hand-edited: every body, garment, hair volume, prop and
head piece comes from the data table in cast.py and the helpers here. Steps per character:
  1. The body: MakeHuman macros (sex, age, weight, muscle, height, proportions) and detail
     targets, the game_engine rig fitted to it with MakeHuman's own weights, helpers dropped.
  2. Clothed: navel, nipples and the like smoothed away, the toes rebuilt as a shoe's toe box
     (build.toe_boxes), the eyes closed into smooth lids for the painted comic face.
  3. Painted: colour zones by body region, cut along planes (a sleeve's end across the arm,
     the waistline, a neckline), so every seam is a clean line, not a staircase of quads.
  4. Dressed: extra meshes where the silhouette needs them (a skirt or coat flare, a hood,
     hair volumes, a bun, pixel hair), skinned to the nearest body vertices or a bone, and
     rigid props on bones (glasses, a cigar, pearls, a tie). Non-human heads (a bear, a
     burger, a goblin) are sculpted pieces on the head bone; the human head under them goes.
  5. Decimated to the game's budget with the zone seams locked (their vertices may not
     collapse), so the seams stay exact, then the props are joined.
  6. Exported with what the game's cel shader reads (cast-shaders.ts):
       _pal   palette index per face corner (colours, flat and gloss flags are in the extras)
       _face  the face's sticker coordinates per vertex: cm from between the eyes, and a mask
              (1 where painted features may land); the features themselves are decals the
              shader draws, listed in the extras
       _ao    per-vertex ambient occlusion against the same limb (export.bake_ao)
     and, for Gwei's web mask, build.py's web coordinates (_web_p/q/r) and lens shells.
     The node extras ("wgp") carry the palette, the decals and any sockets (Doc's chains).
"""

import json
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import build as B  # noqa: E402
import export as EX  # noqa: E402

MODELS = os.path.abspath(os.path.join(HERE, "..", "..", "..", "apps", "wgp", "public", "models"))
OUT = os.path.join(HERE, "build")

# Game units per metre: the hero is 88 units for his 1.886 m (hero-asset.ts heroScale).
K_GAME = 88 / 1.886

SEGMENTS = {
    "head": "head",
    "neck_01": "neck",
    "pelvis": "torso",
    "spine_01": "torso",
    "spine_02": "torso",
    "spine_03": "torso",
    "clavicle_l": "torso",
    "clavicle_r": "torso",
    "Root": "torso",
}
REGIONS = {
    "arm_l": {"uarm_l", "farm_l", "hand_l"},
    "arm_r": {"uarm_r", "farm_r", "hand_r"},
    "leg_l": {"thigh_l", "shin_l", "foot_l"},
    "leg_r": {"thigh_r", "shin_r", "foot_r"},
}
REGIONS["arms"] = REGIONS["arm_l"] | REGIONS["arm_r"]
REGIONS["legs"] = REGIONS["leg_l"] | REGIONS["leg_r"]
REGIONS["hands"] = {"hand_l", "hand_r"}
REGIONS["feet"] = {"foot_l", "foot_r"}
REGIONS["torso"] = {"torso"}
REGIONS["neck"] = {"neck"}
REGIONS["head"] = {"head"}
REGIONS["all"] = {"head", "neck", "torso"} | REGIONS["arms"] | REGIONS["legs"]


def segment_of(bone):
    if bone in SEGMENTS:
        return SEGMENTS[bone]
    side = bone[-1]
    base = bone.split("_")[0]
    if base in ("hand", "thumb", "index", "middle", "ring", "pinky"):
        return "hand_" + side
    return {"upperarm": "uarm_", "lowerarm": "farm_", "thigh": "thigh_", "calf": "shin_", "foot": "foot_", "ball": "foot_"}.get(base, "torso") + (side if base in ("upperarm", "lowerarm", "thigh", "calf", "foot", "ball") else "")


def regions(spec):
    out = set()
    for part in spec.split("+"):
        out |= REGIONS[part]
    return out


def args():
    a = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    o = {"who": None, "preview": None, "export": True, "blend": False, "out": MODELS}
    i = 0
    while i < len(a):
        if a[i] == "--who":
            o["who"] = a[i + 1]
            i += 1
        elif a[i] == "--preview":
            o["preview"] = os.path.abspath(a[i + 1])
            i += 1
        elif a[i] == "--no-export":
            o["export"] = False
        elif a[i] == "--blend":
            o["blend"] = True
        elif a[i] == "--out":
            o["out"] = os.path.abspath(a[i + 1])
            i += 1
        i += 1
    return o


def hexrgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i : i + 2], 16) / 255 for i in (0, 2, 4))


def tri_count(me):
    return sum(len(p.vertices) - 2 for p in me.polygons)


# ---------------------------------------------------------------------------------------
# The kit: one character under construction


class Kit:
    """Everything a character's build function needs: landmarks, painting, accessories."""

    def __init__(self, who, spec):
        self.who = who
        self.spec = spec
        self.palette = list(spec["palette"].items())  # [(name, hex)], [0] is ink
        self.pal_index = {n: i for i, (n, _h) in enumerate(self.palette)}
        self.flat = set(spec.get("flat", []))
        self.gloss = set(spec.get("gloss", []))
        self.decals = []
        self.sockets = {}
        self.parts = []  # accessory objects, joined after the body is decimated
        self.lenses = False
        # Civilians (civilians.py): a phone in the hand, the fingers folded into the hands, and
        # the face's coordinates scaled onto their shared layout.
        self.phone = False
        self.fold_fingers = False
        self.face_sx = self.face_sy_up = self.face_sy_down = 1.0

    # -- the body ------------------------------------------------------------------

    def make_body(self):
        B.clear_scene()
        B.MACROS.clear()
        B.MACROS.update({"proportions": 0.5, "cupsize": 0.5, "firmness": 0.5, "race": {"asian": 0.3, "caucasian": 0.4, "african": 0.3}})
        B.MACROS.update(self.spec["macros"])
        B.DETAILS.clear()
        B.DETAILS.update(self.spec.get("details", {}))
        body, rig, marks = B.make_human()
        self.body, self.rig, self.marks = body, rig, marks
        body.name = body.data.name = "CastBody"
        rig.name = rig.data.name = "NodeRig"  # the same skeleton name as the hero's
        for pb in rig.pose.bones:
            pb.matrix_basis.identity()
        self.bones = {b.name: b for b in rig.data.bones}
        me = body.data
        me.materials.clear()
        for name, _h in self.palette:
            me.materials.append(bpy.data.materials.get("pal_" + name) or bpy.data.materials.new("pal_" + name))
        for p in me.polygons:
            p.material_index = self.pal("skin") if "skin" in self.pal_index else 1
        self._landmarks()

    def pal(self, name):
        return self.pal_index[name]

    def J(self, bone):
        return Vector(self.bones[bone].head_local)

    def T(self, bone):
        return Vector(self.bones[bone].tail_local)

    def _landmarks(self):
        me = self.body.data
        co, _e = B.mesh_arrays(me)
        self.co0 = co
        headw = B.group_weights(self.body, me, "head")
        self.headw = headw
        m = self.marks
        self.eye_l = Vector(m["joint-l-eye"])
        self.eye_r = Vector(m["joint-r-eye"])
        eye_mid = (self.eye_l + self.eye_r) / 2
        bvh = self.bvh()
        hit, *_ = bvh.ray_cast(eye_mid + Vector((0, -0.3, 0)), Vector((0, 1, 0)))
        self.face_c = Vector(hit) if hit is not None else eye_mid + Vector((0, -0.04, 0))
        self.head_c = (Vector(m["joint-head"]) + Vector(m["joint-head-2"])) / 2
        hv = co[headw > 0.6]
        self.head_top = float(hv[:, 2].max())
        self.head_back = float(hv[:, 1].max())
        self.head_halfw = float(np.abs(hv[:, 0]).max())
        front = hv[hv[:, 1] < self.head_c.y - 0.03]
        self.chin_z = float(front[:, 2].min())
        lips = B.group_weights(self.body, me, "lips")
        self.mouth = Vector(co[lips > 0.5].mean(axis=0)) if (lips > 0.5).any() else self.face_c + Vector((0, 0, -0.06))
        nb = self.J("neck_01")
        hit, *_ = bvh.ray_cast(Vector((0, -0.4, nb.z + 0.01)), Vector((0, 1, 0)))
        self.neck_front = Vector(hit)
        hit, *_ = bvh.ray_cast(Vector((0, 0.4, nb.z + 0.02)), Vector((0, -1, 0)))
        self.neck_back = Vector(hit)
        self.height = float(co[:, 2].max())
        print(f"[cast] {self.who}: {self.height:.3f} m, face at {tuple(round(x, 3) for x in self.face_c)}, mouth z {self.mouth.z:.3f}, chin z {self.chin_z:.3f}")

    def bvh_regions(self, spec):
        """A BVH of the body's faces in the given regions only (say, the trunk and legs
        without the arms hanging beside them)."""
        self.open_paint()
        want = regions(spec)
        faces = [f for f in self.bm.faces if self.face_segment(f) in want]
        verts = [v.co.copy() for v in self.bm.verts]
        polys = [tuple(v.index for v in f.verts) for f in faces]
        self.bm.free()
        self.bm = None
        return BVHTree.FromPolygons(verts, polys)

    def bvh(self, ob=None):
        ob = ob or self.body
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        t = BVHTree.FromBMesh(bm)
        bm.free()
        return t

    def clothe(self, eyes=True, ears=0.5, shoes=True, mask=False):
        """Smooth what clothes (or a painted comic face) would hide; `mask`: the eyes and brows
        smoothed into a featureless mask (the hero's suit_up), for a face that's all decal."""
        body = self.body
        if shoes:
            B.toe_boxes(body, self.rig)
        me = body.data
        co, edges = B.mesh_arrays(me)
        n = len(co)
        w = lambda g: B.group_weights(body, me, g)  # noqa: E731
        navel = np.zeros(n, dtype=bool)
        if "navel" in me.attributes:
            me.attributes["navel"].data.foreach_get("value", navel)
            me.attributes.remove(me.attributes["navel"])
        soft = np.clip(w("nipple") * 1.2 + w("genitals") + navel * 1.0 + w("fingernails") * 0.6 + w("lips") * 0.45, 0, 1)
        co = B.taubin(co, edges, B.smooth_field(soft, edges, 3), 14)
        if ears > 0:
            co = B.laplace(co, edges, np.clip(B.smooth_field(w("ears"), edges, 2) * ears, 0, 1), 6)
        if mask:
            for c in (self.eye_l, self.eye_r):
                d = np.linalg.norm(co - np.array(c), axis=1)
                co = B.laplace(co, edges, np.clip((0.034 - d) / 0.012, 0, 1), 40)
            co = B.taubin(co, edges, np.full(n, 0.25), 2)
        elif eyes:
            # Smooth lids over the eyes (the painted eyes sit on them), never sunk behind the
            # face they smooth.
            for c in (self.eye_l, self.eye_r):
                # A membrane across the eye opening, anchored on the lids round it, bulged
                # forward a little like a closed eye.
                d = np.linalg.norm(co - np.array(c), axis=1)
                s = np.clip((0.02 - d) / 0.004, 0, 1)
                co = B.laplace(co, edges, s, 60)
                bulge = np.clip(1 - (d / 0.018) ** 2, 0, 1) * 0.0035
                co[:, 1] -= bulge * s
        me.vertices.foreach_set("co", co.ravel())
        me.update()
        self.co0, _ = B.mesh_arrays(me)

    # -- regions and painting ------------------------------------------------------

    def open_paint(self):
        self.bm = bmesh.new()
        self.bm.from_mesh(self.body.data)
        self.dl = self.bm.verts.layers.deform.active
        self.seg_of_group = {vg.index: segment_of(vg.name) for vg in self.body.vertex_groups if vg.name in self.bones}

    def close_paint(self):
        self.bm.to_mesh(self.body.data)
        self.bm.free()
        self.bm = None
        self.body.data.update()

    def face_segment(self, f):
        acc = {}
        for v in f.verts:
            for g, wt in v[self.dl].items():
                s = self.seg_of_group.get(g)
                if s:
                    acc[s] = acc.get(s, 0.0) + wt
        return max(acc.items(), key=lambda kv: kv[1])[0] if acc else "torso"

    def faces_in(self, spec):
        want = regions(spec)
        return [f for f in self.bm.faces if self.face_segment(f) in want]

    def paint(self, name, where="all", planes=(), pred=None, cut=True):
        """Paint the faces of the regions in `where` that lie on the kept side of every plane
        ((point, normal): kept where (p − point)·normal ≥ 0), after cutting them along it."""
        idx = self.pal(name)
        faces = self.faces_in(where)
        if cut:
            for co, no in planes:
                fs = [f for f in faces if f.is_valid]
                if not fs:
                    break
                geom = set(fs)
                for f in fs:
                    geom.update(f.edges)
                    geom.update(f.verts)
                bmesh.ops.bisect_plane(self.bm, geom=list(geom), dist=1e-6, plane_co=co, plane_no=no)
                faces = self.faces_in(where)
        n = 0
        for f in faces:
            c = f.calc_center_median()
            if all((c - co).dot(no) >= 0 for co, no in planes) and (pred is None or pred(c, f)):
                f.material_index = idx
                n += 1
        return n

    def fill(self, name):
        idx = self.pal(name)
        for f in self.bm.faces:
            f.material_index = idx

    # Planes. Each returns (point, normal); `flip` takes the other side.

    def limb_point(self, chain, t):
        """A point and direction along a limb chain at t (0 = first joint, 1 = second, …)."""
        pts = [self.J(b) for b in chain[:-1]] + [self.J(chain[-1]) if chain[-1] in self.bones else self.T(chain[-2])]
        i = min(int(t), len(pts) - 2)
        u = t - i
        a, b = pts[i], pts[i + 1]
        return a.lerp(b, u), (b - a).normalized()

    def arm(self, side, t, flip=False):
        """Across the arm: t 0 shoulder, 1 elbow, 2 wrist, 3 knuckles; kept toward the hand."""
        p, d = self.limb_point(["upperarm_" + side, "lowerarm_" + side, "hand_" + side, "middle_01_" + side], t)
        return (p, -d if flip else d)

    def leg(self, side, t, flip=False):
        """Across the leg: t 0 hip, 1 knee, 2 ankle, 3 ball; kept toward the foot."""
        p, d = self.limb_point(["thigh_" + side, "calf_" + side, "foot_" + side, "ball_" + side], t)
        return (p, -d if flip else d)

    @staticmethod
    def above(z, tilt=0.0):
        """Kept above height z (tilt > 0 drops the plane toward the front)."""
        return (Vector((0, 0, z)), Vector((0, tilt, 1)).normalized())

    @staticmethod
    def below(z, tilt=0.0):
        return (Vector((0, 0, z)), -Vector((0, tilt, 1)).normalized())

    @staticmethod
    def plane(point, normal):
        return (Vector(point), Vector(normal).normalized())

    def neckline(self, drop=0.03, back=0.0, keep="below"):
        """A round neckline through the throat (dropped by `drop`) and the nape."""
        f = self.neck_front + Vector((0, 0, -drop))
        k = self.neck_back + Vector((0, 0, -back))
        along = (k - f).normalized()
        n = along.cross(Vector((1, 0, 0))).normalized()
        if n.z > 0:
            n = -n
        return (f, n if keep == "below" else -n)

    def vneck(self, depth, width, keep="out"):
        """Two planes of a V opening at the front: from either side of the neck down to a point
        `depth` below the throat. keep="in" selects inside the V (needs both), "out" the rest."""
        bottom = self.neck_front + Vector((0, -0.01, -depth))
        out = []
        for s in (1, -1):
            top = self.neck_front + Vector((s * width, 0.03, 0.02))
            along = (top - bottom).normalized()
            n = along.cross(Vector((0, 1, 0))).normalized()
            # Pointing into the V (toward the centre line).
            if n.x * s > 0:
                n = -n
            out.append((bottom, n if keep == "in" else -n))
        return out

    def front(self, y_off=0.0):
        """Kept in front of the coronal plane through the spine (plus y_off)."""
        return (Vector((0, self.J("spine_03").y + y_off, 0)), Vector((0, -1, 0)))

    # -- accessories ---------------------------------------------------------------

    def part(self, name, bm, pal, bone=None, weights=None, flat_shade=False, lod="both"):
        """Add an accessory mesh (in the rest pose, metres) painted `pal`, skinned rigidly to
        `bone`, or by `weights` (vertex index → {bone: w}), or like the nearest body vertex."""
        me = bpy.data.meshes.new(name)
        bm.to_mesh(me)
        bm.free()
        ob = bpy.data.objects.new(name, me)
        bpy.context.collection.objects.link(ob)
        for n, _h in self.palette:
            me.materials.append(bpy.data.materials["pal_" + n])
        idx = self.pal(pal) if isinstance(pal, str) else None
        for p in me.polygons:
            if idx is not None:
                p.material_index = idx
            p.use_smooth = not flat_shade
        if callable(pal):
            for p in me.polygons:
                p.material_index = self.pal(pal(Vector(p.center), Vector(p.normal)))
        if bone:
            vg = ob.vertex_groups.new(name=bone)
            vg.add(list(range(len(me.vertices))), 1.0, "REPLACE")
        elif weights is not None:
            groups = {}
            for i, wd in weights.items():
                for b, w in wd.items():
                    if w <= 1e-4:
                        continue
                    g = groups.get(b) or ob.vertex_groups.new(name=b)
                    groups[b] = g
                    g.add([i], w, "REPLACE")
        else:
            self.skin_like_body(ob)
        ob["lod"] = lod
        self.parts.append(ob)
        return ob

    def body_weights(self):
        """Per body vertex: {bone: weight}, and a KD-tree of rest positions."""
        if getattr(self, "_bw", None) is not None:
            return self._bw
        me = self.body.data
        names = {g.index: g.name for g in self.body.vertex_groups}
        bw = []
        kd = KDTree(len(me.vertices))
        for v in me.vertices:
            kd.insert(v.co, v.index)
            bw.append({names[g.group]: g.weight for g in v.groups if names[g.group] in self.bones and g.weight > 1e-4})
        kd.balance()
        self._bw = (bw, kd)
        return self._bw

    def skin_like_body(self, ob, k=4):
        bw, kd = self.body_weights()
        groups = {}
        for v in ob.data.vertices:
            acc = {}
            tot = 0.0
            for co, i, d in kd.find_n(v.co, k):
                wgt = 1.0 / max(d, 1e-4) ** 2
                tot += wgt
                for b, w in bw[i].items():
                    acc[b] = acc.get(b, 0.0) + w * wgt
            for b, w in acc.items():
                g = groups.get(b) or ob.vertex_groups.new(name=b)
                groups[b] = g
                g.add([v.index], w / tot, "REPLACE")

    def decimate_part(self, ob, target):
        """Thin an accessory to about `target` triangles (its colour seams kept)."""
        if tri_count(ob.data) > target:
            seam_locked_decimate(ob, target, symmetric=False)

    def metaball(self, name, elements, resolution=0.012):
        """A sculpted blob from metaball elements: (kind, centre, size or radius, rotation
        (a Matrix or None)); kinds are BALL and ELLIPSOID, sizes the surface's own (an element
        alone; overlapping ones swell where they blend). Returns a bmesh in body space."""
        grow = 1 / 0.575  # an element's surface sits at 0.575 of its radius (threshold 0.6, stiffness 2)
        mb = bpy.data.metaballs.new(name)
        mb.resolution = resolution
        mb.render_resolution = resolution
        mb.threshold = 0.6
        ob = bpy.data.objects.new(name, mb)
        bpy.context.collection.objects.link(ob)
        for kind, co, size, rot in elements:
            e = mb.elements.new(type=kind)
            e.co = Vector(co)
            if kind == "BALL":
                e.radius = size * grow
            else:
                e.radius = 1.0
                e.size_x, e.size_y, e.size_z = (x * grow for x in size)
            if rot is not None:
                e.rotation = rot.to_quaternion()
        dg = bpy.context.evaluated_depsgraph_get()
        ev = ob.evaluated_get(dg)
        me = bpy.data.meshes.new_from_object(ev)
        bm = bmesh.new()
        bm.from_mesh(me)
        bpy.data.meshes.remove(me)
        bpy.data.objects.remove(ob, do_unlink=True)
        bpy.data.metaballs.remove(mb)
        bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-5)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        return bm

    # bmesh primitives (in the rest pose, metres)

    @staticmethod
    def sphere(center, radii, segs=12, rings=8, rot=None):
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=1.0)
        m = Matrix.Diagonal(Vector(radii)).to_4x4()
        if rot is not None:
            m = rot.to_4x4() @ m
        bmesh.ops.transform(bm, matrix=Matrix.Translation(Vector(center)) @ m, verts=bm.verts)
        return bm

    @staticmethod
    def cylinder(center, radius, depth, axis=(0, 0, 1), segs=10, r2=None, cap=True):
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=cap, cap_tris=False, segments=segs, radius1=radius, radius2=radius if r2 is None else r2, depth=depth)
        rot = Vector((0, 0, 1)).rotation_difference(Vector(axis).normalized()).to_matrix().to_4x4()
        bmesh.ops.transform(bm, matrix=Matrix.Translation(Vector(center)) @ rot, verts=bm.verts)
        return bm

    @staticmethod
    def box(center, size, rot=None, bevel=0.0):
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        if bevel > 0:
            bmesh.ops.bevel(bm, geom=bm.edges[:] + bm.verts[:], offset=bevel, segments=1, affect="EDGES", profile=0.5)
        m = Matrix.Diagonal(Vector(size)).to_4x4()
        if rot is not None:
            m = rot.to_4x4() @ m
        bmesh.ops.transform(bm, matrix=Matrix.Translation(Vector(center)) @ m, verts=bm.verts)
        return bm

    @staticmethod
    def torus(center, major, minor, axis=(0, 0, 1), segs=20, rsegs=6, scale=(1, 1, 1)):
        bm = bmesh.new()
        verts = []
        for i in range(segs):
            a = 2 * math.pi * i / segs
            ring = []
            for j in range(rsegs):
                b = 2 * math.pi * j / rsegs
                r = major + minor * math.cos(b)
                ring.append(bm.verts.new((r * math.cos(a) * scale[0], r * math.sin(a) * scale[1], minor * math.sin(b) * scale[2])))
            verts.append(ring)
        for i in range(segs):
            for j in range(rsegs):
                a, b = verts[i], verts[(i + 1) % segs]
                bm.faces.new((a[j], b[j], b[(j + 1) % rsegs], a[(j + 1) % rsegs]))
        rot = Vector((0, 0, 1)).rotation_difference(Vector(axis).normalized()).to_matrix().to_4x4()
        bmesh.ops.transform(bm, matrix=Matrix.Translation(Vector(center)) @ rot, verts=bm.verts)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        return bm

    @staticmethod
    def tube(points, radii, segs=8, cap=True):
        """A tube along a polyline (closed ends)."""
        bm = bmesh.new()
        rings = []
        n = len(points)
        for i, (p, r) in enumerate(zip(points, radii)):
            p = Vector(p)
            d = (Vector(points[min(i + 1, n - 1)]) - Vector(points[max(i - 1, 0)])).normalized()
            ref = Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((1, 0, 0))
            u = d.cross(ref).normalized()
            v = d.cross(u)
            rings.append([bm.verts.new(p + (u * math.cos(2 * math.pi * k / segs) + v * math.sin(2 * math.pi * k / segs)) * r) for k in range(segs)])
        for a, b in zip(rings[:-1], rings[1:]):
            for k in range(segs):
                bm.faces.new((a[k], a[(k + 1) % segs], b[(k + 1) % segs], b[k]))
        if cap:
            bm.faces.new(list(reversed(rings[0])))
            bm.faces.new(rings[-1])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        return bm

    @staticmethod
    def join_bm(*bms):
        out = bmesh.new()
        for b in bms:
            me = bpy.data.meshes.new("tmp")
            b.to_mesh(me)
            b.free()
            out.from_mesh(me)
            bpy.data.meshes.remove(me)
        return out

    # -- shells over the body (hair, hoods) ----------------------------------------

    def shell(self, name, select, thick, pal, edge=0.002, smooth=6, wall=True, bone=None, inner_pal=None, src=None, taper=0.012, target=800, rim_smooth=12):
        """A volume over the faces of the body (or `src`) that `select(center, face, head)`
        picks (head: the face's mean head-bone weight): the faces copied and pushed out along
        their normals by `thick(point)` metres (tapering to `edge` over `taper` at the rim),
        smoothed, and closed down to the surface with a wall (`inner_pal` colours it)."""
        src = src or self.body
        me = src.data
        bm = bmesh.new()
        bm.from_mesh(me)
        bm.normal_update()
        dl = bm.verts.layers.deform.active
        gi = src.vertex_groups["head"].index if "head" in src.vertex_groups else -1

        def headw(f):
            if dl is None or gi < 0:
                return 0.0
            return sum(v[dl].get(gi, 0.0) for v in f.verts) / len(f.verts)

        keep = [f for f in bm.faces if select(f.calc_center_median(), f, headw(f))]
        if not keep:
            bm.free()
            return None
        sel = set(keep)
        out = bmesh.new()
        vmap = {}
        back = {}
        for f in keep:
            vs = []
            for v in f.verts:
                if v.index not in vmap:
                    nv = out.verts.new(v.co)
                    vmap[v.index] = (nv, v.co.copy(), v.normal.copy())
                    back[nv] = v.index
                vs.append(vmap[v.index][0])
            out.faces.new(vs)
        rim = set()
        for e in bm.edges:
            lf = [f for f in e.link_faces if f in sel]
            if len(lf) == 1:
                rim.update(v.index for v in e.verts)
        bm.free()
        idx = list(vmap)
        pos = np.array([vmap[i][1] for i in idx])
        nrm = np.array([vmap[i][2] for i in idx])
        local = {vi: k for k, vi in enumerate(idx)}
        out.verts.index_update()
        edges = np.array([(local[back[e.verts[0]]], local[back[e.verts[1]]]) for e in out.edges]) if out.edges else np.zeros((0, 2), int)
        # Distance to the rim over the shell, for the taper.
        rim_l = [local[i] for i in rim if i in local]
        dist = B.dijkstra(pos, edges, [(i, 0.0) for i in rim_l]) if rim_l else np.full(len(pos), 1.0)
        t = np.array([thick(Vector(p)) for p in pos])
        tp = np.clip(dist / max(taper, 1e-4), 0, 1)
        off = edge + (t - edge) * (tp * (2 - tp))
        newpos = pos + nrm * off[:, None]
        if rim_l and rim_smooth:
            # The rim follows faces, so it steps; smooth it along itself and lay it back on
            # the surface, so a hairline or a hood's edge is a clean curve.
            nbr = {}
            for e in out.edges:
                if e.is_boundary:
                    a, b = local[back[e.verts[0]]], local[back[e.verts[1]]]
                    nbr.setdefault(a, []).append(b)
                    nbr.setdefault(b, []).append(a)
            base = pos.copy()
            for _ in range(rim_smooth):
                nb = base.copy()
                for i, ns in nbr.items():
                    if len(ns) == 2:
                        nb[i] = 0.5 * base[i] + 0.25 * (base[ns[0]] + base[ns[1]])
                base = nb
            sb = bmesh.new()
            sb.from_mesh(me)
            sbvh = BVHTree.FromBMesh(sb)
            sb.free()
            for i in nbr:
                loc, nn, _fi, _d = sbvh.find_nearest(Vector(base[i]))
                if loc is None:
                    continue
                pos[i] = np.array(loc)
                nrm[i] = np.array(nn)
                newpos[i] = pos[i] + nrm[i] * off[i]
                vi = idx[i]
                vmap[vi] = (vmap[vi][0], Vector(loc), Vector(nn))
        if smooth:
            fixed = np.zeros(len(pos))
            fixed[rim_l] = 1.0
            newpos = B.laplace(newpos, edges, (1 - fixed) * 0.9, smooth)
        for k, vi in enumerate(idx):
            vmap[vi][0].co = Vector(newpos[k])
        if wall and rim_l:
            # Close the rim down to the body surface (just inside it).
            rim_edges = [e for e in out.edges if e.is_boundary]
            base = {}
            for e in rim_edges:
                for v in e.verts:
                    if v not in base:
                        o = vmap[back[v]]
                        base[v] = out.verts.new(o[1] - o[2] * 0.002)
            for e in rim_edges:
                a, b = e.verts
                f = e.link_faces[0]
                # Keep the face winding consistent with the shell face on this edge.
                loop = next(lp for lp in f.loops if lp.edge == e)
                if loop.vert == a:
                    out.faces.new((b, a, base[a], base[b]))
                else:
                    out.faces.new((a, b, base[b], base[a]))
        n_shell = len(keep)
        out.faces.ensure_lookup_table()
        ob = self.part(name, out, pal, bone=bone)
        if inner_pal is not None:
            # Wall faces in another colour (a hood's lining).
            for p in ob.data.polygons:
                if p.index >= n_shell:
                    p.material_index = self.pal(inner_pal)
        self.decimate_part(ob, target)
        return ob

    def remove_head(self, below_z=None):
        """Delete the human head (for a head piece): faces mostly weighted to the head bone,
        above the neck's top (or `below_z`)."""
        me = self.body.data
        bm = bmesh.new()
        bm.from_mesh(me)
        dl = bm.verts.layers.deform.active
        gi = self.body.vertex_groups["head"].index
        z0 = below_z if below_z is not None else self.J("neck_01").z + 0.045
        kill = [f for f in bm.faces if all(v[dl].get(gi, 0.0) > 0.4 for v in f.verts) and f.calc_center_median().z > z0]
        bmesh.ops.delete(bm, geom=kill, context="FACES")
        loose = [v for v in bm.verts if not v.link_faces]
        bmesh.ops.delete(bm, geom=loose, context="VERTS")
        # Cap the hole so nothing looks in.
        bnd = [e for e in bm.edges if e.is_boundary]
        if bnd:
            bmesh.ops.holes_fill(bm, edges=bnd, sides=0)
        bm.to_mesh(me)
        bm.free()
        me.update()
        self._bw = None

    # -- the face ------------------------------------------------------------------

    def decal(self, shape, x, y, rx, ry, fill=None, rot=0.0, ink=0.0, clip=False, mirror=False, n=0.0, amp=0.0):
        """A sticker feature on the face, in cm from between the eyes (x toward the
        character's left, y up), drawn by the shader: shape is ellipse, ring, lower, stroke,
        upper, arc, jag or teeth."""
        self.decals.append({"shape": shape, "x": x, "y": y, "rx": rx, "ry": ry, "rot": rot, "fill": -1 if fill is None else self.pal(fill), "ink": ink, "clip": clip, "mirror": mirror, "n": n, "amp": amp})

    def face_frame(self, centre, half_w, top, bottom, depth=0.0, any_bone=False):
        """Where decals may land: within `half_w` of the centre line, between `top` and
        `bottom` (z, metres), on surfaces facing forward, in front of y = centre.y + depth."""
        self.face = {"c": Vector(centre), "half_w": half_w, "top": top, "bottom": bottom, "depth": depth}


# ---------------------------------------------------------------------------------------
# Decimation, attributes and export


def seam_locked_decimate(ob, target, symmetric=True, seams=True):
    """Decimate `ob` to about `target` triangles; vertices on colour seams may not collapse
    (unless `seams` is off, for a body only ever seen far off), nor those on open edges."""
    me = ob.data
    lock = set()
    bm = bmesh.new()
    bm.from_mesh(me)
    for e in bm.edges:
        if seams and len(e.link_faces) == 2 and e.link_faces[0].material_index != e.link_faces[1].material_index:
            lock.update(v.index for v in e.verts)
        if e.is_boundary:
            lock.update(v.index for v in e.verts)
    bm.free()
    vg = ob.vertex_groups.new(name="_decimate")
    vg.add([i for i in range(len(me.vertices)) if i not in lock], 1.0, "REPLACE")
    if lock:
        vg.add(list(lock), 0.0, "REPLACE")
    dec = ob.modifiers.new("Decimate", "DECIMATE")
    dec.decimate_type = "COLLAPSE"
    dec.use_symmetry = symmetric
    dec.symmetry_axis = "X"
    dec.vertex_group = vg.name
    bpy.context.view_layer.objects.active = ob
    while ob.modifiers[0].name != dec.name:
        bpy.ops.object.modifier_move_up(modifier=dec.name)
    before = tri_count(me)
    lo, hi = 0.02, 1.0

    def tris_now():
        dg = bpy.context.evaluated_depsgraph_get()
        m = ob.evaluated_get(dg).to_mesh()
        n = tri_count(m)
        ob.evaluated_get(dg).to_mesh_clear()
        return n

    for _ in range(14):
        dec.ratio = (lo + hi) / 2
        if tris_now() > target:
            hi = dec.ratio
        else:
            lo = dec.ratio
    dec.ratio = lo
    bpy.ops.object.modifier_apply(modifier=dec.name)
    ob.vertex_groups.remove(ob.vertex_groups["_decimate"])
    print(f"[cast] decimated {ob.name}: {before} → {tri_count(me)} triangles (target {target})")


def face_coords(k, ob):
    """_face per vertex: (x, y) in cm from between the eyes and a mask (1: decals may land)."""
    me = ob.data
    f = k.face
    c = f["c"]
    names = {g.index: g.name for g in ob.vertex_groups}
    data = np.zeros((len(me.vertices), 3), dtype=np.float32)
    for v in me.vertices:
        hw = sum(g.weight for g in v.groups if names.get(g.group) == "head")
        p = v.co
        x = (p.x - c.x) * 100 * k.face_sx
        y = (p.z - c.z) * 100
        y *= k.face_sy_up if y > 0 else k.face_sy_down
        on = hw > 0.5 and abs(p.x - c.x) < f["half_w"] and f["bottom"] < p.z < f["top"] and p.y < c.y + f["depth"] and v.normal.y < 0.15
        data[v.index] = (x, y, 1.0 if on else 0.0)
    return data


def finish_mesh(k, ob, label):
    """Attributes the game reads: _pal (corner), _face, _ao (point)."""
    me = ob.data
    for p in me.polygons:
        p.use_smooth = True
    pal = np.array([p.material_index for p in me.polygons], dtype=np.float32)
    corner = np.zeros(len(me.loops), dtype=np.float32)
    for p in me.polygons:
        corner[p.loop_start : p.loop_start + p.loop_total] = pal[p.index]
    for name in ("_pal", "_face", "_ao"):
        if name in me.attributes:
            me.attributes.remove(me.attributes[name])
    if "web_p" in me.attributes:
        # The lens and rim shells carry no web (kinds 8 and 9, as on the hero).
        q = me.attributes["web_q"].data
        r = me.attributes["web_r"].data
        lens, rim = k.pal("lens"), k.pal("ink")
        for p in me.polygons:
            if p.material_index in (lens, rim):
                for li in range(p.loop_start, p.loop_start + p.loop_total):
                    q[li].vector = (0.0, 0.0, 0.0)
                    r[li].vector = (0.0, 0.0, 8.0 if p.material_index == lens else 9.0)
        for name in ("web_p", "web_q", "web_r"):
            me.attributes[name].name = "_" + name
    me.attributes.new("_pal", "FLOAT", "CORNER").data.foreach_set("value", corner)
    me.attributes.new("_face", "FLOAT_VECTOR", "POINT").data.foreach_set("vector", face_coords(k, ob).ravel())
    flat_slots = {k.pal(n) for n in k.flat}
    ao = EX.bake_ao(ob, ob, flat_slots)
    me.attributes.new("_ao", "FLOAT", "POINT").data.foreach_set("value", ao)
    print(f"[cast] {label}: {tri_count(me)} triangles, {len(me.vertices)} vertices, AO mean {sum(ao) / len(ao):.2f}")


def meta(k):
    return {
        "who": k.who,
        "palette": [h for _n, h in k.palette],
        "names": [n for n, _h in k.palette],
        "flat": sorted(k.pal(n) for n in k.flat),
        "gloss": sorted(k.pal(n) for n in k.gloss),
        "decals": k.decals,
        "sockets": k.sockets,
        "web": k.lenses,
        "height": k.height_total,
        # Civilians: the colours each slot may take (the game dresses each person from them).
        **({"looks": k.spec["looks"], "phone": k.phone} if k.spec.get("looks") else {}),
    }


def export_glb(k, rig, meshes, path):
    sc = bpy.context.scene
    keep = set(meshes) | {rig}
    hidden = []
    for ob in sc.objects:
        if ob not in keep:
            hidden.append(ob)
    bpy.ops.object.select_all(action="DESELECT")
    for ob in meshes:
        ob.parent = rig
        ob.matrix_parent_inverse = Matrix.Identity(4)
        ob.select_set(True)
        for m in list(ob.modifiers):
            if m.type == "ARMATURE":
                ob.modifiers.remove(m)
        arm = ob.modifiers.new("Armature", "ARMATURE")
        arm.object = rig
        for key in list(ob.keys()):
            del ob[key]
        ob["wgp"] = json.dumps(meta(k))
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    os.makedirs(os.path.dirname(path), exist_ok=True)
    saved = {}
    for ob in meshes:
        saved[ob.name] = list(ob.data.materials)
        ob.data.materials.clear()
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=False,
        export_skins=True,
        export_animations=False,
        export_morph=False,
        export_texcoords=False,
        export_normals=True,
        export_attributes=True,
        export_materials="NONE",
        export_def_bones=False,
        export_influence_nb=4,
        export_all_influences=False,
        export_extras=True,
    )
    for ob in meshes:
        for m in saved[ob.name]:
            ob.data.materials.append(m)
    print("[cast] wrote", path, f"{os.path.getsize(path) / 1e6:.2f} MB")


FINGER = ("thumb_", "index_", "middle_", "ring_", "pinky_")


def fold_finger_weights(ob):
    """Every finger's weights into its hand (a crowd body never curls its fingers)."""
    names = {g.index: g.name for g in ob.vertex_groups}
    hands = {s: ob.vertex_groups.get("hand_" + s) or ob.vertex_groups.new(name="hand_" + s) for s in "lr"}
    for v in ob.data.vertices:
        add = {"l": 0.0, "r": 0.0}
        for g in v.groups:
            n = names[g.group]
            if n.startswith(FINGER):
                add[n[-1]] += g.weight
        for s, w in add.items():
            if w > 0:
                have = next((g.weight for g in v.groups if g.group == hands[s].index), 0.0)
                hands[s].add([v.index], have + w, "REPLACE")
    for vg in list(ob.vertex_groups):
        if vg.name.startswith(FINGER):
            ob.vertex_groups.remove(vg)


def join_into(target, parts):
    if not parts:
        return
    bpy.ops.object.select_all(action="DESELECT")
    for p in parts:
        p.select_set(True)
    target.select_set(True)
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.join()


def preview(k, objs, path, head=False):
    """A quick flat-colour sheet (front, three-quarter, side, back) for checking the build;
    `head`: the head only, close."""
    sc = bpy.context.scene
    cols = [hexrgb(h) for _n, h in k.palette]
    shown = []
    for ob in objs:
        me = ob.data
        name = "_prev"
        if name in me.color_attributes:
            me.color_attributes.remove(me.color_attributes[name])
        ca = me.color_attributes.new(name, "BYTE_COLOR", "CORNER")
        buf = np.zeros((len(me.loops), 4), dtype=np.float32)
        for p in me.polygons:
            c = cols[p.material_index] + (1.0,)
            buf[p.loop_start : p.loop_start + p.loop_total] = c
        ca.data.foreach_set("color_srgb", buf.ravel())
        me.color_attributes.active_color = ca
    views = [0, -35, -90, 180]
    w = k.height_total * (0.2 if head else 0.75)
    for i, a in enumerate(views):
        for ob in objs:
            c = ob.copy()
            sc.collection.objects.link(c)
            for m in list(c.modifiers):
                c.modifiers.remove(m)
            c.matrix_world = Matrix.Translation((i * w, 0, 0)) @ Matrix.Rotation(math.radians(a), 4, "Z")
            shown.append(c)
    was = {ob.name: ob.hide_render for ob in sc.objects}
    for ob in sc.objects:
        if ob not in shown:
            ob.hide_render = True
    cam_d = bpy.data.cameras.new("pcam")
    cam_d.type = "ORTHO"
    cam_d.ortho_scale = len(views) * w * 1.0 if head else max(k.height_total * 1.1, len(views) * w * 1.0)
    cam = bpy.data.objects.new("pcam", cam_d)
    sc.collection.objects.link(cam)
    cam.location = ((len(views) - 1) * w / 2, -10, (k.head_c.z + 0.02) if head else k.height_total * 0.5)
    cam.rotation_euler = (math.radians(90), 0, 0)
    sc.camera = cam
    sc.render.engine = "BLENDER_WORKBENCH"
    sh = sc.display.shading
    sh.light = "STUDIO"
    sh.show_specular_highlight = False
    sh.color_type = "VERTEX"
    sh.show_object_outline = True
    sh.show_cavity = False
    sc.render.resolution_x = int(360 * len(views))
    sc.render.resolution_y = int(360 * len(views) * k.height_total * 1.1 / cam_d.ortho_scale) if cam_d.ortho_scale > k.height_total * 1.1 else 640
    sc.render.resolution_y = 380 if head else max(sc.render.resolution_y, 480)
    sc.render.film_transparent = False
    sc.world = sc.world or bpy.data.worlds.new("w")
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    for c in shown:
        bpy.data.objects.remove(c, do_unlink=True)
    for ob in sc.objects:
        ob.hide_render = was.get(ob.name, False)
    bpy.data.objects.remove(cam, do_unlink=True)
    print("[cast] preview", path)


def copy_object(ob):
    c = ob.copy()
    c.data = ob.data.copy()
    bpy.context.collection.objects.link(c)
    return c


def strip_groups(ob, bones):
    for vg in list(ob.vertex_groups):
        if vg.name not in bones:
            ob.vertex_groups.remove(vg)


def spec_of(who):
    """A cast member (cast.py), or a civilian (civilians.py, the ids "civ-…")."""
    if who.startswith("civ-"):
        import civilians as CIV

        return CIV.CIVILIANS[who]
    import cast as CAST

    return CAST.CAST[who]


def build(who, o):
    spec = spec_of(who)
    k = Kit(who, spec)
    k.make_body()
    spec["build"](k)
    body = k.body
    k.height_total = max([k.height] + [max((p.matrix_world @ v.co).z for v in p.data.vertices) for p in k.parts])
    hi_t, lo_t = spec.get("tris", (7000, 2600))
    parts_hi = [p for p in k.parts if p.get("lod", "both") in ("both", "hi")]
    parts_lo = [p for p in k.parts if p.get("lod", "both") in ("both", "lo")]
    acc_hi = sum(tri_count(p.data) for p in parts_hi)
    acc_lo = sum(tri_count(p.data) for p in parts_lo)
    print(f"[cast] props: {acc_hi} triangles (hi), {acc_lo} (lo)")
    strip_groups(body, k.bones)
    for p in k.parts:
        strip_groups(p, k.bones)
    web = bool(spec.get("web"))
    if web:
        # Gwei's mask web: decimation smears corner data, so it's resampled from the full body.
        high = copy_object(body)
        lens_slots = {k.pal("lens"), k.pal("ink")}
    seam_locked_decimate(body, max(spec.get("hi_floor", 2500), hi_t - acc_hi))
    if web:
        EX.resample_web(body, high, lens_slots)
    lo = copy_object(body)
    # Props over this many triangles are halved for the light body (a crowd's, sooner).
    halve = spec.get("lo_halve", 300)
    acc_lo2 = sum(tri_count(p.data) // (2 if p.get("lod", "both") == "both" and tri_count(p.data) > halve else 1) for p in parts_lo)
    seam_locked_decimate(lo, max(spec.get("lo_floor", 1200), lo_t - acc_lo2), seams=not spec.get("lo_unlocked"))
    if web:
        EX.resample_web(lo, high, lens_slots)
        bpy.data.objects.remove(high, do_unlink=True)
    lo_parts = []
    for p in parts_lo:
        c = copy_object(p) if p in parts_hi else p
        # Heavier props thin out for the light body too.
        if p.get("lod", "both") == "both" and tri_count(c.data) > halve:
            seam_locked_decimate(c, tri_count(c.data) // 2, symmetric=False, seams=not spec.get("lo_unlocked"))
        lo_parts.append(c)
    join_into(lo, lo_parts)
    join_into(body, parts_hi)
    body.name = body.data.name = "Body"
    lo.name = lo.data.name = "BodyLo"
    extra = []
    if spec.get("min"):
        # A lighter body still, for a crowd (the Sybil's copies).
        mn = copy_object(lo)
        seam_locked_decimate(mn, spec["min"])
        mn.name = mn.data.name = "BodyMin"
        extra.append(mn)
    if k.fold_fingers:
        for ob in [body, lo] + extra:
            fold_finger_weights(ob)
    finish_mesh(k, body, "hi")
    finish_mesh(k, lo, "lo")
    for m in extra:
        finish_mesh(k, m, "min")
    if o["preview"]:
        preview(k, [body], o["preview"])
        preview(k, [body], o["preview"].replace(".png", "-head.png"), head=True)
        preview(k, [lo], o["preview"].replace(".png", "-lo.png"))
    if o["blend"]:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, f"cast-{who}.blend"), compress=True)
    if o["export"]:
        name = spec.get("file") or f"cast-{who}"
        export_glb(k, k.rig, [body, lo] + extra, os.path.join(o["out"], f"{name}.glb"))
        export_glb(k, k.rig, [lo] + extra, os.path.join(o["out"], f"{name}-lo.glb"))
    return k


def main():
    o = args()
    os.makedirs(OUT, exist_ok=True)
    build(o["who"], o)


if __name__ == "__main__":
    main()
