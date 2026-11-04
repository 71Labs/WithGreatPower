"""
The city's people for build_cast.py: eight civilian bodies made the same way as the cast (an
MPFB body on the hero's 53-bone skeleton, painted clothes, shells and props), for the crowds
on the rooftops, the sidewalks and round the stops (apps/wgp/src/game3d/scene/crowd/).

    blender -b -P launch/brand/hero/build_cast.py -- --who civ-office     → apps/wgp/public/models/civ-office{,-lo}.glb

They differ in sex, age (9 to 75), build (slim to heavy), height, face (MakeHuman's race
mix), hair and clothes. Colour is the game's: every body shares one palette layout (SLOTS),
and the file lists the colours each slot may take (`looks`: skin tones, hair, the clothes),
so one body file dresses many people. Each instance picks its own from the night's seed.

Shared with the cast: the painted comic face (one decal set for all of them, on each body's
face coordinates normalised to the same eye spacing and mouth line), the cel shading, the ink
hull and the baked AO. Two levels of detail per body: "Body" (about 2,400 triangles, near)
and "BodyLo" (about 900, far, its seams no longer locked). The fingers are folded into the
hands (the crowd never poses them), so the game skins a person with 23 bones.
"""

import math

import bmesh
from mathutils import Matrix, Vector

import cast as C

INK = "#141414"

# One palette layout for every civilian (index 0 is ink): the game recolours the slots per
# person, and the shader's flat and glossy flags are per slot, so they hold for all of them.
SLOTS = ["ink", "skin", "hair", "brow", "top", "trim", "bottom", "shoe", "accent", "accent2", "white", "mouth", "blush", "lens", "inner", "sole"]

# The face every civilian wears, in cm on the face's plane from between the eyes: these
# bodies' faces are normalised to an eye at x = 3.0 and the mouth's line at y = MOUTH_Y.
EYE_X = 3.0
MOUTH_Y = -6.2

# Skin tones, light to deep (realistic, unsaturated), and natural hair.
SKIN = ["#F6D5BF", "#EFC3A2", "#E2AA83", "#CB8D63", "#B07450", "#8E5A3A", "#6E4329", "#4F2F1D"]
HAIR = ["#1C1612", "#2F2018", "#4A2F1E", "#6B4529", "#8F6238", "#C29A5B", "#E0C27E", "#9E3F25"]
GREY = ["#B9B8B3", "#D6D5D0", "#8F8E8A", "#E8E7E2"]
DYED = ["#2DB3A5", "#E86BA8", "#7C5CD6", "#F2C230"]
BLUSH = ["#E88A8A", "#D97B7B", "#F0A0A0"]


def palette(**own):
    """The default colours (the first of each slot's looks)."""
    base = {
        "ink": INK,
        "skin": SKIN[2],
        "hair": HAIR[2],
        "brow": HAIR[1],
        "top": "#2F6FD6",
        "trim": "#F4F1EA",
        "bottom": "#2C3F73",
        "shoe": "#22252C",
        "accent": "#C9302C",
        "accent2": "#F2C230",
        "white": "#FFFFFF",
        "mouth": "#7E2A2E",
        "blush": BLUSH[0],
        "lens": "#1C1D22",
        "inner": "#1F2440",
        "sole": "#F4F1EA",
    }
    base.update(own)
    return {k: base[k] for k in SLOTS}


def face(k):
    """The shared painted face: eyes with a highlight, brows, a small smile, blush."""
    C.human_face(k)
    # Normalise this face to the shared layout: eyes at ±EYE_X, the mouth on MOUTH_Y.
    eye = abs(k.eye_l.x - k.face_c.x) * 100
    mouth = (k.mouth.z - k.face_c.z) * 100
    k.face_sx = EYE_X / max(eye, 1.0)
    k.face_sy_up = k.face_sx
    k.face_sy_down = MOUTH_Y / min(mouth, -1.0)
    print(f"[civ] {k.who}: eye x {eye:.2f} cm, mouth y {mouth:.2f} cm → scale x {k.face_sx:.3f}, below {k.face_sy_down:.3f}")
    my = MOUTH_Y
    k.decal("ellipse", EYE_X, -0.25, 0.6, 0.82, fill="ink", mirror=True)
    k.decal("ellipse", EYE_X - 0.2, 0.08, 0.21, 0.21, fill="white", clip=True, mirror=True)
    k.decal("stroke", EYE_X, 1.95, 1.05, 0.24, rot=0.1, fill="brow", mirror=True)
    k.decal("arc", 0.0, my + 0.55, 1.55, 0.6, fill="ink", ink=2.0)
    k.decal("ellipse", EYE_X + 0.75, -2.55, 0.95, 0.5, fill="blush", mirror=True)


def hair(k, front, side, back, name="hair", pal="hair", target=380, smooth=3, **kw):
    """A hair shell (cast.hair_cap), smoothed less (a thin cap keeps clear of the scalp) and
    thinned to a crowd's budget."""
    ob = C.hair_cap(k, name, pal, front=front, side=side, back=back, smooth=smooth, **kw)
    if ob is not None:
        k.decimate_part(ob, target)
    return ob


def armholes(k, f):
    """A sleeveless garment's armpit height and its two armhole planes (kept inside x = ±xs,
    `f` of the way from the clavicle's root to the shoulder joint)."""
    xs = k.J("clavicle_l").x + (k.J("upperarm_l").x - k.J("clavicle_l").x) * f
    return k.J("spine_03").z + 0.05, [k.plane((xs, 0, 0), (-1, 0, 0)), k.plane((-xs, 0, 0), (1, 0, 0))]


def fold_fingers(k):
    """Recorded for build_cast: merge every finger's weights into its hand before export."""
    k.fold_fingers = True


def phone(k, side="r"):
    """A phone in the palm (a dark slab, its screen in `lens`)."""
    # The hand bone's own frame: y along the hand, z out of the palm (posing.py's palm).
    frame = k.bones["hand_" + side].matrix_local.to_3x3()
    h = k.J("hand_" + side)
    m = k.J("middle_01_" + side)
    palm = h.lerp(m, 0.55) + frame.col[2].normalized() * 0.022
    slab = k.box(palm, (0.036, 0.074, 0.009), rot=frame.normalized(), bevel=0.003)
    k.part("phone", slab, "lens", bone="hand_" + side)
    k.phone = True


def backpack(k, pal="accent", strap="inner"):
    s3 = k.J("spine_03")
    bvh = k.bvh()
    hit, *_ = bvh.ray_cast(Vector((0, 0.6, s3.z - 0.02)), Vector((0, -1, 0)))
    back_y = hit.y if hit is not None else s3.y + 0.11
    c = Vector((0, back_y + 0.06, s3.z - 0.05))
    k.part("backpack", k.box(c, (0.26, 0.12, 0.34), bevel=0.03), pal, bone="spine_03")
    k.part("pocket", k.box(c + Vector((0, 0.06, -0.08)), (0.18, 0.04, 0.12), bevel=0.012), pal, bone="spine_03")
    # The straps over the shoulders to the armpits (on the chest bone: they never stretch).
    for s in (1, -1):
        x = s * 0.075
        top = Vector((x, s3.y + 0.01, k.J("neck_01").z - 0.035))
        hit, *_ = bvh.ray_cast(Vector((x, -0.6, s3.z - 0.06)), Vector((0, 1, 0)))
        front = Vector((x + s * 0.03, (hit.y if hit is not None else s3.y - 0.11) - 0.008, s3.z - 0.08))
        hit, *_ = bvh.ray_cast(Vector((x, 0.0, top.z + 0.3)), Vector((0, 0, -1)))
        over = Vector((x, s3.y + 0.02, (hit.z if hit is not None else top.z) + 0.01))
        k.part("strap", k.tube([front, front.lerp(over, 0.5) + Vector((0, -0.04, 0.02)), over, c + Vector((x * 0.9, -0.05, 0.12))], [0.012, 0.012, 0.012, 0.012], segs=5), strap, bone="spine_03")


def handbag(k, side="l", pal="accent"):
    """A bag on the forearm, hanging below the elbow."""
    e = k.J("lowerarm_" + side)
    w = k.J("hand_" + side)
    at = e.lerp(w, 0.28) + Vector((0, 0.0, -0.09))
    k.part("bag", k.box(at, (0.06, 0.2, 0.15), bevel=0.02), pal, bone="lowerarm_" + side)
    k.part("bag_strap", k.torus(e.lerp(w, 0.28) + Vector((0, 0, -0.01)), 0.05, 0.006, axis=(1, 0, 0), segs=14, rsegs=4), pal, bone="lowerarm_" + side)


def hard_hat(k, pal="accent2"):
    hc = k.head_c
    top = k.head_top
    c = Vector((0, hc.y + 0.004, top - 0.075))
    dome = k.sphere(c, (k.head_halfw + 0.022, (k.head_back - k.face_c.y) / 2 + 0.024, 0.105), segs=18, rings=10)
    bmesh.ops.delete(dome, geom=[v for v in dome.verts if v.co.z < c.z - 0.004], context="VERTS")
    k.part("hat", dome, pal, bone="head")
    k.part("hat_brim", k.cylinder(c + Vector((0, -0.012, 0.002)), k.head_halfw + 0.045, 0.01, segs=20), pal, bone="head")
    k.part("hat_ridge", k.box(c + Vector((0, 0, 0.098)), (0.026, 0.17, 0.012), bevel=0.005), pal, bone="head")


def flat_cap(k, pal="accent2"):
    """A cloth cap over the crown with a short brim at the front."""
    fz = k.face_c.z
    hair(k, front=0.06, side=0.032, back=0.006, name="cap", pal=pal, thick=0.018, top=0.022, edge=0.005, taper=0.01, target=300)
    hit, *_ = k.bvh().ray_cast(Vector((0, -0.4, fz + 0.062)), Vector((0, 1, 0)))
    y = hit.y if hit is not None else k.face_c.y + 0.01
    brim = k.sphere(Vector((0, y - 0.018, fz + 0.058)), (k.head_halfw * 0.92, 0.05, 0.008), segs=14, rings=5, rot=Matrix.Rotation(-0.18, 3, "X"))
    bmesh.ops.delete(brim, geom=[v for v in brim.verts if v.co.y > y + 0.01], context="VERTS")
    k.part("cap_brim", brim, pal, bone="head")


def beanie(k, pal="accent"):
    hair(k, front=0.055, side=0.02, back=-0.035, name="beanie", pal=pal, thick=0.022, top=0.03, edge=0.008, taper=0.008, target=320)
    k.part("beanie_cuff", k.torus(Vector((0, k.head_c.y + 0.008, k.face_c.z + 0.06)), k.head_halfw + 0.012, 0.012, segs=22, rsegs=5, scale=(1.0, 1.12, 1.0)), pal, bone="head")


def long_hair(k, pal="hair", length=0.16, width=1.0):
    """A fall of hair down the back of the head to the shoulders (on the head bone)."""
    hc = k.head_c
    nb = k.J("neck_01")
    hw = k.head_halfw
    els = [
        ("ELLIPSOID", Vector((0, hc.y + 0.045, hc.z - 0.02)), (hw * 0.98 * width, 0.07, 0.1), None),
        ("ELLIPSOID", Vector((0, hc.y + 0.06, nb.z + 0.02 - length * 0.3)), (hw * 0.95 * width, 0.05, length * 0.6), None),
    ]
    bm = k.metaball("hair_fall", els, resolution=0.012)
    # Nothing in front of the ears.
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.calc_center_median().y < hc.y + 0.004], context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    ob = k.part("hair_fall", bm, pal, bone="head")
    k.decimate_part(ob, 420)
    return ob


def ponytail(k, pal="hair"):
    hc = k.head_c
    base = Vector((0, k.head_back - 0.012, hc.z + 0.03))
    pts = [base, base + Vector((0, 0.05, -0.02)), base + Vector((0, 0.07, -0.09)), base + Vector((0, 0.055, -0.17))]
    k.part("ponytail", k.tube(pts, [0.03, 0.028, 0.022, 0.006], segs=8), pal, bone="head")
    k.part("hair_tie", k.torus(base + Vector((0, 0.03, -0.01)), 0.026, 0.008, axis=(0, 1, 0.3), segs=12, rsegs=4), "accent", bone="head")


def pigtails(k, pal="hair"):
    hc = k.head_c
    for s in (1, -1):
        c = Vector((s * (k.head_halfw + 0.012), hc.y + 0.02, hc.z + 0.02))
        k.part("pigtail", k.sphere(c, (0.035, 0.035, 0.04), segs=10, rings=6), pal, bone="head")
        k.part("pigtail_tie", k.torus(c + Vector((-s * 0.02, 0, 0.0)), 0.022, 0.007, axis=(1, 0, 0), segs=10, rsegs=4), "accent", bone="head")


def scarf(k, pal="accent"):
    nb = k.J("neck_01")
    bvh = k.bvh()
    hit, *_ = bvh.ray_cast(Vector((0.4, nb.y, nb.z + 0.01)), Vector((-1, 0, 0)))
    r = (hit.x if hit is not None else 0.06) + 0.016
    k.part("scarf", k.torus(Vector((0, nb.y - 0.004, nb.z + 0.004)), r, 0.022, segs=14, rsegs=5, scale=(1.0, 1.1, 1.0)), pal)
    k.part("scarf_end", k.box(Vector((0.03, k.neck_front.y - 0.018, nb.z - 0.08)), (0.05, 0.016, 0.14), bevel=0.006, rot=Matrix.Rotation(0.12, 3, "Y")), pal, bone="spine_03")


def hood_bunched(k, pal="top", inner="inner"):
    """A hoodie's hood lying in folds round the back of the neck."""
    nz = k.J("neck_01").z
    ny = k.J("neck_01").y
    k.shell(
        "hood",
        lambda c, f, head: nz - 0.06 < c.z < nz + 0.07 and c.y > ny - 0.02 and math.hypot(c.x, c.y - ny) < 0.16,
        lambda p: 0.026,
        pal,
        edge=0.006,
        smooth=8,
        taper=0.012,
        inner_pal=inner,
        target=500,
    )


# ---------------------------------------------------------------------------------------
# The eight


def office(k):
    """Office worker: a man of about 32 in a suit jacket, shirt and tie; short hair; a phone."""
    k.clothe()
    k.open_paint()
    k.fill("skin")
    w = C.waist_z(k, 0.0)
    k.paint("bottom", "torso+legs", [k.below(w)])
    k.paint("top", "torso+neck", [k.above(w), k.neckline(drop=0.0)])
    C.chest_v(k, "trim", 0.24, 0.05)
    C.collar(k, "trim")
    C.sleeves(k, "top", 1.93)
    C.shoes(k, "shoe", 1.9)
    k.close_paint()
    C.tie(k, "accent", width=0.042, length=0.3)
    hair(k, front=0.04, side=0.004, back=-0.045, thick=0.011, top=0.022, edge=0.003)
    phone(k)
    face(k)
    fold_fingers(k)


def jogger(k):
    """Jogger: an athletic woman of about 28 in a tank top and leggings, a ponytail and a headband."""
    k.clothe()
    k.open_paint()
    k.fill("skin")
    w = C.waist_z(k, 0.02)
    k.paint("bottom", "torso+legs", [k.below(w)])
    for s_ in "lr":
        k.paint("bottom", "leg_" + s_, [k.leg(s_, 1.85, flip=True)])
    # The tank: the trunk up to the armpits, then straps inside the bare shoulders; a scoop neck.
    armpit, sides = armholes(k, 0.7)
    k.paint("top", "torso", [k.above(w - 0.01), k.below(armpit)])
    k.paint("top", "torso", [k.above(armpit), k.neckline(drop=0.06)] + sides)
    C.shoes(k, "shoe", 1.85)
    k.close_paint()
    hair(k, front=0.045, side=0.0, back=-0.04, thick=0.011, top=0.02, edge=0.003)
    ponytail(k)
    k.part("headband", k.torus(Vector((0, k.head_c.y + 0.004, k.face_c.z + 0.05)), k.head_halfw + 0.006, 0.007, segs=22, rsegs=4, scale=(1.0, 1.12, 1.0)), "accent", bone="head")
    face(k)
    fold_fingers(k)


def elder(k):
    """Retiree: a man of about 75 with a paunch, in a long coat and scarf, a flat cap, glasses."""
    k.clothe()
    k.open_paint()
    k.fill("skin")
    w = C.waist_z(k, 0.0)
    k.paint("bottom", "torso+legs", [k.below(w)])
    k.paint("top", "torso+neck", [k.above(w), k.neckline(drop=0.0)])
    C.chest_v(k, "trim", 0.26, 0.05, low=w)
    C.sleeves(k, "top", 1.94)
    C.shoes(k, "shoe", 1.9)
    for s_ in "lr":
        k.paint("top", "leg_" + s_, [k.leg(s_, 0.7, flip=True)])
    k.close_paint()
    k.decimate_part(C.flare(k, "coat_tails", "top", w + 0.03, k.J("calf_l").z + 0.13, ease=0.02, flare_r=0.04, rows=5, segs=20, open_front=0.36, inner="inner", thigh=0.95), 300)
    fz = k.face_c.z
    hair(k,front=0.0, side=-0.014, back=-0.05, thick=0.009, top=0.009, edge=0.004, region=lambda c, phi: abs(phi) > 1.0 and c.z < fz + 0.05)
    flat_cap(k)
    k.decimate_part(C.glasses(k, "ink", r=0.0175, scale=(1.1, 0.85)), 160)
    scarf(k)
    face(k)
    fold_fingers(k)


def teen(k):
    """Teenager: a slim boy of about 16 in a hoodie and jeans, messy hair, a phone."""
    k.clothe()
    k.open_paint()
    k.fill("skin")
    w = C.waist_z(k, -0.02)
    k.paint("bottom", "torso+legs", [k.below(w)])
    k.paint("top", "torso+neck", [k.above(w), k.neckline(drop=0.01)])
    C.sleeves(k, "top", 1.96)
    # The hoodie's band at the hem and the cuffs.
    k.paint("trim", "torso", [k.above(w), k.below(w + 0.035)])
    for s_ in "lr":
        k.paint("trim", "arm_" + s_, [k.arm(s_, 1.9), k.arm(s_, 1.97, flip=True)])
    C.shoes(k, "shoe", 1.85)
    for s_ in "lr":
        k.paint("sole", "leg_" + s_, [k.leg(s_, 2.0), k.below(0.025)])
    k.close_paint()
    hood_bunched(k)
    hair(k,front=0.03, side=-0.004, back=-0.055, thick=0.016, top=0.03, edge=0.004, taper=0.01)
    phone(k)
    face(k)
    fold_fingers(k)


def auntie(k):
    """Shopper: a heavy-set woman of about 55 in a blouse and long skirt, a bun, a handbag."""
    k.clothe()
    k.open_paint()
    k.fill("skin")
    w = C.waist_z(k, 0.0)
    k.paint("top", "torso+neck", [k.neckline(drop=0.045)])
    for s_ in "lr":
        k.paint("bottom", "leg_" + s_, [k.leg(s_, 1.3, flip=True)])
    k.paint("bottom", "torso", [k.below(w)])
    C.sleeves(k, "top", 0.55)
    C.shoes(k, "shoe", 1.9)
    k.close_paint()
    k.decimate_part(C.flare(k, "skirt", "bottom", w + 0.01, k.J("calf_l").z - 0.08, ease=0.018, flare_r=0.07, rows=6, segs=22, inner="inner", thigh=0.7), 300)
    hair(k,front=0.045, side=0.0, back=-0.055, thick=0.013, top=0.022, edge=0.004)
    C.sphere_part(k, "bun", Vector((0, k.head_c.y + 0.065, k.head_top - 0.01)), (0.042, 0.04, 0.038), "hair", segs=12, rings=8)
    handbag(k)
    face(k)
    fold_fingers(k)


def worker(k):
    """Builder: a big man of about 42 in a tee, a hi-vis vest, work trousers, boots and a hard hat."""
    k.clothe()
    k.open_paint()
    k.fill("skin")
    w = C.waist_z(k, 0.0)
    k.paint("bottom", "torso+legs", [k.below(w)])
    k.paint("top", "torso+neck", [k.above(w), k.neckline(drop=0.015)])
    C.sleeves(k, "top", 0.5)
    # The vest over the tee: the trunk to the armpits, inside the armholes above them; two
    # reflective bands; a V in front.
    armpit, sides = armholes(k, 0.75)
    k.paint("accent", "torso", [k.above(w - 0.03), k.below(armpit)])
    k.paint("accent", "torso", [k.above(armpit), k.neckline(drop=0.0)] + sides)
    s3 = k.J("spine_03").z
    k.paint("accent2", "torso", [k.above(s3 - 0.1), k.below(s3 - 0.065)])
    k.paint("accent2", "torso", [k.above(w + 0.06), k.below(w + 0.095)])
    C.chest_v(k, "top", 0.2, 0.05)
    C.shoes(k, "shoe", 1.75)
    k.close_paint()
    hard_hat(k)
    face(k)
    fold_fingers(k)


def student(k):
    """Student: a young woman of about 21 in a big tee and shorts, long hair, a backpack, a phone."""
    k.clothe()
    k.open_paint()
    k.fill("skin")
    w = C.waist_z(k, -0.03)
    k.paint("bottom", "torso+legs", [k.below(w)])
    for s_ in "lr":
        k.paint("skin", "leg_" + s_, [k.leg(s_, 0.45)])
    k.paint("top", "torso+neck", [k.above(w), k.neckline(drop=0.03)])
    C.sleeves(k, "top", 0.85)
    C.shoes(k, "shoe", 1.82)
    for s_ in "lr":
        k.paint("sole", "leg_" + s_, [k.leg(s_, 2.0), k.below(0.022)])
    k.close_paint()
    hair(k,front=0.05, side=-0.025, back=-0.08, thick=0.012, top=0.02, edge=0.004)
    long_hair(k)
    backpack(k)
    phone(k)
    face(k)
    fold_fingers(k)


def kid(k):
    """A girl of about 9 in a dress and sneakers, with pigtails."""
    k.clothe()
    k.open_paint()
    k.fill("skin")
    w = C.waist_z(k, 0.0)
    k.paint("top", "torso+neck", [k.neckline(drop=0.03)])
    for s_ in "lr":
        k.paint("top", "leg_" + s_, [k.leg(s_, 0.55, flip=True)])
    C.sleeves(k, "top", 0.45)
    C.shoes(k, "shoe", 1.82)
    for s_ in "lr":
        k.paint("sole", "leg_" + s_, [k.leg(s_, 2.0), k.below(0.018)])
    k.close_paint()
    k.decimate_part(C.flare(k, "skirt", "top", w + 0.005, k.J("calf_l").z + 0.07, ease=0.012, flare_r=0.06, rows=5, segs=20, inner="inner", thigh=0.7), 260)
    hair(k,front=0.045, side=-0.01, back=-0.06, thick=0.012, top=0.02, edge=0.004)
    pigtails(k)
    face(k)
    fold_fingers(k)


# ---------------------------------------------------------------------------------------
# The table

TOPS = ["#2F6FD6", "#E5533A", "#F2C230", "#3FA34D", "#F28C28", "#8E5BD9", "#20A39E", "#F4F1EA", "#2B2D35", "#C64B8C"]
DENIM = ["#3B5BA8", "#2C3F73", "#5A6E9C", "#232428", "#6B6E78"]


def civ(build, macros, details, looks, own=None, tris=(2400, 900)):
    """A civilian's spec. `looks` lists the colours a slot may take; "#SKIN" means the
    person's own skin (no blush on them)."""
    pal = palette(**{**{s: v[0] for s, v in looks.items() if s in SLOTS}, **(own or {})})
    pal = {s: (pal["skin"] if h == "#SKIN" else h) for s, h in pal.items()}
    return {
        "file": None,  # set from the id below
        "macros": macros,
        "details": details,
        "palette": pal,
        "flat": ["ink"],
        "gloss": ["lens"],
        "tris": tris,
        "hi_floor": 1600,
        "lo_floor": 600,
        "lo_unlocked": True,
        "lo_halve": 60,
        "looks": looks,
        "build": build,
    }


CIVILIANS = {
    "civ-office": civ(
        office,
        {"gender": 1.0, "age": 0.53, "muscle": 0.5, "weight": 0.52, "height": 0.6, "proportions": 0.55, "race": {"asian": 0.25, "caucasian": 0.5, "african": 0.25}},
        {},
        {"skin": SKIN[0:6], "hair": HAIR[0:6], "top": ["#2B3A55", "#3A3D44", "#5A5E68", "#6E5A46", "#2D4A3E"], "trim": ["#F4F1EA", "#BFD6F2", "#F2C9D6", "#E9E4D0"], "bottom": ["#232428", "#2B3A55", "#3A3D44", "#4A4E58"], "shoe": ["#1E1E22", "#4A3020"], "accent": ["#C9302C", "#2F6FD6", "#F2C230", "#3FA34D", "#8E5BD9"], "blush": ["#SKIN"]},
    ),
    "civ-jogger": civ(
        jogger,
        {"gender": 0.0, "age": 0.47, "muscle": 0.68, "weight": 0.4, "height": 0.6, "proportions": 0.75, "cupsize": 0.42, "race": {"asian": 0.15, "caucasian": 0.2, "african": 0.65}},
        {"torso/measure-waist-circ-decr": 0.25},
        {"skin": SKIN[3:8], "hair": HAIR[0:5] + DYED[0:2], "top": ["#F28C28", "#2DB3A5", "#E86BA8", "#2F6FD6", "#F2C230", "#F4F1EA"], "bottom": ["#232428", "#2B3A55", "#5A5E68", "#3A2F55"], "shoe": ["#F4F1EA", "#E5533A", "#3FA34D", "#2F6FD6"], "accent": ["#F4F1EA", "#F2C230", "#E86BA8", "#2DB3A5"], "blush": BLUSH},
    ),
    "civ-elder": civ(
        elder,
        {"gender": 1.0, "age": 0.9, "muscle": 0.35, "weight": 0.62, "height": 0.42, "proportions": 0.35, "race": {"asian": 0.1, "caucasian": 0.8, "african": 0.1}},
        {"stomach/stomach-pregnant-incr": 0.3},
        {"skin": SKIN[0:4], "hair": GREY, "top": ["#8C6A46", "#5A5E68", "#3A4A3A", "#6E3A3A", "#2B3A55"], "trim": ["#E9E4D0", "#BFD6F2", "#F4F1EA"], "bottom": ["#3A3D44", "#5A4F46", "#4A4E58"], "shoe": ["#3A2A20", "#1E1E22"], "accent": ["#C9302C", "#2F6FD6", "#3FA34D", "#F2C230", "#8E5BD9"], "accent2": ["#5A4636", "#3A3D44", "#6E6A60", "#2D4A3E"], "inner": ["#2A2A2E"], "blush": ["#SKIN"]},
    ),
    "civ-teen": civ(
        teen,
        {"gender": 1.0, "age": 0.3, "muscle": 0.4, "weight": 0.38, "height": 0.5, "proportions": 0.5, "race": {"asian": 0.6, "caucasian": 0.25, "african": 0.15}},
        {},
        {"skin": SKIN[0:5], "hair": HAIR[0:4] + DYED, "top": ["#3FA34D", "#2B2D35", "#C64B8C", "#2F6FD6", "#F2C230", "#8E5BD9", "#9A9EA8", "#E5533A"], "trim": ["#F4F1EA", "#2B2D35"], "bottom": DENIM, "shoe": ["#F4F1EA", "#232428", "#E5533A", "#2F6FD6"], "inner": ["#2A2A2E"], "blush": BLUSH},
    ),
    "civ-auntie": civ(
        auntie,
        {"gender": 0.0, "age": 0.68, "muscle": 0.3, "weight": 0.86, "height": 0.35, "proportions": 0.35, "cupsize": 0.6, "race": {"asian": 0.2, "caucasian": 0.3, "african": 0.5}},
        {"stomach/stomach-pregnant-incr": 0.2},
        {"skin": SKIN[2:8], "hair": HAIR[0:3] + GREY[0:2], "top": ["#F2C230", "#E86BA8", "#20A39E", "#F4F1EA", "#8E5BD9", "#F28C28"], "bottom": ["#2B3A55", "#6E3A5A", "#3A4A3A", "#232428", "#8C5A3A"], "shoe": ["#3A2A20", "#1E1E22", "#6E3A5A"], "accent": ["#8C5A3A", "#C9302C", "#232428", "#F4F1EA"], "inner": ["#1E1E26"], "blush": BLUSH},
    ),
    "civ-worker": civ(
        worker,
        {"gender": 1.0, "age": 0.6, "muscle": 0.75, "weight": 0.78, "height": 0.62, "proportions": 0.45, "race": {"asian": 0.1, "caucasian": 0.3, "african": 0.6}},
        {"stomach/stomach-pregnant-incr": 0.15},
        {"skin": SKIN[3:8], "hair": HAIR[0:3], "top": ["#2B3A55", "#5A5E68", "#3A4A3A", "#F4F1EA", "#6E3A3A"], "bottom": ["#3A3D44", "#5A4F46", "#2C3F73", "#6B5A3A"], "shoe": ["#5A3A22", "#3A2A20"], "accent": ["#F28C28", "#E8E030"], "accent2": ["#D8DCE0"], "blush": ["#SKIN"]},
        own={"accent2": "#D8DCE0"},
    ),
    "civ-student": civ(
        student,
        {"gender": 0.0, "age": 0.44, "muscle": 0.42, "weight": 0.38, "height": 0.55, "proportions": 0.65, "cupsize": 0.4, "race": {"asian": 0.7, "caucasian": 0.2, "african": 0.1}},
        {"torso/measure-waist-circ-decr": 0.3},
        {"skin": SKIN[0:5], "hair": HAIR[0:5] + DYED[0:3], "top": ["#F4F1EA", "#2DB3A5", "#F28C28", "#E86BA8", "#2B2D35", "#F2C230", "#7C5CD6"], "bottom": ["#3B5BA8", "#232428", "#B89E6B", "#2C3F73"], "shoe": ["#F4F1EA", "#E86BA8", "#232428"], "accent": ["#C9302C", "#2F6FD6", "#F2C230", "#3FA34D", "#232428"], "inner": ["#232428"], "blush": BLUSH},
    ),
    "civ-kid": civ(
        kid,
        {"gender": 0.0, "age": 0.16, "muscle": 0.4, "weight": 0.45, "height": 0.5, "proportions": 0.5, "race": {"asian": 0.25, "caucasian": 0.4, "african": 0.35}},
        {},
        {"skin": SKIN, "hair": HAIR[0:7], "top": ["#E86BA8", "#F2C230", "#2DB3A5", "#8E5BD9", "#F28C28", "#3FA34D"], "shoe": ["#F4F1EA", "#E5533A", "#2F6FD6"], "accent": ["#F4F1EA", "#E5533A", "#F2C230"], "inner": ["#2A2A33"], "blush": BLUSH},
        tris=(2200, 850),
    ),
}

for _id, _spec in CIVILIANS.items():
    _spec["file"] = _id
