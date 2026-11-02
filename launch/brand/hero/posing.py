"""
Posing helpers and the hero's swing poses, for the MPFB game_engine skeleton.

Directions are plain vectors. "screen" space is the render's frame: x to the right of the
picture, y away from the camera, z up (the camera looks along +y). "body" space is the
hero's own frame before the whole-body tilt: x his left, -y his front, z up.

Every bone is posed by building its armature-space matrix from its parent's posed matrix,
so there is no depsgraph round trip and the result is deterministic.
"""

import math

from mathutils import Matrix, Quaternion, Vector

FINGERS = ("index", "middle", "ring", "pinky")

# Hand shapes: per-finger (knuckle, middle, tip) curl in degrees, and the thumb.
FIST = [(78, 100, 60), (84, 100, 60), (88, 100, 60), (92, 100, 60)]
FIST_THUMB = (0, -20, 30, 40)  # wrapped across the index and middle fingers
OPEN = [(10, 14, 8), (12, 16, 10), (16, 18, 12), (20, 20, 14)]  # relaxed, curling toward the pinky
OPEN_THUMB = (5, -12, 10, 12)


def _v(x):
    return Vector(x).normalized()


class Poser:
    def __init__(self, rig, turn_deg=0.0):
        self.rig = rig
        self.bones = rig.data.bones
        self.turn = Matrix.Rotation(math.radians(turn_deg), 4, "Z")
        rig.rotation_euler = (0.0, 0.0, math.radians(turn_deg))
        self.ops = {}
        self.posed = {}

    # -- spec -----------------------------------------------------------------------------
    def add(self, bone, *ops):
        self.ops.setdefault(bone, []).extend(ops)

    # -- spaces ---------------------------------------------------------------------------
    def to_arm(self, d, space):
        d = Vector(d).normalized()
        if space == "screen":
            return (self.turn.inverted().to_3x3() @ d).normalized()
        if space == "body":
            root = self.posed.get("Root")
            r = (root.to_3x3() @ self.bones["Root"].matrix_local.to_3x3().inverted()) if root else Matrix.Identity(3)
            return (r @ d).normalized()
        return d

    def world(self, bone):
        """Posed armature-space matrix."""
        return self.posed[bone]

    def head(self, bone):
        return self.rig.matrix_world @ self.posed[bone].translation

    def tail(self, bone):
        m = self.posed[bone]
        return self.rig.matrix_world @ (m.translation + m.col[1].xyz.normalized() * self.bones[bone].length)

    # -- solve ----------------------------------------------------------------------------
    def apply(self):
        pose = self.rig.pose
        for b in self.bones:
            rest = b.matrix_local
            if b.parent:
                inherited = self.posed[b.parent.name] @ b.parent.matrix_local.inverted() @ rest
            else:
                inherited = rest.copy()
            m = inherited
            for op in self.ops.get(b.name, []):
                m = self._op(b, m, op)
            self.posed[b.name] = m
            pose.bones[b.name].matrix_basis = inherited.inverted() @ m

    def _op(self, b, m, op):
        kind = op[0]
        loc = m.translation.copy()
        rot = m.to_quaternion()
        if kind == "rot":  # ("rot", axis, deg, space)
            axis = self.to_arm(op[1], op[3] if len(op) > 3 else "arm")
            q = Quaternion(axis, math.radians(op[2]))
            rot = q @ rot
        elif kind == "aim":  # ("aim", dir, space, hint_axis, hint_dir, hint_space)
            d = self.to_arm(op[1], op[2])
            y = rot @ Vector((0, 1, 0))
            rot = y.rotation_difference(d) @ rot
            if len(op) > 3 and op[3]:
                axis_local = {"X": Vector((1, 0, 0)), "Z": Vector((0, 0, 1)), "-X": Vector((-1, 0, 0)), "-Z": Vector((0, 0, -1))}[op[3]]
                hint = self.to_arm(op[4], op[5] if len(op) > 5 else op[2])
                cur = rot @ axis_local
                # Twist about d so the axis lands as near the hint as possible.
                hp = (hint - d * hint.dot(d)).normalized()
                cp = (cur - d * cur.dot(d)).normalized()
                ang = math.atan2(cp.cross(hp).dot(d), cp.dot(hp))
                rot = Quaternion(d, ang) @ rot
        elif kind == "bend":  # ("bend", toward, deg): swing the bone toward a direction
            toward = op[1]() if callable(op[1]) else self.to_arm(op[1], "arm")
            y = rot @ Vector((0, 1, 0))
            axis = y.cross(toward)
            if axis.length > 1e-6:
                rot = Quaternion(axis.normalized(), math.radians(op[2])) @ rot
        elif kind == "local":  # ("local", "X"|"Y"|"Z", deg) about the bone's own axis
            axis = {"X": Vector((1, 0, 0)), "Y": Vector((0, 1, 0)), "Z": Vector((0, 0, 1))}[op[1]]
            rot = rot @ Quaternion(axis, math.radians(op[2]))
        elif kind == "twist":  # ("twist", deg) about the bone's own axis
            y = rot @ Vector((0, 1, 0))
            rot = Quaternion(y, math.radians(op[1])) @ rot
        return Matrix.Translation(loc) @ rot.to_matrix().to_4x4()

    # -- hands ----------------------------------------------------------------------------
    def palm(self, side):
        """Palm normal (out of the palm) of the posed hand, armature space."""
        m = self.posed["hand_" + side]
        return (m.to_quaternion() @ Vector((0, 0, 1))).normalized()

    def hand_shape(self, side, curl, spread=0.0, thumb=(0.0, 0.0, 0.0, 0.0)):
        """curl: degrees per joint for (index, middle, ring, pinky), each a 3-tuple or one
        number. Fingers curl about their own local x (toward the palm, their local z).
        spread: degrees the fingers fan apart. thumb: (base toward palm, base swing across
        the palm, joint 2 curl, joint 3 curl)."""
        for k, f in enumerate(FINGERS):
            c = curl[k] if isinstance(curl, (list, tuple)) else (curl, curl, curl)
            # Local +x points to the pinky side on the left hand, the thumb side on the right.
            fan = spread * (1.5 - k) / 1.5 * (1 if side == "l" else -1)
            for j in range(3):
                ops = []
                if j == 0 and fan:
                    ops.append(("local", "Z", fan))
                ops.append(("local", "X", c[j]))
                self.add(f"{f}_0{j + 1}_{side}", *ops)
        base_x, base_z, j2, j3 = thumb
        self.add(f"thumb_01_{side}", ("local", "X", base_x), ("local", "Z", base_z * (1 if side == "l" else -1)))
        self.add(f"thumb_02_{side}", ("local", "X", j2))
        self.add(f"thumb_03_{side}", ("local", "X", j3))


# ---------------------------------------------------------------------------------------
# Poses. Each returns the Poser (already applied) and a few named points for the scene.


def swing_a(rig):
    """Header pose: three-quarter view swinging toward the picture's left, the body on a
    diagonal under the web. Right fist up on the web, left hand reaching forward under it,
    head turned to us so both lenses read, right knee driven up, left shin folded back."""
    p = Poser(rig, turn_deg=-50.0)
    p.add("Root", ("rot", (0, 1, 0), -30.0, "screen"), ("rot", (1, 0, 0), 4.0, "body"))
    p.add("pelvis", ("rot", (1, 0, 0), 14.0, "body"))
    p.add("spine_01", ("rot", (1, 0, 0), -5.0, "body"))
    p.add("spine_02", ("rot", (1, 0, 0), -7.0, "body"), ("rot", (0, 0, 1), -2.0, "body"))
    p.add("spine_03", ("rot", (1, 0, 0), -7.0, "body"), ("rot", (0, 0, 1), -4.0, "body"))
    p.add("neck_01", ("rot", (0, 0, 1), 12.0, "body"), ("rot", (1, 0, 0), 6.0, "body"))
    p.add("head", ("rot", (0, 0, 1), 20.0, "body"), ("rot", (1, 0, 0), 6.0, "body"), ("rot", (0, 1, 0), 10.0, "body"))
    p.add("clavicle_r", ("rot", (0, 1, 0), -18.0, "body"))
    p.add("upperarm_r", ("aim", (-0.74, 0.22, 0.64), "screen", "Z", (0.0, -0.6, 0.8), "screen"))
    p.add("lowerarm_r", ("aim", (-0.84, 0.12, 0.53), "screen"), ("twist", 0.0))
    p.add("hand_r", ("aim", (-0.9, 0.04, 0.43), "screen"), ("twist", 0.0))
    p.hand_shape("r", curl=FIST, spread=-3, thumb=FIST_THUMB)
    p.add("clavicle_l", ("rot", (1, 0, 0), -6.0, "body"))
    p.add("upperarm_l", ("aim", (-0.35, -0.6, -0.72), "screen", "Z", (-0.5, -0.4, 0.7), "screen"))
    p.add("lowerarm_l", ("aim", (-0.82, -0.42, -0.38), "screen"), ("twist", 0.0))
    p.add("hand_l", ("aim", (-0.86, -0.32, -0.38), "screen"), ("twist", 0.0))
    p.hand_shape("l", curl=OPEN, spread=11, thumb=OPEN_THUMB)
    p.add("thigh_r", ("aim", (-0.1, -0.93, -0.35), "body"))
    p.add("calf_r", ("aim", (0.0, 0.55, -0.83), "body"))
    p.add("foot_r", ("aim", (0.0, 0.05, -1.0), "body"))
    p.add("thigh_l", ("aim", (0.1, -0.45, -0.89), "body"))
    p.add("calf_l", ("aim", (0.02, 0.96, 0.2), "body"))
    p.add("foot_l", ("aim", (0.0, 0.45, 0.89), "body"))
    p.apply()
    return p


def swing_b(rig):
    """Variant B: facing us at three-quarters, arms spread wide. Right fist up-left on the
    web, left arm flung out to the right with an open hand, both knees tucked, right leading."""
    p = Poser(rig, turn_deg=-24.0)
    p.add("Root", ("rot", (0, 1, 0), -24.0, "screen"), ("rot", (1, 0, 0), 8.0, "body"))
    p.add("pelvis", ("rot", (1, 0, 0), 16.0, "body"), ("rot", (0, 0, 1), 10.0, "body"))
    p.add("spine_01", ("rot", (1, 0, 0), -6.0, "body"))
    p.add("spine_02", ("rot", (1, 0, 0), -8.0, "body"), ("rot", (0, 0, 1), -6.0, "body"))
    p.add("spine_03", ("rot", (1, 0, 0), -8.0, "body"), ("rot", (0, 1, 0), -6.0, "body"), ("rot", (0, 0, 1), -8.0, "body"))
    p.add("neck_01", ("rot", (1, 0, 0), 4.0, "body"), ("rot", (0, 0, 1), -4.0, "body"))
    p.add("head", ("rot", (1, 0, 0), 2.0, "body"), ("rot", (0, 0, 1), -10.0, "body"), ("rot", (0, 1, 0), 10.0, "body"))
    p.add("clavicle_r", ("rot", (0, 1, 0), -18.0, "body"))
    p.add("upperarm_r", ("aim", (-0.66, 0.12, 0.74), "screen", "Z", (0.1, -0.7, 0.7), "screen"))
    p.add("lowerarm_r", ("aim", (-0.76, 0.06, 0.65), "screen"), ("twist", 0.0))
    p.add("hand_r", ("aim", (-0.84, 0.02, 0.54), "screen"), ("twist", 0.0))
    p.hand_shape("r", curl=FIST, spread=-3, thumb=FIST_THUMB)
    p.add("clavicle_l", ("rot", (0, 1, 0), 6.0, "body"))
    p.add("upperarm_l", ("aim", (0.86, -0.25, -0.44), "screen", "Z", (0.1, -0.6, 0.8), "screen"))
    p.add("lowerarm_l", ("aim", (0.9, -0.38, -0.2), "screen"), ("twist", 0.0))
    p.add("hand_l", ("aim", (0.9, -0.36, -0.26), "screen"), ("twist", 0.0))
    p.hand_shape("l", curl=OPEN, spread=11, thumb=OPEN_THUMB)
    p.add("thigh_r", ("aim", (-0.22, -0.95, -0.2), "body"))
    p.add("calf_r", ("aim", (-0.05, 0.6, -0.8), "body"))
    p.add("foot_r", ("aim", (0.0, -0.05, -1.0), "body"))
    p.add("thigh_l", ("aim", (0.22, -0.68, -0.7), "body"))
    p.add("calf_l", ("aim", (0.06, 0.97, -0.2), "body"))
    p.add("foot_l", ("aim", (0.0, 0.75, 0.6), "body"))
    p.apply()
    return p


def swing_c(rig):
    """Variant C: a compact dive along the web, seen from the side. Body stretched toward
    the web, right fist on it, left hand reaching forward under it, knees tucked."""
    p = Poser(rig, turn_deg=-78.0)
    p.add("Root", ("rot", (0, 1, 0), -48.0, "screen"), ("rot", (1, 0, 0), 6.0, "body"))
    p.add("pelvis", ("rot", (1, 0, 0), 18.0, "body"))
    p.add("spine_01", ("rot", (1, 0, 0), -4.0, "body"))
    p.add("spine_02", ("rot", (1, 0, 0), -6.0, "body"))
    p.add("spine_03", ("rot", (1, 0, 0), -6.0, "body"), ("rot", (0, 0, 1), 6.0, "body"))
    p.add("neck_01", ("rot", (1, 0, 0), -10.0, "body"), ("rot", (0, 0, 1), 10.0, "body"))
    p.add("head", ("rot", (1, 0, 0), -14.0, "body"), ("rot", (0, 0, 1), 22.0, "body"))
    p.add("clavicle_r", ("rot", (0, 1, 0), -14.0, "body"))
    p.add("upperarm_r", ("aim", (-0.9, 0.18, 0.4), "screen", "Z", (0.0, -0.6, 0.8), "screen"))
    p.add("lowerarm_r", ("aim", (-0.95, 0.12, 0.29), "screen"), ("twist", 0.0))
    p.add("hand_r", ("aim", (-0.96, 0.08, 0.25), "screen"), ("twist", 0.0))
    p.hand_shape("r", curl=FIST, spread=-3, thumb=FIST_THUMB)
    p.add("clavicle_l", ("rot", (1, 0, 0), -10.0, "body"))
    p.add("upperarm_l", ("aim", (-0.8, -0.35, -0.48), "screen", "Z", (-0.3, -0.3, 0.9), "screen"))
    p.add("lowerarm_l", ("aim", (-0.94, -0.25, -0.2), "screen"), ("twist", 0.0))
    p.add("hand_l", ("aim", (-0.95, -0.2, -0.24), "screen"), ("twist", 0.0))
    p.hand_shape("l", curl=OPEN, spread=11, thumb=OPEN_THUMB)
    p.add("thigh_r", ("aim", (-0.05, -0.92, -0.4), "body"))
    p.add("calf_r", ("aim", (0.0, 0.5, -0.87), "body"))
    p.add("foot_r", ("aim", (0.0, 0.1, -1.0), "body"))
    p.add("thigh_l", ("aim", (0.1, -0.62, -0.78), "body"))
    p.add("calf_l", ("aim", (0.04, 0.93, -0.36), "body"))
    p.add("foot_l", ("aim", (0.0, 0.6, -0.8), "body"))
    p.apply()
    return p


def rest_front(rig):
    """Model sheet: MakeHuman's rest A-pose, from the front."""
    p = Poser(rig, turn_deg=0.0)
    p.apply()
    return p


def rest_three_quarter(rig):
    """Model sheet: rest A-pose, turned three-quarters."""
    p = Poser(rig, turn_deg=-35.0)
    p.apply()
    return p


def rest_back(rig):
    """Model sheet: rest A-pose, from behind."""
    p = Poser(rig, turn_deg=180.0)
    p.apply()
    return p


POSES = {"a": swing_a, "b": swing_b, "c": swing_c, "rest": rest_front, "rest34": rest_three_quarter, "back": rest_back}
