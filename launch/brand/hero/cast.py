"""
The cast's data table for build_cast.py: per character, the MakeHuman macros and detail
targets of the body, the palette (index 0 is always ink), which colours are flat (no cel
bands) or glossy, the triangle budgets (hi, lo), and a build function that paints the
clothes, adds the hair, props and head pieces, and lays out the painted face.

The looks follow the sticker art (launch/brand/art/*.svg) and the cast list in
packages/game-core/src/rules/cast.ts. Distances are metres in the rest pose (Blender: z up,
the body faces −y, its left is +x); face decals are cm from between the eyes.
"""

import math

import bmesh
import numpy as np
from mathutils import Matrix, Vector

import build as B

INK = "#141414"


def face_y(k, z):
    """A height on the body as a decal y (cm above the eye line)."""
    return (z - k.face_c.z) * 100


def human_face(k, top=0.055, half_w=0.072):
    """Decals may land on the front half of the head, from the chin to `top` above the eyes."""
    k.face_frame(k.face_c, half_w, k.face_c.z + top, k.chin_z - 0.01, depth=(k.head_c.y - k.face_c.y) - 0.01)


def shoes(k, name="shoe", t=1.9):
    for s in "lr":
        k.paint(name, "leg_" + s, [k.leg(s, t)])


def sleeves(k, name, t):
    """Sleeves to t along the arm (0 shoulder, 1 elbow, 2 wrist)."""
    for s in "lr":
        k.paint(name, "arm_" + s, [k.arm(s, t, flip=True)])


def gloves(k, name, t=1.9):
    for s in "lr":
        k.paint(name, "arm_" + s, [k.arm(s, t)])


def waist_z(k, up=0.0):
    return k.J("spine_01").z + up


def hash01(*xs):
    h = 0.0
    for i, x in enumerate(xs):
        h += x * (12.9898 + 78.233 * i)
    return abs(math.sin(h) * 43758.5453) % 1.0


# ---------------------------------------------------------------------------------------
# Hair helpers


def voxel_hair(k, step, occupied, colours, bone="head", lod="both"):
    """Pixel hair: cubes on a lattice in head space, only their exposed faces, coloured by
    a hash per cube."""
    hc = k.head_c
    cells = {}
    r = int(0.2 / step)
    for i in range(-r, r + 1):
        for j in range(-r, r + 1):
            for kk in range(-int(0.32 / step), r + 1):
                c = Vector((hc.x + i * step, hc.y + j * step, hc.z + kk * step))
                if occupied(c):
                    cells[(i, j, kk)] = colours[int(hash01(i, j, kk) * len(colours)) % len(colours)]
    bm = bmesh.new()
    pal_of_face = []
    h = step / 2
    dirs = [((1, 0, 0), (0, 1, 0), (0, 0, 1)), ((-1, 0, 0), (0, 0, 1), (0, 1, 0)), ((0, 1, 0), (0, 0, 1), (1, 0, 0)), ((0, -1, 0), (1, 0, 0), (0, 0, 1)), ((0, 0, 1), (1, 0, 0), (0, 1, 0)), ((0, 0, -1), (0, 1, 0), (1, 0, 0))]
    verts = {}

    def vert(p):
        key = tuple(round(x / h) for x in p)
        v = verts.get(key)
        if v is None:
            v = verts[key] = bm.verts.new(p)
        return v

    for (i, j, kk), col in cells.items():
        c = Vector((hc.x + i * step, hc.y + j * step, hc.z + kk * step))
        for n, u, v in dirs:
            if (i + n[0], j + n[1], kk + n[2]) in cells:
                continue
            n, u, v = Vector(n), Vector(u), Vector(v)
            q = [c + (n + u * a + v * b) * h for a, b in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
            f = bm.faces.new([vert(p) for p in q])
            pal_of_face.append(col)
    cols = list(pal_of_face)
    ob = k.part("pixel_hair_" + lod, bm, cols[0], bone=bone, flat_shade=True, lod=lod)
    for p, col in zip(ob.data.polygons, cols):
        p.material_index = k.pal(col)
    print(f"[cast] pixel hair: {len(cells)} cubes, {len(cols)} faces")
    return ob



# ---------------------------------------------------------------------------------------
# Hair, garments and props


def hairline(k, front, side, back, region=None):
    """Head faces above a hairline (heights relative to the eyes, metres): `front` at the
    forehead, `side` over the ears, `back` at the nape, blended round the head. `region`
    optionally narrows it further: region(c, phi) → bool, phi 0 at the front, ±π at the back."""
    hc = k.head_c
    fz = k.face_c.z

    def pick(c, f, head):
        if head < 0.5:
            return False
        phi = math.atan2(c.x - hc.x, -(c.y - hc.y))
        a = abs(phi) / math.pi  # 0 front … 0.5 side … 1 back
        if a < 0.5:
            u = a / 0.5
            line = front + (side - front) * (u * u * (3 - 2 * u))
        else:
            u = (a - 0.5) / 0.5
            line = side + (back - side) * (u * u * (3 - 2 * u))
        if c.z < fz + line:
            return False
        return region is None or region(c, phi)

    return pick


def hair_cap(k, name, pal, front, side, back, thick=0.012, top=0.016, edge=0.003, region=None, taper=0.014, smooth=8):
    hc = k.head_c
    span = max(1e-3, k.head_top - k.face_c.z)

    def t(p):
        u = max(0.0, min(1.0, (p.z - k.face_c.z) / span))
        return thick + (top - thick) * u

    return k.shell(name, hairline(k, front, side, back, region), t, pal, edge=edge, smooth=smooth, taper=taper, bone="head")


def glasses(k, pal, r=0.019, scale=(1.0, 1.0), wire=0.0022, lens=None, gap=0.012, temples=True):
    """Rims (and lenses, for sunglasses) in front of the eyes, skinned to the head."""
    bvh = k.bvh()
    parts = []
    centres = []
    for e in (k.eye_l, k.eye_r):
        # In front of the frontmost bit of face under the rim (brow, cheek, the eye itself).
        front = e.y - 0.012
        for dx, dz in ((0, 0), (r, 0), (-r, 0), (0, r), (0, -r), (0.7 * r, 0.7 * r), (-0.7 * r, 0.7 * r)):
            hit, *_ = bvh.ray_cast(Vector((e.x * 1.08 + dx * scale[0], e.y - 0.2, e.z + dz * scale[1])), Vector((0, 1, 0)))
            if hit is not None:
                front = min(front, hit.y)
        c = Vector((e.x * 1.08, front - gap, e.z + 0.002))
        centres.append(c)
        parts.append(k.torus(c, r, wire, axis=(0, -1, 0), segs=18, rsegs=5, scale=(scale[0], scale[1], 1)))
        if lens:
            parts.append(k.sphere(c + Vector((0, 0.002, 0)), (r * scale[0] * 0.98, 0.004, r * scale[1] * 0.98), segs=14, rings=5))
    a, b = centres
    mid = (a + b) / 2
    span = abs(a.x - b.x) - 2 * r * scale[0]
    parts.append(k.cylinder(mid + Vector((0, 0, r * 0.25)), wire * 0.9, max(span, 0.004) + 0.004, axis=(1, 0, 0), segs=5, cap=False))
    if temples:
        for c in centres:
            s = 1 if c.x > 0 else -1
            p0 = c + Vector((s * r * scale[0], 0, r * 0.2))
            hw = k.head_halfw + 0.004
            p1 = Vector((s * hw, k.head_c.y + 0.02, c.z + 0.004))
            parts.append(k.tube([p0, p0 + Vector((s * 0.008, 0.01, 0)), p1], [wire, wire, wire], segs=4))
    ob = k.part("glasses", k.join_bm(*parts), pal, bone="head")
    if lens:
        # The lens discs in their own colour (flat or glossy).
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        for f in bm.faces:
            cc = f.calc_center_median()
            for c in centres:
                d = cc - c
                if abs(d.y) < 0.007 and (d.x / (r * scale[0])) ** 2 + (d.z / (r * scale[1])) ** 2 < 0.9:
                    f.material_index = k.pal(lens)
        bm.to_mesh(ob.data)
        bm.free()
    return ob


def flare(k, name, pal, z_top, z_bottom, ease=0.008, flare_r=0.05, rows=8, segs=28, open_front=0.0, inner=None, thigh=0.6):
    """A skirt or a coat's skirt: rings round the hips from z_top down to z_bottom, each
    wrapping the body's outline at its height (never narrower than the ring above) plus an
    ease, flaring by flare_r at the hem. Skinned to the pelvis, sliding to the thighs (by
    side) toward the hem. open_front: radians left open at the front (a coat)."""
    bvh = k.bvh_regions("torso+legs")
    yc = k.J("pelvis").y
    bm = bmesh.new()
    rings = []
    prev = None
    a0 = open_front / 2
    angles = [a0 + (2 * math.pi - open_front) * i / (segs if open_front <= 0 else segs - 1) for i in range(segs)]
    for r_i in range(rows + 1):
        t = r_i / rows
        z = z_top + (z_bottom - z_top) * t
        rad = []
        for a in angles:
            d = Vector((math.sin(a), -math.cos(a), 0))
            origin = Vector((0, yc, z)) + d * 0.6
            hit, *_ = bvh.ray_cast(origin, -d, 0.6)
            r = (Vector((hit.x, hit.y - yc, 0)).length if hit is not None else 0.0)
            rad.append(r)
        # Smooth round the ring (the gap between the legs fills in), keep it from narrowing.
        rad = [max(rad[i], 0.5 * (rad[i - 1] + rad[(i + 1) % segs])) for i in range(segs)]
        for _ in range(3):
            rad = [0.25 * rad[i - 1] + 0.5 * rad[i] + 0.25 * rad[(i + 1) % segs] for i in range(segs)]
        if prev is not None:
            rad = [max(r, p) for r, p in zip(rad, prev)]
        prev = rad
        ring = []
        for a, r in zip(angles, rad):
            rr = r + ease + flare_r * t * t
            ring.append(bm.verts.new((math.sin(a) * rr, yc - math.cos(a) * rr, z)))
        rings.append(ring)
    closed = open_front <= 0
    for ra, rb in zip(rings[:-1], rings[1:]):
        for i in range(segs if closed else segs - 1):
            j = (i + 1) % segs
            bm.faces.new((ra[i], ra[j], rb[j], rb[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    # Make sure the outside faces outward.
    f0 = bm.faces[0]
    c = f0.calc_center_median()
    if f0.normal.dot(Vector((c.x, c.y - yc, 0))) < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
    # An inner surface, so the inside shows from below.
    if inner:
        dup = bmesh.ops.duplicate(bm, geom=bm.faces[:])
        nf = [g for g in dup["geom"] if isinstance(g, bmesh.types.BMFace)]
        nv = [g for g in dup["geom"] if isinstance(g, bmesh.types.BMVert)]
        for v in nv:
            d = Vector((v.co.x, v.co.y - yc, 0))
            if d.length > 1e-6:
                v.co -= d.normalized() * 0.003
        bmesh.ops.reverse_faces(bm, faces=nf)
        inner_faces = set(nf)
    else:
        inner_faces = set()
    # Weights: the pelvis at the waist, sliding to the thighs by side toward the hem.
    weights = {}
    bm.verts.index_update()
    zl = z_top - z_bottom
    for v in bm.verts:
        t = max(0.0, min(1.0, (z_top - v.co.z) / max(zl, 1e-4)))
        s = (t * t * (3 - 2 * t)) * thigh
        side = max(0.0, min(1.0, 0.5 + v.co.x / 0.16))
        weights[v.index] = {"pelvis": 1 - s, "thigh_l": s * side, "thigh_r": s * (1 - side)}
    pal_of = {f.index: (inner if f in inner_faces else pal) for f in bm.faces}
    bm.faces.index_update()
    pal_list = [pal_of[f.index] for f in bm.faces]
    ob = k.part(name, bm, pal, weights=weights)
    for p, pn in zip(ob.data.polygons, pal_list):
        p.material_index = k.pal(pn)
    return ob


def hood(k, name, pal, lining, open_w=0.058, open_top=0.045, open_bottom=-0.11, thick=0.016, src=None, neck=True):
    """A hood over the head and down onto the neck, open round the face."""
    hc = k.head_c
    fz = k.face_c.z
    nz = k.J("neck_01").z

    def pick(c, f, head):
        if c.z < nz + (0.0 if neck else 0.05):
            return False
        if src is None and head < 0.3 and c.z > nz + 0.06:
            return False
        front = c.y < hc.y - 0.01
        if front:
            # The face opening: an oval in front.
            u = (c.x / open_w) ** 2
            zc = fz + (open_top + open_bottom) / 2
            hz = (open_top - open_bottom) / 2
            v = ((c.z - zc) / hz) ** 2
            if u + v < 1.0:
                return False
        return True

    def t(p):
        return thick * (0.6 + 0.4 * max(0.0, min(1.0, (p.z - nz) / 0.15)))

    return k.shell(name, pick, t, pal, edge=0.004, smooth=10, taper=0.006, bone=None, inner_pal=lining, src=src)


def relax_rim(bm, iterations):
    """Smooth a cut surface's open edges along themselves (the cut followed faces)."""
    nbr = {}
    for e in bm.edges:
        if e.is_boundary:
            a, b = e.verts
            nbr.setdefault(a, []).append(b)
            nbr.setdefault(b, []).append(a)
    for _ in range(iterations):
        new = {v: v.co * 0.5 + (ns[0].co + ns[1].co) * 0.25 for v, ns in nbr.items() if len(ns) == 2}
        for v, c in new.items():
            v.co = c


def hood_mb(k, name, pal, lining, open_w=0.064, open_top=0.055, open_bottom=-0.12, ease=0.024, cowl=(0.13, 0.12, 0.075), extra=()):
    """A hood sculpted round the head and down onto the shoulders (metaballs), open at the
    face, lined inside; `extra` metaball elements join it (a brim's peak)."""
    hc = k.head_c
    fz = k.face_c.z
    hw = k.head_halfw
    depth = (k.head_back - k.face_c.y) / 2
    hh = (k.head_top - k.chin_z) / 2
    nb = k.J("neck_01")
    els = [
        ("ELLIPSOID", Vector((0, (k.head_back + k.face_c.y) / 2 + 0.006, (k.head_top + k.chin_z) / 2 + 0.012)), (hw + ease, depth + ease, hh + ease * 0.6), None),
        ("ELLIPSOID", Vector((0, nb.y + 0.012, nb.z - 0.005)), cowl, None),
    ] + list(extra)
    bm = k.metaball(name, els, resolution=0.012)
    zc = fz + (open_top + open_bottom) / 2
    hz = (open_top - open_bottom) / 2
    cut = [f for f in bm.faces if (lambda c: c.y < hc.y and (c.x / open_w) ** 2 + ((c.z - zc) / hz) ** 2 < 1.0)(f.calc_center_median())]
    # Nothing below the shoulders' slope either.
    cut += [f for f in bm.faces if f.calc_center_median().z < nb.z - 0.06 and f not in cut]
    bmesh.ops.delete(bm, geom=cut, context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    relax_rim(bm, 14)
    # The lining: the same surface a little inside, facing in.
    dup = bmesh.ops.duplicate(bm, geom=bm.faces[:])
    inner = [g for g in dup["geom"] if isinstance(g, bmesh.types.BMFace)]
    bm.normal_update()
    for v in [g for g in dup["geom"] if isinstance(g, bmesh.types.BMVert)]:
        v.co -= v.normal * 0.005
    bmesh.ops.reverse_faces(bm, faces=inner)
    inner_set = set(inner)
    bm.faces.index_update()
    names = [lining if f in inner_set else pal for f in bm.faces]
    ob = k.part(name, bm, pal)
    for p, n in zip(ob.data.polygons, names):
        p.material_index = k.pal(n)
    k.decimate_part(ob, 1100)
    return ob


def tie(k, pal, knot_pal=None, width=0.042, length=0.36):
    """A tie down the shirt front: a knot at the collar, the blade following the chest."""
    bvh = k.bvh()
    top = k.neck_front + Vector((0, -0.006, -0.012))
    bm = bmesh.new()
    rows = []
    n = 9
    for i in range(n + 1):
        t = i / n
        z = top.z - length * t
        hit, *_ = bvh.ray_cast(Vector((0, -0.5, z)), Vector((0, 1, 0)))
        y = (hit.y if hit is not None else top.y) - 0.007
        w = width * (0.45 + 0.55 * min(1.0, t * 3)) if t < 0.92 else width * (1 - (t - 0.92) / 0.08) * 0.9 + 0.001
        if i == n:
            rows.append([bm.verts.new((0, y, z - 0.02))])
            continue
        rows.append([bm.verts.new((-w / 2, y, z)), bm.verts.new((w / 2, y, z)), bm.verts.new((w / 2, y + 0.004, z)), bm.verts.new((-w / 2, y + 0.004, z))])
    for a, b in zip(rows[:-2], rows[1:-1]):
        bm.faces.new((a[0], a[1], b[1], b[0]))
        bm.faces.new((a[1], a[2], b[2], b[1]))
        bm.faces.new((a[3], a[0], b[0], b[3]))
    last, tip = rows[-2], rows[-1][0]
    bm.faces.new((last[0], last[1], tip))
    bm.faces.new((last[1], last[2], tip))
    bm.faces.new((last[3], last[0], tip))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    for f in bm.faces:
        if f.normal.y > 0.5:
            bmesh.ops.reverse_faces(bm, faces=[f])
    knot = k.sphere(top + Vector((0, -0.002, 0.004)), (0.018, 0.012, 0.016), segs=8, rings=5)
    ob = k.part("tie", k.join_bm(bm, knot), pal)
    return ob


def pearls(k, pal, n=13, r=0.0065, drop=0.022):
    bvh = k.bvh()
    nz = k.J("neck_01").z - drop
    ny = (k.neck_front.y + k.neck_back.y) / 2
    parts = []
    for i in range(n):
        a = -1.25 + 2.5 * i / (n - 1)
        d = Vector((math.sin(a), -math.cos(a), 0))
        z = nz - 0.022 * math.cos(a)
        hit, *_ = bvh.ray_cast(Vector((0, ny, z)) + d * 0.4, -d, 0.4)
        p = (hit if hit is not None else Vector((0, ny, z)) + d * 0.07) + d * (r * 0.9)
        parts.append(k.sphere(p, (r, r, r), segs=6, rings=4))
    return k.part("pearls", k.join_bm(*parts), pal)


def cigar(k, base, direction, pal="cigar", band="band", ember="ember", length=0.1, r=0.0085):
    d = Vector(direction).normalized()
    body = k.cylinder(base + d * (length / 2), r, length, axis=d, segs=8)
    ring = k.cylinder(base + d * (length * 0.22), r * 1.15, length * 0.12, axis=d, segs=8)
    tip = k.cylinder(base + d * (length + 0.004), r * 0.98, 0.008, axis=d, segs=8)
    ob = k.part("cigar", k.join_bm(body), pal, bone="head")
    k.part("cigar_band", ring, band, bone="head")
    k.part("cigar_ember", tip, ember, bone="head")
    return ob


def sphere_part(k, name, centre, radii, pal, bone="head", segs=12, rings=8, rot=None):
    return k.part(name, k.sphere(centre, radii, segs=segs, rings=rings, rot=rot), pal, bone=bone)


def piece_face(k, ob, centre_guess, half_w, top, bottom):
    """The face frame of a head piece: its surface point straight in front of `centre_guess`."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    from mathutils.bvhtree import BVHTree

    t = BVHTree.FromBMesh(bm)
    bm.free()
    hit, *_ = t.ray_cast(Vector((centre_guess.x, centre_guess.y - 0.5, centre_guess.z)), Vector((0, 1, 0)))
    c = Vector(hit) if hit is not None else centre_guess
    k.face_frame(c, half_w, c.z + top, c.z + bottom, depth=0.08)
    return c


def paint_by(k, ob, fn):
    """Recolour an accessory's faces by fn(centre, normal) → palette name (or None to keep)."""
    for p in ob.data.polygons:
        name = fn(Vector(p.center), Vector(p.normal))
        if name:
            p.material_index = k.pal(name)


# ---------------------------------------------------------------------------------------
# Mary JPEG: young woman, slim; red pixel-blocky hair, teal top, blue jeans, white sneakers.


def mary(k):
    k.clothe()
    k.open_paint()
    k.fill("skin")
    w = waist_z(k, -0.01)
    k.paint("jeans", "torso+legs", [k.below(w)])
    k.paint("top", "torso+neck", [k.above(w), k.neckline(drop=0.04)])
    sleeves(k, "top", 0.42)
    shoes(k, "shoe", 1.9)
    k.close_paint()

    # The pixel hair: a shell of cubes around the head, open at the face, falling square to
    # the shoulders at the back and sides (the sticker's silhouette).
    bvh = k.bvh()
    hc = k.head_c
    fz = k.face_c.z
    step = 0.024
    hw = k.head_halfw
    neck_z = k.J("neck_01").z

    def occupied(c):
        loc, nrm, _i, d = bvh.find_nearest(c)
        if loc is None:
            return False
        outside = (c - loc).dot(nrm) > 0
        dy = c.y - hc.y
        # The face stays clear: in front, below the fringe line, inside the cheeks.
        if dy < -0.03 and c.z < fz + 0.032 and abs(c.x) < hw * 0.92:
            return False
        if dy < -0.045 and c.z < fz + 0.012:
            return False
        if c.z > neck_z + 0.04 and outside and d < step * 1.45 and c.z > fz - 0.06:
            return True
        # The long fall: a hollow column behind and beside the face, down to the shoulders.
        if neck_z - 0.03 < c.z < fz + 0.02 and dy > -0.04:
            e = (c.x / (hw + 0.006)) ** 2 + ((c.y - hc.y - 0.012) / (hw + 0.01)) ** 2
            if 1.0 <= e < (1 + step / hw * 1.6) ** 2 and not (outside is False and d < 0.003):
                return True
        return False

    for lod, st in (("hi", 0.028), ("lo", 0.04)):
        step = st
        voxel_hair(k, step, occupied, ["hair", "hairDark", "hairLight", "hair"], lod=lod)

    human_face(k)
    my = face_y(k, k.mouth.z)
    k.decal("ellipse", 3.0, -0.3, 0.72, 1.0, fill="ink", mirror=True)
    k.decal("ellipse", 2.75, 0.15, 0.26, 0.26, fill="white", clip=True, mirror=True)
    k.decal("stroke", 3.1, 1.75, 1.0, 0.2, rot=-0.18, fill="brow", mirror=True)
    k.decal("lower", 0.15, my + 0.55, 1.85, 1.35, fill="mouth", ink=1.6)
    k.decal("ellipse", 0.15, my + 0.75, 2.4, 0.42, fill="white", clip=True)
    k.decal("ellipse", 0.45, my - 0.55, 0.9, 0.55, fill="tongue", clip=True)
    k.decal("ellipse", 3.7, -2.5, 1.05, 0.55, fill="blush", mirror=True)
    k.decal("ellipse", 3.0, -1.7, 0.17, 0.17, fill="freckle", mirror=True)
    k.decal("ellipse", 2.3, -2.1, 0.17, 0.17, fill="freckle", mirror=True)



def collar(k, name, h=0.035):
    """A shirt collar: a band round the base of the neck, above the garment's neckline."""
    k.paint(name, "torso+neck", [k.neckline(drop=0.0, keep="above"), k.below(k.J("neck_01").z + h, tilt=-0.35)])


def chest_v(k, name, depth, width, low=None):
    """The open front of a jacket or cardigan, from the throat down `depth` (front only)."""
    z0 = k.neck_front.z - depth - 0.01 if low is None else low
    k.paint(name, "torso", [k.above(z0), k.front(-0.02), k.neckline(drop=-0.005)] + k.vneck(depth, width, keep="in"))


# ---------------------------------------------------------------------------------------
# Aunt Mainnet: older woman, slight; grey hair in a bun, round glasses, lilac dress, pearls.


def aunt(k):
    k.clothe()
    k.open_paint()
    k.fill("skin")
    w = waist_z(k, 0.0)
    k.paint("dress", "torso+neck", [k.neckline(drop=0.03)])
    # The legs under the skirt in its colour (nothing pokes through as skin), stockings below.
    for s_ in "lr":
        k.paint("skirt", "leg_" + s_, [k.leg(s_, 1.3, flip=True)])
    sleeves(k, "dress", 1.2)
    shoes(k, "shoe", 1.9)
    k.close_paint()
    flare(k, "skirt", "skirt", w + 0.015, k.J("calf_l").z - 0.13, ease=0.016, flare_r=0.085, rows=8, segs=28, inner="skirtIn", thigh=0.7)
    hair_cap(k, "hair", "hair", front=0.042, side=0.0, back=-0.06, thick=0.013, top=0.024, edge=0.004)
    sphere_part(k, "bun", Vector((0, k.head_c.y + 0.058, k.head_top + 0.005)), (0.04, 0.038, 0.037), "hair", segs=12, rings=8)
    glasses(k, "ink", r=0.0175)
    pearls(k, "pearl")
    human_face(k)
    my = face_y(k, k.mouth.z)
    k.decal("ellipse", 3.0, -0.25, 0.55, 0.75, fill="ink", mirror=True)
    k.decal("ellipse", 2.8, 0.05, 0.2, 0.2, fill="white", clip=True, mirror=True)
    k.decal("stroke", 3.0, 2.0, 1.0, 0.2, rot=0.12, fill="brow", mirror=True)
    k.decal("arc", 0.0, my + 0.6, 1.7, 0.75, fill="ink", ink=2.2)
    k.decal("ellipse", 3.7, -2.6, 1.0, 0.55, fill="blush", mirror=True)


# ---------------------------------------------------------------------------------------
# Uncle Gen: older man, average; bald on top with grey sides, glasses, brown cardigan over a
# light-blue shirt.


def uncle(k):
    k.clothe()
    k.open_paint()
    k.fill("skin")
    w = waist_z(k, 0.0)
    k.paint("pants", "torso+legs", [k.below(w)])
    k.paint("cardigan", "torso+neck", [k.above(w), k.neckline(drop=0.0)])
    chest_v(k, "band", 0.23, 0.055)
    chest_v(k, "shirt", 0.2, 0.038)
    collar(k, "shirt")
    sleeves(k, "cardigan", 1.93)
    shoes(k, "shoe", 1.9)
    k.close_paint()
    fz = k.face_c.z
    hair_cap(k, "hair", "hair", front=0.0, side=-0.012, back=-0.05, thick=0.011, top=0.011, edge=0.004, region=lambda c, phi: abs(phi) > 1.05 and c.z < fz + 0.05)
    glasses(k, "ink", r=0.018, scale=(1.15, 0.78))
    human_face(k)
    my = face_y(k, k.mouth.z)
    k.decal("arc", 3.0, -0.1, 0.95, 0.6, rot=math.pi, fill="ink", ink=2.6, mirror=True)
    k.decal("stroke", 3.0, 2.0, 1.15, 0.3, rot=0.12, fill="brow", mirror=True)
    k.decal("lower", 0.0, my + 0.7, 2.5, 1.7, fill="mouth", ink=2.0)
    k.decal("ellipse", 0.0, my + 1.45, 3.0, 0.55, fill="white", clip=True)
    k.decal("ellipse", 3.8, -2.6, 1.0, 0.55, fill="blush", mirror=True)


# ---------------------------------------------------------------------------------------
# J. Jonah Bearson: a stocky man's body in a dark suit and red tie, under a bear's head.


def bear_head(k):
    hc = k.head_c
    C = hc + Vector((0, 0.005, 0.025))
    els = [
        ("ELLIPSOID", C, (0.118, 0.11, 0.112), None),
        ("ELLIPSOID", C + Vector((0, -0.025, -0.055)), (0.11, 0.095, 0.075), None),
        ("ELLIPSOID", C + Vector((0, -0.1, -0.052)), (0.058, 0.05, 0.044), None),
        ("ELLIPSOID", C + Vector((0, -0.088, 0.03)), (0.08, 0.026, 0.02), None),
        ("BALL", C + Vector((0.098, 0.012, 0.09)), 0.042, None),
        ("BALL", C + Vector((-0.098, 0.012, 0.09)), 0.042, None),
    ]
    bm = k.metaball("bear", els, resolution=0.011)
    M = C + Vector((0, -0.1, -0.052))
    ears = [C + Vector((0.098, 0.0, 0.09)), C + Vector((-0.098, 0.0, 0.09))]

    def col(c, n):
        d = c - M
        if (d.x / 0.07) ** 2 + (d.y / 0.09) ** 2 + (d.z / 0.06) ** 2 < 1.0 and n.y < 0.2:
            return "muzzle"
        for e in ears:
            if (c - e).length < 0.05 and n.y < -0.35:
                return "muzzle"
        return "fur"

    ob = k.part("bear_head", bm, col, bone="head")
    k.decimate_part(ob, 1500)
    # The grey flat-top between the ears, the nose, the mustache, the cigar.
    tuft = k.metaball("tuft", [("ELLIPSOID", C + Vector((x, -0.005, 0.105 - abs(x) * 0.25)), (0.03, 0.05, 0.022), None) for x in (-0.04, 0.0, 0.04)], resolution=0.01)
    t = k.part("tuft", tuft, "flat", bone="head")
    k.decimate_part(t, 220)
    sphere_part(k, "nose", M + Vector((0, -0.05, 0.022)), (0.028, 0.018, 0.017), "nose", segs=10, rings=6)
    rot_l = Matrix.Rotation(0.35, 3, "Y")
    rot_r = Matrix.Rotation(-0.35, 3, "Y")
    mus = k.metaball(
        "mustache",
        [
            ("ELLIPSOID", M + Vector((0.026, -0.05, -0.006)), (0.034, 0.012, 0.014), rot_l),
            ("ELLIPSOID", M + Vector((-0.026, -0.05, -0.006)), (0.034, 0.012, 0.014), rot_r),
            ("ELLIPSOID", M + Vector((0.052, -0.04, -0.022)), (0.016, 0.01, 0.018), None),
            ("ELLIPSOID", M + Vector((-0.052, -0.04, -0.022)), (0.016, 0.01, 0.018), None),
        ],
        resolution=0.008,
    )
    m = k.part("mustache", mus, "ink", bone="head")
    k.decimate_part(m, 260)
    cigar(k, M + Vector((0.03, -0.045, -0.032)), (0.5, -1.0, -0.22), length=0.11, r=0.009)
    c = piece_face(k, ob, C + Vector((0, 0, 0.012)), 0.11, 0.08, -0.14)
    k.decal("ellipse", 3.4, 0.3, 1.15, 0.95, rot=0.25, fill="ink", mirror=True)
    k.decal("ellipse", 3.05, 0.65, 0.32, 0.32, fill="white", clip=True, mirror=True)
    k.decal("stroke", 3.5, 2.05, 2.0, 0.55, rot=0.45, fill="ink", mirror=True)
    k.decal("arc", 0.0, face_y_at(c, M.z) - 3.4, 2.0, 0.8, rot=math.pi, fill="ink", ink=2.4)
    return ob


def face_y_at(c, z):
    return (z - c.z) * 100


def bearson(k):
    k.clothe(eyes=False)
    k.remove_head()
    k.open_paint()
    k.fill("suit")
    chest_v(k, "shirt", 0.2, 0.05)
    k.paint("shirt", "neck+head", [k.neckline(drop=0.0, keep="above")])
    gloves(k, "fur", 1.92)
    shoes(k, "shoe", 1.9)
    k.close_paint()
    tie(k, "tie", width=0.05, length=0.33)
    bear_head(k)


# ---------------------------------------------------------------------------------------
# Gwei: young athletic woman in a white hooded suit; her mask white with lilac web lines
# and white teardrop lenses; blonde hair under the hood.


def gwei(k):
    k.clothe(eyes=True, ears=1.3)
    k.open_paint()
    k.fill("suit")
    # Black shoulders and sleeves, white gloves (the sticker's suit).
    xs = k.J("clavicle_l").x + (k.J("upperarm_l").x - k.J("clavicle_l").x) * 0.55
    k.paint("panel", "torso", [k.plane((xs, 0, 0), (1, 0, 0))])
    k.paint("panel", "torso", [k.plane((-xs, 0, 0), (-1, 0, 0))])
    for s_ in "lr":
        k.paint("panel", "arm_" + s_, [k.arm(s_, 1.82, flip=True)])
    shoes(k, "shoe", 1.72)
    k.close_paint()
    # The hero's own mask web and lenses (build.py), on her face only.
    origins = B.web_fields(k.body, k.rig, k.marks)
    me = k.body.data
    q = np.zeros(len(me.loops) * 3, dtype=np.float32)
    r = np.zeros(len(me.loops) * 3, dtype=np.float32)
    me.attributes["web_q"].data.foreach_get("vector", q)
    me.attributes["web_r"].data.foreach_get("vector", r)
    q = q.reshape(-1, 3)
    r = r.reshape(-1, 3)
    q[r[:, 2] > 0.5, 1] = 0.0
    me.attributes["web_q"].data.foreach_set("vector", q.ravel())
    # The hero's lens path, scaled to her narrower face.
    B.LENS_UNIT = 0.0024 * 0.88
    B.add_lenses(k.body, k.rig, k.marks, origins["o_mask"])
    names = [m.name if m else "" for m in k.body.data.materials]
    for p in k.body.data.polygons:
        n = names[p.material_index]
        if n == "Lens":
            p.material_index = k.pal("lens")
        elif n == "LensRim":
            p.material_index = k.pal("ink")
    while len(k.body.data.materials) > len(k.palette):
        k.body.data.materials.pop()
    k.lenses = True
    hood_mb(k, "hood", "suit", "lining", open_w=0.08, open_top=0.068, open_bottom=-0.125)
    fz = k.face_c.z
    hair_cap(k, "fringe", "hair", front=0.028, side=0.03, back=0.2, thick=0.012, top=0.008, edge=0.005, taper=0.006, region=lambda c, phi: abs(phi) < 0.75 and c.z < fz + 0.075)
    human_face(k)


# ---------------------------------------------------------------------------------------
# Doc Octochain: middle-aged man; brown bowl cut, round sunglasses, green coat over a dark
# shirt, a steel harness whose four booms end where his chain arms leave him.


def harness(k):
    s3 = k.J("spine_03")
    pz = k.J("pelvis").z
    bvh = k.bvh()
    hit, *_ = bvh.ray_cast(Vector((0, 0.6, s3.z)), Vector((0, -1, 0)))
    back_y = hit.y if hit is not None else s3.y + 0.12
    pack_c = Vector((0, back_y + 0.045, s3.z + 0.02))
    pack = k.box(pack_c, (0.27, 0.08, 0.25), bevel=0.012)
    k.part("pack", pack, "steel", bone="spine_03")
    belt_z = k.J("spine_01").z + 0.02
    hit, *_ = bvh.ray_cast(Vector((0.6, k.J("spine_01").y, belt_z)), Vector((-1, 0, 0)))
    rx = (hit.x if hit is not None else 0.17) + 0.012
    k.part("belt", k.torus(Vector((0, k.J("spine_01").y, belt_z)), rx, 0.014, segs=20, rsegs=6, scale=(1.0, 0.82, 1.0)), "steel")
    u = 1 / K_GAME
    socks = {
        "armUL": ("spine_03", Vector((27.5 * u, pack_c.y, pz + 10 * u)), Vector((0.12, pack_c.y, pack_c.z))),
        "armUR": ("spine_03", Vector((-27.5 * u, pack_c.y, pz + 10 * u)), Vector((-0.12, pack_c.y, pack_c.z))),
        "armLL": ("pelvis", Vector((15 * u, back_y + 0.02, pz - 12 * u)), Vector((rx * 0.7, back_y, belt_z))),
        "armLR": ("pelvis", Vector((-15 * u, back_y + 0.02, pz - 12 * u)), Vector((-rx * 0.7, back_y, belt_z))),
    }
    for name, (bone, at, root) in socks.items():
        mid = root.lerp(at, 0.5)
        k.part("boom_" + name, k.tube([root, mid + Vector((0, 0.03, 0.02)), at], [0.016, 0.014, 0.013], segs=6), "steel", bone=bone)
        k.part("sock_" + name, k.sphere(at, (0.032, 0.032, 0.032), segs=10, rings=6), "steel", bone=bone)
        # glTF axes: x left, y up, z forward (= −y here).
        k.sockets[name] = {"bone": bone, "at": [round(at.x, 5), round(at.z, 5), round(-at.y, 5)]}


K_GAME = 88 / 1.886


def doc(k):
    k.clothe()
    k.open_paint()
    k.fill("skin")
    w = waist_z(k, 0.0)
    k.paint("pants", "torso+legs", [k.below(w)])
    k.paint("coat", "torso+neck", [k.above(w), k.neckline(drop=0.0)])
    chest_v(k, "shirt", 0.3, 0.055, low=w)
    collar(k, "shirt")
    sleeves(k, "coat", 1.94)
    shoes(k, "shoe", 1.9)
    # The thighs under the coat's tails in its green, so a stride never shows trouser through them.
    for s_ in "lr":
        k.paint("coat", "leg_" + s_, [k.leg(s_, 0.8, flip=True)])
    k.close_paint()
    flare(k, "coat_tails", "coat", w + 0.035, k.J("calf_l").z + 0.1, ease=0.022, flare_r=0.05, rows=6, segs=26, open_front=0.42, inner="coatIn", thigh=0.95)
    hair_cap(k, "hair", "hair", front=0.024, side=-0.012, back=-0.05, thick=0.015, top=0.022, edge=0.009, taper=0.005)
    glasses(k, "ink", r=0.0205, lens="shades", gap=0.014)
    harness(k)
    human_face(k)
    my = face_y(k, k.mouth.z)
    k.decal("lower", 0.4, my + 0.4, 1.9, 0.75, rot=0.08, fill="mouth", ink=2.0)
    k.decal("ellipse", 3.9, -2.7, 1.1, 0.55, fill="blush", mirror=True)


# ---------------------------------------------------------------------------------------
# Sandwich Man: a man in a black suit and red tie, with a burger for a head.


def burger_head(k):
    # The bread sits on the neck.
    C = Vector((k.head_c.x, k.head_c.y + 0.005, k.J("head").z + 0.085))
    parts = []
    bread = k.box(C + Vector((0, 0, -0.08)), (0.24, 0.21, 0.062), bevel=0.022)
    k.part("bread", bread, "bread", bone="head")
    cheese = k.box(C + Vector((0, 0, -0.044)), (0.235, 0.235, 0.008), rot=Matrix.Rotation(math.pi / 4, 3, "Z"))
    drips = [k.cylinder(C + Vector((x, y, -0.054)), 0.008, 0.022, segs=6, r2=0.005) for x, y in ((0.0, -0.166), (0.162, 0.0), (-0.162, 0.0))]
    k.part("cheese", k.join_bm(cheese, *drips), "cheese", bone="head")
    k.part("tomato", k.cylinder(C + Vector((0, 0, -0.028)), 0.138, 0.022, segs=20), "tomato", bone="head")
    # Lettuce: a frilled disc.
    bm = bmesh.new()
    n = 48
    top, bot = [], []
    for i in range(n):
        a = 2 * math.pi * i / n
        rr = 0.148 + 0.009 * math.sin(a * 12)
        dz = 0.004 * math.sin(a * 12 + 1.0)
        top.append(bm.verts.new((C.x + math.sin(a) * rr, C.y - math.cos(a) * rr, C.z - 0.012 + dz)))
        bot.append(bm.verts.new((C.x + math.sin(a) * rr * 0.97, C.y - math.cos(a) * rr * 0.97, C.z - 0.022 + dz)))
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((top[i], top[j], bot[j], bot[i]))
    bm.faces.new(top)
    bm.faces.new(list(reversed(bot)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    k.part("lettuce", bm, "lettuce", bone="head")
    # The bun: a dome, flat underneath.
    bun = k.sphere(C + Vector((0, 0, -0.006)), (0.152, 0.142, 0.115), segs=20, rings=12)
    for v in bun.verts:
        if v.co.z < C.z - 0.004:
            v.co.z = C.z - 0.004
    bmesh.ops.remove_doubles(bun, verts=bun.verts[:], dist=1e-4)
    from mathutils.bvhtree import BVHTree

    dome = BVHTree.FromBMesh(bun)
    seeds = []
    for az, el in ((-0.55, 0.55), (0.0, 0.62), (0.55, 0.55), (-0.95, 0.3), (0.95, 0.3), (-0.3, 1.0), (0.3, 1.0), (0.0, 1.35), (-0.25, 0.3), (0.3, 0.32)):
        d = Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el)))
        hit, nrm, *_ = dome.ray_cast(C + d * 0.4, -d, 0.5)
        if hit is None:
            continue
        rot = Vector((0, 0, 1)).rotation_difference(nrm).to_matrix() @ Matrix.Rotation(az * 2.1, 3, "Z")
        seeds.append(k.sphere(hit, (0.011, 0.006, 0.0035), segs=6, rings=4, rot=rot))
    ob = k.part("bun", bun, "bun", bone="head")
    k.part("seeds", k.join_bm(*seeds), "seed", bone="head")
    c = piece_face(k, ob, C + Vector((0, 0, 0.035)), 0.14, 0.08, -0.05)
    k.decal("ellipse", 3.4, -0.2, 1.75, 1.45, rot=0.32, fill="white", ink=2.4, mirror=True)
    k.decal("ellipse", 3.1, -0.55, 0.7, 0.7, fill="ink", clip=True, mirror=True)
    k.decal("ellipse", 2.9, -0.25, 0.2, 0.2, fill="white", clip=True, mirror=True)
    k.decal("stroke", 3.6, 1.85, 2.1, 0.5, rot=0.42, fill="ink", mirror=True)
    k.decal("arc", 0.0, -4.4, 1.9, 0.9, rot=math.pi, fill="ink", ink=2.6)
    return ob


def sandwich(k):
    k.clothe(eyes=False)
    k.remove_head(below_z=k.J("neck_01").z + 0.03)
    k.open_paint()
    k.fill("suit")
    chest_v(k, "shirt", 0.22, 0.048)
    k.paint("shirt", "neck+head", [k.neckline(drop=0.0, keep="above")])
    gloves(k, "skin", 1.93)
    shoes(k, "shoe", 1.9)
    k.close_paint()
    tie(k, "tie", width=0.046, length=0.36)
    burger_head(k)


# ---------------------------------------------------------------------------------------
# Gas Goblin: a lean man in a purple suit and gloves, a goblin's green head with pointed
# ears and a grin under a purple hood, riding his glider, a fuel nozzle in his fist.


def goblin_head(k):
    hc = k.head_c
    C = hc + Vector((0, -0.004, 0.0))
    els = [
        ("ELLIPSOID", C + Vector((0, 0.005, 0.012)), (0.082, 0.092, 0.098), None),
        ("ELLIPSOID", C + Vector((0, -0.03, -0.062)), (0.064, 0.064, 0.058), None),
        ("ELLIPSOID", C + Vector((0, -0.05, -0.112)), (0.026, 0.03, 0.036), None),
        ("BALL", C + Vector((0.048, -0.05, -0.012)), 0.034, None),
        ("BALL", C + Vector((-0.048, -0.05, -0.012)), 0.034, None),
        ("ELLIPSOID", C + Vector((0, -0.098, -0.04)), (0.013, 0.044, 0.016), Matrix.Rotation(-0.55, 3, "X")),
        ("ELLIPSOID", C + Vector((0, -0.078, 0.034)), (0.07, 0.022, 0.018), None),
    ]
    bm = k.metaball("goblin", els, resolution=0.009)
    ob = k.part("goblin_head", bm, "skin", bone="head")
    k.decimate_part(ob, 1300)
    for sgn in (1, -1):
        base = C + Vector((sgn * 0.075, 0.0, 0.0))
        pts = [base, base + Vector((sgn * 0.06, 0.01, 0.022)), base + Vector((sgn * 0.12, 0.018, 0.045)), base + Vector((sgn * 0.17, 0.024, 0.066))]
        ear = k.tube(pts, [0.03, 0.022, 0.012, 0.002], segs=7)
        bmesh.ops.scale(ear, vec=Vector((1.0, 0.4, 1.0)), space=Matrix.Translation(-base), verts=ear.verts[:])
        k.part("ear", ear, "skin", bone="head")
    # The hood over the back and top of his head, its tip curling back.
    hood_ob = k.shell(
        "hood",
        lambda c, f, head: c.y > C.y + 0.004 or c.z > C.z + 0.062,
        lambda p: 0.014,
        "suit",
        edge=0.005,
        smooth=6,
        taper=0.008,
        bone="head",
        inner_pal="dark",
        src=ob,
    )
    del hood_ob
    tip = k.tube([C + Vector((0, 0.06, 0.09)), C + Vector((0, 0.12, 0.12)), C + Vector((0, 0.19, 0.115)), C + Vector((0, 0.24, 0.08))], [0.05, 0.03, 0.016, 0.003], segs=8)
    k.part("hood_tip", tip, "suit", bone="head")
    c = piece_face(k, ob, C + Vector((0, 0, 0.0)), 0.085, 0.07, -0.14)
    k.decal("ellipse", 3.3, 0.6, 1.6, 0.75, rot=0.25, fill="eye", ink=2.4, mirror=True)
    k.decal("ellipse", 3.2, 0.6, 0.22, 0.6, fill="ink", clip=True, mirror=True)
    k.decal("stroke", 3.5, 2.1, 1.8, 0.4, rot=0.45, fill="ink", mirror=True)
    k.decal("lower", 0.0, -4.4, 4.2, 2.6, fill="white", ink=2.4)
    k.decal("teeth", 0.0, -5.6, 4.0, 1.3, fill="ink", clip=True, n=7, amp=0.06)
    return ob


def glider(k):
    """The bat-wing deck under his feet, on its own bone (the animator tilts it)."""
    u = 1 / K_GAME
    half = [(0, 17), (7, 12), (27, 3), (24, -2), (19, -7), (14, -3), (8, -9), (0, -6)]
    pts = half + [(-x, z) for x, z in reversed(half[1:-1])]
    bm = bmesh.new()
    top = [bm.verts.new((x * u, -z * u, -0.004)) for x, z in pts]
    bot = [bm.verts.new((x * u, -z * u, -0.05)) for x, z in pts]
    n = len(pts)
    bm.faces.new(top)
    bm.faces.new(list(reversed(bot)))
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((top[i], bot[i], bot[j], top[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    k.part("glider", bm, "glider", bone="glider")
    k.part("glider_dome", k.sphere(Vector((0, 5 * u, -0.03)), (0.085, 0.1, 0.05), segs=10, rings=6), "skin", bone="glider")
    k.part("glider_nose", k.box(Vector((0, -13 * u, -0.035)), (0.1, 0.08, 0.04), bevel=0.01), "steel", bone="glider")


def nozzle(k):
    """A fuel pump nozzle in his right fist (the sticker's)."""
    h = k.J("hand_r")
    m = k.J("middle_01_r")
    d = (m - h).normalized()
    palm = h.lerp(m, 0.55)
    side = d.cross(Vector((0, -1, 0))).normalized()
    grip = k.box(palm + side * 0.0, (0.035, 0.035, 0.035), bevel=0.006)
    bmesh.ops.scale(grip, vec=Vector((1.0, 1.0, 1.0)), verts=grip.verts[:])
    k.part("nozzle_grip", grip, "glider", bone="hand_r")
    a = palm + Vector((0, -0.02, 0))
    pipe = k.tube([a, a + Vector((0, -0.07, 0.01)), a + Vector((0, -0.13, -0.03))], [0.009, 0.008, 0.007], segs=6)
    k.part("nozzle_pipe", pipe, "steel", bone="hand_r")


def goblin(k):
    k.clothe(eyes=False)
    k.remove_head()
    k.open_paint()
    k.fill("suit")
    k.paint("dark", "torso+legs", [k.below(waist_z(k, 0.0))])
    gloves(k, "glove", 1.8)
    shoes(k, "glove", 1.55)
    k.close_paint()
    # The hood's cowl round his neck and onto the shoulders.
    nz = k.J("neck_01").z
    ny = k.J("neck_01").y
    k.shell(
        "cowl",
        lambda c, f, head: nz - 0.07 < c.z < nz + 0.055 and math.hypot(c.x, c.y - ny) < 0.12 + (nz - c.z) * 1.2,
        lambda p: 0.012,
        "suit",
        edge=0.004,
        smooth=8,
        taper=0.01,
        inner_pal="dark",
    )
    goblin_head(k)
    add_bone(k, "glider", "Root", (0, 0, 0), (0, 0, 0.1))
    glider(k)
    nozzle(k)


def add_bone(k, name, parent, head, tail):
    """An extra bone (Gas Goblin's glider) on the skeleton."""
    import bpy

    rig = k.rig
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    eb = rig.data.edit_bones.new(name)
    eb.head = Vector(head)
    eb.tail = Vector(tail)
    eb.roll = 0.0
    eb.parent = rig.data.edit_bones[parent]
    eb.use_deform = True
    bpy.ops.object.mode_set(mode="OBJECT")
    k.bones = {b.name: b for b in rig.data.bones}


# ---------------------------------------------------------------------------------------
# The Sybil: an athletic man, all glossy black, big white jagged eyes and a fanged grin.


def sybil(k):
    k.clothe(ears=1.6, mask=True)
    k.open_paint()
    k.fill("suit")
    k.close_paint()
    human_face(k, top=0.06, half_w=0.08)
    my = face_y(k, k.mouth.z)
    k.decal("jag", 3.7, 1.3, 3.6, 2.5, rot=0.55, fill="white", ink=2.2, mirror=True, n=5, amp=0.14)
    k.decal("lower", 0.0, my + 1.6, 5.0, 3.2, fill="mouth", ink=2.2)
    k.decal("teeth", 0.0, my - 0.0, 4.9, 1.6, fill="white", clip=True, n=6, amp=0.42)


# ---------------------------------------------------------------------------------------
# The Right-Clicker (Case file 001): a slim young man in a dark hoodie with the hood up, its
# brim shading his eyes, black gloves, joggers and dark sneakers; a white cursor badge on his
# chest and an oversized mouse-pointer arrow in his right fist. "Saves everything. Owns nothing."

# The classic pointer arrow, in pixels of a 12 × 20 cursor (x right, y down from the tip).
CURSOR = [(0.0, 0.0), (0.0, 17.0), (4.0, 13.0), (7.0, 19.5), (9.6, 18.4), (6.6, 12.0), (12.0, 12.0)]
# The middle of the stem's end, where the fist holds it.
CURSOR_TAIL = (8.3, 18.95)


def cursor_mesh(k, grip, axis, up, length, thick, front="cursor", side="ink"):
    """An extruded pointer arrow: its stem's end at `grip`, its tip `length` metres along
    `axis`, the arrow's plane spanned by `axis` and `up` (the stem's notch toward −up), `thick`
    thick. Front and back faces in `front`, the walls in `side` (its ink rim seen edge-on)."""
    tx, ty = CURSOR_TAIL
    ax, ay = -tx, -ty
    al = math.hypot(ax, ay)
    ax, ay = ax / al, ay / al
    bx, by = -ay, ax  # perpendicular, toward the arrow's straight edge
    s = length / al
    axis = Vector(axis).normalized()
    up = (Vector(up) - axis * Vector(up).dot(axis)).normalized()
    normal = axis.cross(up).normalized()
    bm = bmesh.new()
    rings = []
    for off in (-thick / 2, thick / 2):
        ring = []
        for x, y in CURSOR:
            dx, dy = x - tx, y - ty
            a = (dx * ax + dy * ay) * s
            b = (dx * bx + dy * by) * s
            ring.append(bm.verts.new(grip + axis * a + up * b + normal * off))
        rings.append(ring)
    back, frontr = rings
    n = len(CURSOR)
    caps = [bm.faces.new(list(reversed(back))), bm.faces.new(frontr)]
    walls = []
    for i in range(n):
        j = (i + 1) % n
        walls.append(bm.faces.new((back[i], back[j], frontr[j], frontr[i])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    # The caps are concave: triangulate them (the walls stay quads).
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4])
    names = []
    for f in bm.faces:
        names.append(front if abs(f.normal.dot(normal)) > 0.7 else side)
    return bm, names


def cursor_prop(k):
    """The giant cursor in his right fist: its stem through the grip, the arrow out along the
    hand like a pistol's barrel, its plane upright when the thumb is up."""
    h = k.J("hand_r")
    m = k.J("middle_01_r")
    d = (m - h).normalized()
    palm = h.lerp(m, 0.62)
    # The palm's normal is the hand bone's local Z; the thumb side lies across it.
    mat = k.bones["hand_r"].matrix_local.to_3x3()
    pn = Vector(mat.col[2]).normalized()
    thumb = (k.J("thumb_01_r") - h)
    up = pn.cross(d).normalized()
    if up.dot(thumb) < 0:
        up = -up
    grip = palm + pn * 0.012 - d * 0.03
    bm, names = cursor_mesh(k, grip, d, up, 0.56, 0.038)
    ob = k.part("cursor", bm, "cursor", bone="hand_r", flat_shade=True)
    for p, nm in zip(ob.data.polygons, names):
        p.material_index = k.pal(nm)
    return ob


def chest_badge(k):
    """A small white cursor printed on the hoodie's chest (left of centre)."""
    bvh = k.bvh()
    s3 = k.J("spine_03")
    at = Vector((0.07, 0, s3.z + 0.055))
    hit, nrm, *_ = bvh.ray_cast(Vector((at.x, -0.5, at.z)), Vector((0, 1, 0)))
    if hit is None:
        return None
    grip = Vector(hit) + Vector((0, -0.008, 0)) + Vector((0.02, 0, -0.045))
    # Pointing up and to his right (the tip toward the collarbone), flat on the chest.
    axis = Vector((-0.38, 0, 0.92))
    bm, names = cursor_mesh(k, grip, axis, Vector((0.92, 0, 0.38)), 0.1, 0.004, front="badge", side="badge")
    ob = k.part("badge", bm, "badge", flat_shade=True)
    return ob


def drawstrings(k, pal):
    """The hood's two strings, hanging from either side of the throat."""
    bvh = k.bvh()
    nf = k.neck_front
    parts = []
    for s_ in (1, -1):
        top = Vector((s_ * 0.032, nf.y - 0.006, nf.z - 0.035))
        hit, *_ = bvh.ray_cast(Vector((top.x, -0.5, top.z - 0.1)), Vector((0, 1, 0)))
        bot_y = (hit.y if hit is not None else top.y) - 0.008
        pts = [top, Vector((s_ * 0.036, (top.y + bot_y) / 2 - 0.004, top.z - 0.06)), Vector((s_ * 0.038, bot_y, top.z - 0.13))]
        parts.append(k.tube(pts, [0.0045, 0.0045, 0.006], segs=5))
    return k.part("strings", k.join_bm(*parts), pal)


def right_clicker(k):
    k.clothe(ears=1.0)
    k.open_paint()
    k.fill("hoodie")
    w = waist_z(k, -0.02)
    k.paint("pants", "torso+legs", [k.below(w)])
    # The hoodie's ribbed hem and the kangaroo pocket on its front.
    k.paint("rib", "torso", [k.above(w), k.below(w + 0.035)])
    k.paint("pocket", "torso", [k.above(w + 0.045), k.below(w + 0.17), k.front(-0.02), k.plane((0.105, 0, 0), (-1, 0, 0)), k.plane((-0.105, 0, 0), (1, 0, 0))])
    k.paint("skin", "head+neck", [k.neckline(drop=-0.01, keep="above")])
    sleeves(k, "hoodie", 1.86)
    gloves(k, "glove", 1.86)
    shoes(k, "shoe", 1.9)
    k.close_paint()
    fz = k.face_c.z
    # Dark hair under the hood (any gap at the brim shows hair, not scalp).
    hair_cap(k, "hair", "hair", front=0.03, side=-0.01, back=-0.06, thick=0.008, top=0.01, edge=0.003, region=lambda c, phi: c.z < fz + 0.2)
    # A deep hood: wide ease, its brim low over the brow so the eyes sit in its shade.
    # The brim's peak: a ridge forward over the brow, so the hood hangs over the face.
    peak = [("ELLIPSOID", Vector((0, k.face_c.y + 0.012, fz + 0.062)), (0.085, 0.05, 0.04), Matrix.Rotation(0.35, 3, "X"))]
    hood_mb(k, "hood", "hoodie", "lining", open_w=0.084, open_top=0.036, open_bottom=-0.15, ease=0.03, cowl=(0.14, 0.13, 0.08), extra=peak)
    drawstrings(k, "string")
    chest_badge(k)
    cursor_prop(k)
    human_face(k, top=0.05)
    my = face_y(k, k.mouth.z)
    # The hood's shade across the upper face (the sticker's flat shadow), the eyes glinting in it.
    k.decal("ellipse", 0.0, 6.2, 10.5, 8.6, fill="shade")
    k.decal("ellipse", 3.05, -0.2, 1.45, 0.72, rot=0.12, fill="white", ink=2.0, mirror=True)
    k.decal("ellipse", 2.7, -0.28, 0.36, 0.46, fill="ink", clip=True, mirror=True)
    k.decal("stroke", 3.0, 1.35, 1.3, 0.3, rot=0.38, fill="ink", mirror=True)
    # A sly, lopsided smirk.
    k.decal("arc", 0.8, my + 0.9, 1.9, 0.75, rot=0.2, fill="ink", ink=2.4)
    k.decal("stroke", 2.75, my + 1.05, 0.35, 0.12, rot=1.1, fill="ink")


# ---------------------------------------------------------------------------------------
# The table

CAST = {
    "aunt-mainnet": {
        "macros": {"gender": 0.0, "age": 0.85, "muscle": 0.3, "weight": 0.42, "height": 0.3, "proportions": 0.4, "cupsize": 0.45, "firmness": 0.3, "race": {"asian": 0.1, "caucasian": 0.3, "african": 0.6}},
        "details": {},
        "palette": {
            "ink": INK,
            "skin": "#B9805A",
            "hair": "#DADAD6",
            "dress": "#C9B6EF",
            "skirt": "#9F86D6",
            "skirtIn": "#7E68B4",
            "shoe": "#4A3A5A",
            "pearl": "#FFFFFF",
            "brow": "#6E6E6A",
            "blush": "#DC7880",
            "white": "#FFFFFF",
        },
        "flat": ["ink"],
        "tris": (7000, 2600),
        "build": aunt,
    },
    "uncle-gen": {
        "macros": {"gender": 1.0, "age": 0.85, "muscle": 0.4, "weight": 0.58, "height": 0.45, "proportions": 0.4, "race": {"asian": 0.05, "caucasian": 0.9, "african": 0.05}},
        "details": {"stomach/stomach-pregnant-incr": 0.25},
        "palette": {
            "ink": INK,
            "skin": "#F3C6A2",
            "hair": "#CACAC6",
            "cardigan": "#8C5A3A",
            "band": "#6E4429",
            "shirt": "#A9CFF2",
            "pants": "#5A4F46",
            "shoe": "#3A2A20",
            "brow": "#8F8F8B",
            "mouth": "#8B3434",
            "blush": "#F59AAA",
            "white": "#FFFFFF",
        },
        "flat": ["ink"],
        "tris": (7000, 2600),
        "build": uncle,
    },
    "bearson": {
        "macros": {"gender": 1.0, "age": 0.7, "muscle": 0.55, "weight": 0.82, "height": 0.5, "proportions": 0.3, "race": {"asian": 0.2, "caucasian": 0.6, "african": 0.2}},
        "details": {"stomach/stomach-pregnant-incr": 0.2},
        "palette": {
            "ink": INK,
            "suit": "#3B4150",
            "shirt": "#FFFFFF",
            "tie": "#C9453B",
            "fur": "#9C6B43",
            "muzzle": "#DDB98C",
            "flat": "#BDBDB8",
            "nose": "#241A14",
            "cigar": "#7B4A2B",
            "band": "#E3B341",
            "ember": "#F47A3B",
            "shoe": "#22252C",
            "white": "#FFFFFF",
        },
        "flat": ["ink"],
        "gloss": ["nose"],
        "tris": (7600, 2800),
        "build": bearson,
    },
    "gwei": {
        "macros": {"gender": 0.0, "age": 0.45, "muscle": 0.7, "weight": 0.42, "height": 0.6, "proportions": 0.8, "cupsize": 0.45, "race": {"asian": 0.2, "caucasian": 0.7, "african": 0.1}},
        "details": {"torso/measure-waist-circ-decr": 0.2},
        "palette": {
            "ink": INK,
            "suit": "#FFFFFF",
            "panel": "#1E1E1E",
            "lining": "#F3A6C8",
            "hair": "#F8D978",
            "shoe": "#2DB3A5",
            "lens": "#FFFFFF",
            "web": "#B6A2EC",
        },
        "flat": ["ink", "lens"],
        "web": True,
        "tris": (7600, 2800),
        "build": gwei,
    },
    "doc-octochain": {
        "macros": {"gender": 1.0, "age": 0.68, "muscle": 0.45, "weight": 0.72, "height": 0.55, "proportions": 0.4, "race": {"asian": 0.2, "caucasian": 0.7, "african": 0.1}},
        "details": {"stomach/stomach-pregnant-incr": 0.35},
        "palette": {
            "ink": INK,
            "skin": "#E2A877",
            "hair": "#6E4527",
            "coat": "#4F9A4E",
            "coatIn": "#3B7A3A",
            "shirt": "#3A3D44",
            "pants": "#3C3F48",
            "shoe": "#5A3A22",
            "shades": "#1C1D22",
            "steel": "#AEB4BD",
            "mouth": "#7E2A2E",
            "blush": "#F59AAA",
            "white": "#FFFFFF",
        },
        "flat": ["ink"],
        "gloss": ["shades", "steel"],
        "tris": (8200, 2900),
        "build": doc,
    },
    "sandwich-man": {
        "macros": {"gender": 1.0, "age": 0.6, "muscle": 0.6, "weight": 0.55, "height": 0.62, "proportions": 0.5},
        "details": {},
        "palette": {
            "ink": INK,
            "suit": "#2A2A2D",
            "shirt": "#FFFFFF",
            "tie": "#C9302C",
            "skin": "#E8B48C",
            "shoe": "#141416",
            "bun": "#EDB15E",
            "seed": "#FFF4D6",
            "lettuce": "#78C043",
            "tomato": "#E5483A",
            "cheese": "#F8C93A",
            "bread": "#E8B66C",
            "white": "#FFFFFF",
        },
        "flat": ["ink"],
        "tris": (8000, 2900),
        "build": sandwich,
    },
    "gas-goblin": {
        "macros": {"gender": 1.0, "age": 0.55, "muscle": 0.45, "weight": 0.28, "height": 0.62, "proportions": 0.5},
        "details": {},
        "palette": {
            "ink": INK,
            "suit": "#7C4DCC",
            "dark": "#5B35A1",
            "glove": "#4A2C86",
            "skin": "#8DC63F",
            "eye": "#F7D23E",
            "glider": "#F7D23E",
            "steel": "#B9BEC6",
            "white": "#FFFFFF",
        },
        "flat": ["ink"],
        "gloss": ["steel"],
        "tris": (8200, 2900),
        "build": goblin,
    },
    "sybil": {
        "macros": {"gender": 1.0, "age": 0.5, "muscle": 0.95, "weight": 0.55, "height": 0.7, "proportions": 0.9},
        "details": {"torso/torso-vshape-incr": 0.5, "torso/measure-shoulder-dist-incr": 0.3, "neck/measure-neck-circ-incr": 0.3},
        "palette": {
            "ink": INK,
            "suit": "#18181B",
            "white": "#FFFFFF",
            "mouth": "#7A1C2B",
        },
        "flat": ["ink"],
        "gloss": ["suit"],
        "tris": (7400, 2800),
        "min": 1300,
        "build": sybil,
    },
    "mary-jpeg": {
        "macros": {"gender": 0.0, "age": 0.43, "muscle": 0.45, "weight": 0.36, "height": 0.62, "proportions": 0.65, "cupsize": 0.45, "race": {"asian": 0.15, "caucasian": 0.75, "african": 0.1}},
        "details": {"torso/measure-waist-circ-decr": 0.3},
        "palette": {
            "ink": INK,
            "skin": "#F8D5BC",
            "top": "#2DB3A5",
            "jeans": "#3B5BA8",
            "shoe": "#FFFFFF",
            "hair": "#E8492F",
            "hairDark": "#C23722",
            "hairLight": "#F7774F",
            "brow": "#B33A22",
            "mouth": "#7E2A2E",
            "tongue": "#EE7D86",
            "blush": "#F59AAA",
            "freckle": "#C2703F",
            "white": "#FFFFFF",
        },
        "flat": ["ink"],
        "tris": (7000, 2600),
        "build": mary,
    },
    "right-clicker": {
        "macros": {"gender": 1.0, "age": 0.5, "muscle": 0.42, "weight": 0.3, "height": 0.58, "proportions": 0.55, "race": {"asian": 0.35, "caucasian": 0.35, "african": 0.3}},
        "details": {},
        "palette": {
            "ink": INK,
            "skin": "#D9A07A",
            "shade": "#8A5C49",
            "hoodie": "#363A4D",
            "rib": "#2A2D3B",
            "pocket": "#41465C",
            "lining": "#14151C",
            "pants": "#1E2029",
            "glove": "#18191E",
            "shoe": "#3A3D4A",
            "hair": "#1A1410",
            "string": "#C9CBD6",
            "badge": "#FFFFFF",
            "cursor": "#FFFFFF",
            "white": "#FFFFFF",
        },
        "flat": ["ink", "badge"],
        "tris": (7000, 2600),
        "build": right_clicker,
    },
}
