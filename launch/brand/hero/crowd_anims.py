"""
The crowd's motion (apps/wgp/public/models/crowd-anims.glb): Quaternius' UAL clips the cast
doesn't use, retargeted onto The Node's skeleton like the rest (retarget.py), and the
onlookers' moves made from them: a wave, a cheer, a fist pump, pointing up at the hero,
filming him on a phone, looking down at a phone (standing and walking), clapping, and
looking up.

    blender -b launch/brand/hero/build/hero-base.blend -P launch/brand/hero/crowd_anims.py -- [--out path] [--preview dir]

A made move is its base clip (the idle, or the walk) frame by frame with some bones re-aimed
on top, in the body's own frame (posing.py's ops: x the body's left, −y its front, z up),
keyed on the same bones the retarget keys. Each loops on its base clip's length, every
oscillation a whole number of cycles in it, so the loops are seamless. The game already
has the idle, the talking idle and the walk (hero-anims.glb); this file adds the rest.
--preview renders a contact sheet per move (workbench, the body at rest-pose colours).
"""

import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import posing as P  # noqa: E402
import retarget as R  # noqa: E402

OUT = os.path.join(HERE, "..", "..", "..", "apps", "wgp", "public", "models", "crowd-anims.glb")

# UAL action → game clip, and whether it loops. "_idle" and "_walk" are bases only (the game
# has them already, from hero-anims.glb).
BASES = {
    "Idle_Loop": ("_idle", True),
    "Idle_Talking_Loop": ("_talk", True),
    "Walk_Loop": ("_walk", True),
    "Walk_Formal_Loop": ("walk-formal", True),
    "Dance_Loop": ("dance", True),
}

FPS = 30
TAU = 2 * math.pi


def cyc(t, period, n):
    """An oscillation with n whole cycles over `period` seconds."""
    return math.sin(TAU * n * t / period)


def mirror(d):
    return (-d[0], d[1], d[2])


def mix(a, b, u):
    return tuple(x + (y - x) * u for x, y in zip(a, b))


def head_up(deg):
    """Pitch up (the body's x is its left; a negative turn about it lifts the face)."""
    return ("rot", (1, 0, 0), -deg, "body")


# The UAL idle stands wide and staggered, a fighter's stance: a passer-by's feet come in
# under the hips (each thigh turned toward the middle, the feet staying level).
NARROW = 7.0


def narrow(ops):
    ops = dict(ops)
    ops["thigh_l"] = ops.get("thigh_l", []) + [("rot", (0, 1, 0), NARROW, "body")]
    ops["thigh_r"] = ops.get("thigh_r", []) + [("rot", (0, 1, 0), -NARROW, "body")]
    ops["foot_l"] = ops.get("foot_l", []) + [("rot", (0, 1, 0), -NARROW, "body")]
    ops["foot_r"] = ops.get("foot_r", []) + [("rot", (0, 1, 0), NARROW, "body")]
    return ops


def standing(fn):
    """A move made on the idle, on narrowed legs."""
    def made(t, T):
        ops, lift = fn(t, T)
        return narrow(ops), lift

    return made


# Each move: its base and, per time t (s) in a loop of `period` s, ops per bone (posing.py's
# "aim" / "rot" / "twist" in body space) and a lift of the hips (m).
def wave(t, T):
    s = cyc(t, T, 5)
    return {
        "clavicle_r": [("rot", (0, 1, 0), 12, "body")],
        "upperarm_r": [("aim", (-0.66, -0.16, 0.6), "body")],
        "lowerarm_r": [("aim", (-0.18 + 0.42 * s, -0.22, 1.0), "body")],
        "hand_r": [("aim", (-0.18 + 0.6 * cyc(t - 0.05, T, 5), -0.3, 1.0), "body", "Z", (0, -1, 0), "body")],
        "head": [head_up(10)],
    }, 0.0


def cheer(t, T):
    n = 6
    a = 0.5 - 0.5 * math.cos(TAU * n * t / T)
    b = 0.5 - 0.5 * math.cos(TAU * n * t / T + 1.3)
    up_l, bent_l = (0.28, -0.1, 1.0), (-0.05, -0.42, 0.82)
    return {
        "clavicle_l": [("rot", (0, 1, 0), -14, "body")],
        "clavicle_r": [("rot", (0, 1, 0), 14, "body")],
        "upperarm_l": [("aim", (0.46, -0.12, 0.88), "body")],
        "upperarm_r": [("aim", (-0.46, -0.12, 0.88), "body")],
        "lowerarm_l": [("aim", mix(up_l, bent_l, a), "body")],
        "lowerarm_r": [("aim", mirror(mix(up_l, bent_l, b)), "body")],
        "hand_l": [("aim", mix(up_l, bent_l, a * 0.7), "body")],
        "hand_r": [("aim", mirror(mix(up_l, bent_l, b * 0.7)), "body")],
        "spine_03": [head_up(4)],
        "head": [head_up(14)],
    }, 0.018 * max(0.0, math.sin(TAU * n * t / T))


def fist_pump(t, T):
    n = 5
    a = 0.5 - 0.5 * math.cos(TAU * n * t / T)
    return {
        "clavicle_r": [("rot", (0, 1, 0), 10, "body")],
        "upperarm_r": [("aim", mix((-0.3, -0.25, 0.92), (-0.42, -0.1, 0.55), a), "body")],
        "lowerarm_r": [("aim", mix((-0.15, -0.2, 1.0), (0.2, -0.55, 0.8), a), "body")],
        "hand_r": [("aim", mix((-0.1, -0.2, 1.0), (0.15, -0.5, 0.85), a), "body")],
        "head": [head_up(12)],
    }, 0.0


def point(t, T):
    bob = 0.06 * cyc(t, T, 3)
    d = (-0.24, -0.6, 0.76 + bob)
    return {
        "clavicle_r": [("rot", (0, 1, 0), 8, "body")],
        "upperarm_r": [("aim", (-0.3, -0.62, 0.7 + bob), "body")],
        "lowerarm_r": [("aim", d, "body")],
        "hand_r": [("aim", d, "body")],
        "spine_03": [head_up(5)],
        "head": [head_up(22)],
    }, 0.0


def photo(t, T):
    """Filming: the phone held out at arm's length in front of the chin, both hands on it."""
    sway = 0.04 * cyc(t, T, 1)
    return {
        "upperarm_l": [("aim", (0.26, -0.78, -0.12), "body")],
        "upperarm_r": [("aim", (-0.26, -0.78, -0.12), "body")],
        "lowerarm_l": [("aim", (-0.3 + sway, -0.85, 0.36), "body")],
        "lowerarm_r": [("aim", (0.3 + sway, -0.85, 0.36), "body")],
        "hand_l": [("aim", (-0.2, -0.55, 0.8), "body", "Z", (0, 1, 0), "body")],
        "hand_r": [("aim", (0.2, -0.55, 0.8), "body", "Z", (0, 1, 0), "body")],
        "head": [head_up(8)],
    }, 0.0


def phone_arms(t, T, walk=False):
    look = 0.04 * cyc(t, T, 1)
    ops = {
        "upperarm_r": [("aim", (-0.2, -0.28, -0.94), "body")],
        "lowerarm_r": [("aim", (0.28, -0.9, 0.28 + look), "body")],
        "hand_r": [("aim", (0.2, -0.95, 0.25), "body", "Z", (0, 0.2, 1), "body")],
        "neck_01": [head_up(-10)],
        "head": [head_up(-24)],
    }
    if not walk:
        ops["upperarm_l"] = [("aim", (0.18, -0.25, -0.95), "body")]
        ops["lowerarm_l"] = [("aim", (-0.42, -0.86, 0.25), "body")]
        ops["hand_l"] = [("aim", (-0.3, -0.92, 0.2), "body", "Z", (0, 0.2, 1), "body")]
    return ops, 0.0


def clap(t, T):
    n = 7
    a = 0.5 - 0.5 * math.cos(TAU * n * t / T)  # 0 hands together, 1 apart
    fl = (-0.66 + 0.4 * a, -0.74, 0.26)
    return {
        "upperarm_l": [("aim", (0.24, -0.42, -0.87), "body")],
        "upperarm_r": [("aim", (-0.24, -0.42, -0.87), "body")],
        "lowerarm_l": [("aim", fl, "body")],
        "lowerarm_r": [("aim", mirror(fl), "body")],
        "hand_l": [("aim", fl, "body", "Z", (-1, 0, 0), "body")],
        "hand_r": [("aim", mirror(fl), "body", "Z", (1, 0, 0), "body")],
        "head": [head_up(10)],
    }, 0.0


def look_up(t, T):
    turn = 8 * cyc(t, T, 1)
    return {
        "spine_03": [head_up(6)],
        "neck_01": [head_up(10)],
        "head": [head_up(20), ("rot", (0, 0, 1), turn, "body")],
    }, 0.0


MOVES = {
    "stand": ("_idle", standing(lambda t, T: ({}, 0.0))),
    "stand-talk": ("_talk", standing(lambda t, T: ({}, 0.0))),
    "wave": ("_idle", standing(wave)),
    "cheer": ("_idle", standing(cheer)),
    "fist-pump": ("_idle", standing(fist_pump)),
    "point": ("_idle", standing(point)),
    "photo": ("_idle", standing(photo)),
    "phone": ("_idle", standing(lambda t, T: phone_arms(t, T))),
    "walk-phone": ("_walk", lambda t, T: phone_arms(t, T, walk=True)),
    "clap": ("_idle", standing(clap)),
    "look-up": ("_idle", standing(look_up)),
}


def cli():
    a = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    out = os.path.abspath(a[a.index("--out") + 1]) if "--out" in a else os.path.abspath(OUT)
    prev = os.path.abspath(a[a.index("--preview") + 1]) if "--preview" in a else None
    return out, prev


def hierarchy(rig):
    order = []

    def walk(b):
        order.append(b)
        for c in b.children:
            walk(c)

    for b in rig.data.bones:
        if b.parent is None:
            walk(b)
    return order


def bake(rig, base, name, fn):
    """A new action: `base` each frame with fn(t, period)'s ops on top."""
    sc = bpy.context.scene
    order = hierarchy(rig)
    poser = P.Poser(rig)
    keyed = set(R.MAP.values())
    rig.animation_data.action = base
    if base.slots and rig.animation_data.action_slot is None:
        rig.animation_data.action_slot = base.slots[0]
    f0, f1 = (int(round(x)) for x in base.frame_range)
    # An even number of frame steps, so every other frame (the export's) ends on the last:
    # dropping one frame of the slow idle at the wrap doesn't show.
    if (f1 - f0) % 2:
        f1 -= 1
    period = (f1 - f0) / FPS
    frames = []
    for f in range(f0, f1 + 1):
        sc.frame_set(f)
        t = (f - f0) / FPS
        ops, lift = fn(t, period)
        basis = {pb.name: pb.matrix_basis.copy() for pb in rig.pose.bones}
        posed = {}
        poser.posed = posed
        out = {}
        for b in order:
            rest = b.matrix_local
            inherited = posed[b.parent.name] @ b.parent.matrix_local.inverted() @ rest if b.parent else rest.copy()
            m = inherited @ basis[b.name]
            for op in ops.get(b.name, []):
                m = poser._op(b, m, op)
            if b.name == "pelvis" and lift:
                m = Matrix.Translation(Vector((0, 0, lift))) @ m
            posed[b.name] = m
            if b.name in keyed:
                out[b.name] = inherited.inverted() @ m
        frames.append(out)
    act = bpy.data.actions.new(name)
    rig.animation_data.action = act
    prev = {}
    for fi, out in enumerate(frames):
        for bn, basis in out.items():
            pb = rig.pose.bones[bn]
            q = basis.to_quaternion()
            if bn in prev and q.dot(prev[bn]) < 0:
                q.negate()
            prev[bn] = q
            pb.rotation_quaternion = q
            pb.keyframe_insert("rotation_quaternion", frame=fi + 1)
            if bn == "pelvis":
                pb.location = basis.translation
                pb.keyframe_insert("location", frame=fi + 1)
    act.use_fake_user = True
    print(f"[crowd] {name}: {len(frames)} frames on {base.name}")
    return act


def preview(rig, acts, folder):
    """A contact sheet per move: six frames across the loop, front three-quarter view."""
    sc = bpy.context.scene
    body = next((o for o in bpy.data.objects if o.type == "MESH" and o.find_armature() == rig), None)
    if body is None:
        print("[crowd] no body for previews")
        return
    os.makedirs(folder, exist_ok=True)
    cam_d = bpy.data.cameras.new("pcam")
    cam_d.type = "ORTHO"
    cam_d.ortho_scale = 2.4
    cam = bpy.data.objects.new("pcam", cam_d)
    sc.collection.objects.link(cam)
    cam.location = (-5.5, -7.5, 1.05)
    cam.rotation_euler = (math.radians(90), 0, math.radians(-36))
    sc.camera = cam
    sc.render.engine = "BLENDER_WORKBENCH"
    sc.display.shading.light = "STUDIO"
    sc.display.shading.show_object_outline = True
    sc.render.resolution_x = 360
    sc.render.resolution_y = 420
    for a in acts:
        rig.animation_data.action = a
        if a.slots:
            rig.animation_data.action_slot = a.slots[0]
        f0, f1 = (int(round(x)) for x in a.frame_range)
        for i in range(6):
            f = f0 + round((f1 - f0) * i / 6)
            sc.frame_set(f)
            sc.render.filepath = os.path.join(folder, f"{a.name}-{i}.png")
            bpy.ops.render.render(write_still=True)
    print("[crowd] previews in", folder)


def main():
    out, prev = cli()
    # The retarget clears the scene but the rig: keep the body aside for the previews.
    body = bpy.data.objects["Node"].copy() if prev else None
    made = R.retarget(BASES)
    rig = bpy.data.objects["NodeRig"]
    if body is not None:
        bpy.context.scene.collection.objects.link(body)
    base = {a.name: a for a in made}
    for name, (b, fn) in MOVES.items():
        made.append(bake(rig, base[b], name, fn))
    keep = [a for a in made if not a.name.startswith("_")]
    if prev:
        preview(rig, keep, prev)
    # Every other frame (15 a second): the game resamples to 30 and blends, and a crowd's
    # moves are slow next to the hero's.
    R.export(keep, out, step=2, lean=True)


if __name__ == "__main__":
    main()
