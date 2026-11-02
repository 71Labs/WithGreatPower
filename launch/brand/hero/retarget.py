"""
Retargets Quaternius' Universal Animation Library (CC0, mocap/SOURCE.md) onto The Node's
skeleton and writes the game's clips: apps/wgp/public/models/hero-anims.glb.

    blender -b launch/brand/hero/build/hero-base.blend -P launch/brand/hero/retarget.py -- [--out path]

How:
  1. Import the UAL's Unreal-named FBX next to NodeRig. Both rigs are Blender Z-up, facing -Y.
  2. Match the rest poses. The UAL rests in a T-pose and our hero in MakeHuman's A-pose, so
     raw rotations can't be copied. For each mapped bone we swing the hero bone's rest
     direction (head to its next joint) onto the UAL bone's, then keep the offset
     C = Rs⁻¹ · swing · Rt between the two rest frames. At any frame the hero bone's
     armature-space rotation is then the UAL bone's times C, so a pose reads the same on
     both bodies, whatever each rig's bone axes.
  3. Rebuild each frame top-down from those armature-space rotations and key the hero's pose
     bones (local rotations; the pelvis also gets its translation, scaled to his hips).
     Root motion goes: loops are recentred on their mean, one-shots start at the origin, and
     only the up/down and sway of the hips stays. The sim moves the body.
  4. Export the armature alone with one glTF animation per clip. Fingers aren't mapped; the
     game poses them itself.
"""

import os
import sys

import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "mocap", "ual", "Animation Library[Standard]", "Unreal Engine", "AL_Standard.fbx")
OUT = os.path.join(HERE, "..", "..", "..", "apps", "wgp", "public", "models", "hero-anims.glb")

# UAL action → game clip, and whether it loops.
CLIPS = {
    "Idle_Loop": ("idle", True),
    "Idle_Talking_Loop": ("idle-talk", True),
    "Walk_Loop": ("walk", True),
    "Jog_Fwd_Loop": ("jog", True),
    "Sprint_Loop": ("sprint", True),
    "Jump_Start": ("jump-start", False),
    "Jump_Loop": ("jump-loop", True),
    "Jump_Land": ("land", False),
    "Punch_Jab": ("jab", False),
    "Punch_Cross": ("cross", False),
    "Hit_Chest": ("hit-chest", False),
    "Hit_Head": ("hit-head", False),
    "Death01": ("death", False),
}

# UAL bone → hero bone (the same UE naming, bar the head).
SIDES = ("clavicle", "upperarm", "lowerarm", "hand", "thigh", "calf", "foot", "ball")
MAP = {"pelvis": "pelvis", "spine_01": "spine_01", "spine_02": "spine_02", "spine_03": "spine_03", "neck_01": "neck_01", "Head": "head"}
for s in ("l", "r"):
    for b in SIDES:
        MAP[f"{b}_{s}"] = f"{b}_{s}"

# Each bone's direction runs from its head to this joint (else along the bone).
NEXT = {
    "pelvis": "spine_01",
    "spine_01": "spine_02",
    "spine_02": "spine_03",
    "spine_03": "neck_01",
    "neck_01": "{head}",
}
for s in ("l", "r"):
    NEXT.update({f"clavicle_{s}": f"upperarm_{s}", f"upperarm_{s}": f"lowerarm_{s}", f"lowerarm_{s}": f"hand_{s}", f"hand_{s}": f"middle_01_{s}"})
    NEXT.update({f"thigh_{s}": f"calf_{s}", f"calf_{s}": f"foot_{s}", f"foot_{s}": f"ball_{s}"})


def out_path():
    a = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    return os.path.abspath(a[a.index("--out") + 1]) if "--out" in a else os.path.abspath(OUT)


def direction(rig, name, head_name):
    bones = rig.data.bones
    b = bones[name]
    nxt = NEXT.get(name if rig.name == "NodeRig" else MAP.get(name, name))
    if nxt == "{head}":
        nxt = head_name
    if nxt and nxt in bones:
        d = bones[nxt].head_local - b.head_local
    else:
        d = b.tail_local - b.head_local
    return d.normalized()


def main():
    out = out_path()
    sc = bpy.context.scene
    tgt = bpy.data.objects["NodeRig"]
    for ob in list(sc.objects):
        if ob is not tgt:
            bpy.data.objects.remove(ob, do_unlink=True)
    for pb in tgt.pose.bones:
        pb.matrix_basis.identity()
        pb.rotation_mode = "QUATERNION"
    bpy.ops.import_scene.fbx(filepath=SRC, automatic_bone_orientation=False)
    src = next(o for o in sc.objects if o.type == "ARMATURE" and o is not tgt)
    for ob in list(sc.objects):
        if ob not in (src, tgt):
            bpy.data.objects.remove(ob, do_unlink=True)
    for ob in (src, tgt):
        off = max(abs(x - y) for r1, r2 in zip(ob.matrix_world, Matrix.Identity(4)) for x, y in zip(r1, r2))
        assert off < 1e-5, f"{ob.name} isn't at the origin unscaled ({off})"

    # Rest offsets.
    C = {}
    for s_name, t_name in MAP.items():
        rs = src.data.bones[s_name].matrix_local.to_3x3()
        rt = tgt.data.bones[t_name].matrix_local.to_3x3()
        ds = direction(src, s_name, "Head")
        dt = direction(tgt, t_name, "head")
        swing = dt.rotation_difference(ds).to_matrix()
        C[t_name] = (s_name, rs.inverted() @ swing @ rt)
    hip_scale = tgt.data.bones["thigh_l"].head_local.z / src.data.bones["thigh_l"].head_local.z
    src_pelvis_rest = src.data.bones["pelvis"].head_local.copy()

    order = []
    def walk(b):
        order.append(b)
        for c in b.children:
            walk(c)
    for b in tgt.data.bones:
        if b.parent is None:
            walk(b)

    made = []
    for action_name, (clip, loop) in CLIPS.items():
        act = next(a for a in bpy.data.actions if a.name.endswith("|" + action_name))
        src.animation_data_create()
        src.animation_data.action = act
        if act.slots and src.animation_data.action_slot is None:
            src.animation_data.action_slot = act.slots[0]
        f0, f1 = (int(round(x)) for x in act.frame_range)
        frames = list(range(f0, f1 + 1))

        # The hips' travel, measured first so loops can be recentred.
        travel = []
        for f in frames:
            sc.frame_set(f)
            travel.append(src.pose.bones["pelvis"].matrix.translation - src_pelvis_rest)
        if loop:
            mean = sum((Vector((t.x, t.y, 0)) for t in travel), Vector()) / len(travel)
        else:
            mean = Vector((travel[0].x, travel[0].y, 0))

        tact = bpy.data.actions.new(clip)
        tgt.animation_data_create()
        tgt.animation_data.action = tact
        prev = {}
        for fi, f in enumerate(frames):
            sc.frame_set(f)
            posed = {}
            for b in order:
                rest = b.matrix_local
                inherited = posed[b.parent.name] @ b.parent.matrix_local.inverted() @ rest if b.parent else rest.copy()
                m = inherited
                if b.name in C:
                    s_name, off = C[b.name]
                    rot = src.pose.bones[s_name].matrix.to_3x3() @ off
                    loc = inherited.translation
                    if b.name == "pelvis":
                        loc = rest.translation + (travel[fi] - mean) * hip_scale
                    m = Matrix.Translation(loc) @ rot.to_4x4()
                posed[b.name] = m
                if b.name not in C:
                    continue
                pb = tgt.pose.bones[b.name]
                basis = inherited.inverted() @ m
                q = basis.to_quaternion()
                if b.name in prev and q.dot(prev[b.name]) < 0:
                    q.negate()
                prev[b.name] = q
                pb.rotation_quaternion = q
                pb.keyframe_insert("rotation_quaternion", frame=f - f0 + 1)
                if b.name == "pelvis":
                    pb.location = basis.translation
                    pb.keyframe_insert("location", frame=f - f0 + 1)
        tact.use_fake_user = True
        made.append(tact)
        print(f"[retarget] {action_name} → {clip}: {len(frames)} frames")

    # Only our clips, on the hero's armature alone.
    bpy.data.objects.remove(src, do_unlink=True)
    for a in list(bpy.data.actions):
        if a not in made:
            bpy.data.actions.remove(a)
    tgt.animation_data.action = None
    for pb in tgt.pose.bones:
        pb.matrix_basis.identity()
    bpy.ops.object.select_all(action="DESELECT")
    tgt.select_set(True)
    bpy.context.view_layer.objects.active = tgt
    sc.render.fps = 30
    os.makedirs(os.path.dirname(out), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=out,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_force_sampling=True,
        export_frame_step=1,
        export_optimize_animation_size=True,
        export_optimize_animation_keep_anim_armature=True,
        export_anim_single_armature=True,
        export_reset_pose_bones=True,
        export_def_bones=False,
        export_skins=False,
        export_morph=False,
        export_materials="NONE",
    )
    print("[retarget] wrote", out, f"{os.path.getsize(out) / 1e6:.2f} MB")


main()
