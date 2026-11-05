"""
The Right-Clicker's motion (apps/wgp/public/models/right-clicker-anims.glb), for Case file 001:
Quaternius' UAL pistol clips (CC0) retargeted onto The Node's skeleton like the rest
(retarget.py), his giant cursor held where the pistol was, and moves made on the UAL clips the
way crowd_anims.py makes the crowd's.

    blender -b launch/brand/hero/build/hero-base.blend -P launch/brand/hero/rc_anims.py -- [--out path] [--preview dir]

Clips (the game already has the walk, the hits and the death in hero-anims.glb):
  rc-idle     made on the UAL idle: the cursor rested on his right shoulder like a bat (a loop)
  rc-aim      the pistol's two-handed aim: arms out straight, pointing the cursor (a loop)
  rc-click    the pistol's shot: a sharp recoil up the arms (one-shot)
  rc-reload   the pistol's reload, as fiddling the cursor back into shape (one-shot)
  rc-copy     made on the aim, 1.2 s: the cursor swept across and back, the free hand
              tapping twice (Ctrl+C, Ctrl+V) (one-shot)
  rc-drag     made on the aim, 1.0 s: the arm hauled back to the chest, leaning away (one-shot)
  rc-stagger  made on the idle: reeling, head lolling, the cursor arm hanging (a loop)
--preview renders a contact sheet per clip (workbench, the hero's body at rest colours).
"""

import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import crowd_anims as CA  # noqa: E402
import posing as P  # noqa: E402
import retarget as R  # noqa: E402

OUT = os.path.join(HERE, "..", "..", "..", "apps", "wgp", "public", "models", "right-clicker-anims.glb")

# UAL action → clip, and whether it loops. "_"-names are bases only.
BASES = {
    "Pistol_Aim_Neutral": ("rc-aim", True),
    "Pistol_Shoot": ("rc-click", False),
    "Pistol_Reload": ("rc-reload", False),
    "Idle_Loop": ("_idle", True),
}

TAU = 2 * math.pi


def ease(u):
    u = max(0.0, min(1.0, u))
    return u * u * (3 - 2 * u)


def shoulder(t, T):
    """The cursor on his shoulder: the fist by the collarbone, the arrow back over it, its face
    to the front; his head turning a little, sizing you up."""
    look = 6 * CA.cyc(t, T, 1)
    return {
        "clavicle_r": [("rot", (0, 1, 0), -8, "body")],
        "upperarm_r": [("aim", (-0.62, -0.2, -0.76), "body")],
        "lowerarm_r": [("aim", (-0.22, 0.02, 0.98), "body")],
        "hand_r": [("aim", (-0.28, 0.72, 0.64), "body", "Z", (0, 1, 0), "body")],
        "head": [("rot", (0, 0, 1), look, "body"), CA.head_up(6)],
    }, 0.0


def copy_sweep(t, T):
    """Ctrl+C: the cursor sweeps across (left, then back right) and the free hand taps twice."""
    u = t / T
    a = math.sin(TAU * u)
    tap = max(0.0, math.sin(TAU * 2 * u)) ** 2
    return {
        "spine_03": [("rot", (0, 0, 1), 14 * a, "body")],
        "upperarm_r": [("rot", (0, 0, 1), 26 * a, "body")],
        "lowerarm_l": [("rot", (1, 0, 0), -30 * tap, "body")],
        "hand_l": [("rot", (1, 0, 0), -25 * tap, "body")],
    }, 0.0


def drag_haul(t, T):
    """The lasso: arm out, then hauled back to the chest, leaning away."""
    u = t / T
    pull = ease((u - 0.15) / 0.55) - ease((u - 0.85) / 0.15)
    if pull < 1e-4:
        return {}, 0.0
    # Body frame: x his left, −y his front, z up. The elbow drives back past the ribs and the
    # fist comes in to the chest.
    return {
        "spine_01": [("rot", (1, 0, 0), 8 * pull, "body")],
        "spine_03": [("rot", (1, 0, 0), 10 * pull, "body")],
        "upperarm_r": [("aim", CA.mix((-0.12, -0.99, -0.05), (-0.3, 0.35, -0.89), pull), "body")],
        "lowerarm_r": [("aim", CA.mix((-0.05, -1.0, 0.0), (0.25, -0.72, 0.64), pull), "body")],
        "hand_r": [("aim", CA.mix((-0.05, -1.0, 0.0), (0.2, -0.9, 0.38), pull), "body")],
        "head": [CA.head_up(6 * pull)],
    }, -0.025 * pull


def stagger(t, T):
    """Reeling: the chest circles, the head lolls the other way, the cursor arm hangs."""
    a = TAU * 3 * t / T
    return {
        "spine_01": [("rot", (1, 0, 0), -6 + 5 * math.sin(a), "body")],
        "spine_03": [("rot", (0, 1, 0), 7 * math.cos(a), "body"), ("rot", (1, 0, 0), 6 * math.sin(a), "body")],
        "head": [("rot", (0, 1, 0), -14 * math.cos(a + 0.6), "body"), ("rot", (1, 0, 0), 10 * math.sin(a + 0.6), "body")],
        "upperarm_r": [("aim", (-0.25 + 0.05 * math.sin(a), -0.1, -1.0), "body")],
        "lowerarm_r": [("aim", (-0.15, -0.2, -1.0), "body")],
        "upperarm_l": [("aim", (0.3, -0.05 + 0.05 * math.cos(a), -1.0), "body")],
    }, -0.006 + 0.004 * math.sin(a)


MOVES = {
    "rc-idle": ("_idle", CA.standing(shoulder)),
    "rc-stagger": ("_idle", CA.standing(stagger)),
}
# Made on a held pose, over their own length (s).
HOLDS = {
    "rc-copy": ("rc-aim", copy_sweep, 1.2),
    "rc-drag": ("rc-aim", drag_haul, 1.0),
}


def bake_hold(rig, base, name, fn, seconds):
    """Like crowd_anims.bake, over `seconds` with the base clip looped under it (a held pose)."""
    sc = bpy.context.scene
    order = CA.hierarchy(rig)
    poser = P.Poser(rig)
    keyed = set(R.MAP.values())
    rig.animation_data.action = base
    if base.slots and rig.animation_data.action_slot is None:
        rig.animation_data.action_slot = base.slots[0]
    f0, f1 = (int(round(x)) for x in base.frame_range)
    span = max(1, f1 - f0)
    n = int(round(seconds * CA.FPS))
    frames = []
    for i in range(n + 1):
        sc.frame_set(f0 + (i % span))
        ops, lift = fn(i / CA.FPS, seconds)
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
    print(f"[rc] {name}: {len(frames)} frames on {base.name}")
    return act


def cli():
    a = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    out = os.path.abspath(a[a.index("--out") + 1]) if "--out" in a else os.path.abspath(OUT)
    prev = os.path.abspath(a[a.index("--preview") + 1]) if "--preview" in a else None
    return out, prev


def main():
    out, prev = cli()
    body = bpy.data.objects["Node"].copy() if prev else None
    made = R.retarget(BASES)
    rig = bpy.data.objects["NodeRig"]
    if body is not None:
        bpy.context.scene.collection.objects.link(body)
    base = {a.name: a for a in made}
    for name, (b, fn) in MOVES.items():
        made.append(CA.bake(rig, base[b], name, fn))
    for name, (b, fn, secs) in HOLDS.items():
        made.append(bake_hold(rig, base[b], name, fn, secs))
    keep = [a for a in made if not a.name.startswith("_")]
    if prev:
        CA.preview(rig, keep, prev)
    R.export(keep, out, lean=True)


if __name__ == "__main__":
    main()
