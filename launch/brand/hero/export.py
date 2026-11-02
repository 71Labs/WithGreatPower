"""
Exports The Node for the game: launch/brand/hero/hero.glb.

    blender -b launch/brand/hero/build/hero-base.blend -P launch/brand/hero/export.py -- \
        [--tris 16000] [--tex 2048] [--out launch/brand/hero/hero.glb] [--game]

What goes in:
  - the suited body (lens shells included) in MakeHuman's rest A-pose, decimated to about
    --tris triangles (symmetric; hands, face and lenses keep more detail);
  - the "game_engine" skeleton (53 bones) with MakeHuman's skin weights (≤ 4 per vertex);
  - one material whose base colour is a baked --tex² texture of the suit's flat colours: the
    sticker red, the ink web, white lenses, black rims. No lighting is baked; the game's cel
    shader does that.
Axes: glTF +Y up, the hero faces +Z, his left (the _l bones) is +X. Units are metres; the
hero is about 1.89 m tall with the soles at y = 0.

--game writes the in-game model instead (apps/wgp/public/models/hero.glb and hero-lo.glb):
no texture, UVs or material. The game's cel shader draws everything from three custom
vertex attributes the glTF loader hands over as-is:
  - _web_p, _web_q, _web_r: build.py's web coordinates (per face corner), with the lens and
    rim shells marked by web_r.z = 8 and 9;
  - _ao: ambient occlusion per vertex (0 dark … 1 open), from rays against the full body
    that only count the same limb (so a crease darkens, but an arm resting by the side
    leaves no shadow on the ribs once it's raised).
"""

import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import render as R  # noqa: E402  (shader helpers; render.main() only runs as a script)


def args():
    a = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    o = {"tris": 16000, "tex": 2048, "out": os.path.join(HERE, "hero.glb"), "game": False}
    for i, k in enumerate(a):
        if k == "--game":
            o["game"] = True
        elif k == "--tris":
            o["tris"] = int(a[i + 1])
        elif k == "--tex":
            o["tex"] = int(a[i + 1])
        elif k == "--out":
            o["out"] = os.path.abspath(a[i + 1])
    return o


def tri_count(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    me = ob.evaluated_get(dg).to_mesh()
    n = sum(len(p.vertices) - 2 for p in me.polygons)
    ob.evaluated_get(dg).to_mesh_clear()
    return n


def albedo_material(name):
    """Flat suit colours for baking: red + ink web (same pattern as the render)."""
    mat = bpy.data.materials.new(name)
    nt, nodes, links = R.nodes_of(mat)
    web = R.web_mask(nodes, links)
    mix = nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    links.new(web, mix.inputs["Factor"])
    mix.inputs["A"].default_value = R.srgb("#e5392c")
    mix.inputs["B"].default_value = R.INK + (1.0,)
    emit = nodes.new("ShaderNodeEmission")
    links.new(mix.outputs["Result"], emit.inputs["Color"])
    out = nodes.new("ShaderNodeOutputMaterial")
    links.new(emit.outputs[0], out.inputs["Surface"])
    return mat


def flat_material(name, hexcol):
    mat = bpy.data.materials.new(name)
    nt, nodes, links = R.nodes_of(mat)
    emit = nodes.new("ShaderNodeEmission")
    emit.inputs["Color"].default_value = R.srgb(hexcol)
    out = nodes.new("ShaderNodeOutputMaterial")
    links.new(emit.outputs[0], out.inputs["Surface"])
    return mat


# ---------------------------------------------------------------------------------------
# --game: the in-game model

# Kinds in web_r.z past build.py's web cells (0–6): the lens shells.
KIND_LENS = 8.0
KIND_RIM = 9.0
AO_RAYS = 48
AO_DIST = 0.07  # metres: crease scale, not whole-limb shadows
AO_LIMIT = 4  # ray restarts past hits on other limbs


def segment_of(bone):
    """The body part a bone belongs to, for AO: torso (with head), arm, hand or leg, per side."""
    base = bone.split("_")[0]
    side = bone[-1] if bone.endswith(("_l", "_r")) else ""
    if base in ("hand", "thumb", "index", "middle", "ring", "pinky"):
        return "hand_" + side
    if base in ("upperarm", "lowerarm"):
        return "arm_" + side
    if base in ("thigh", "calf", "foot", "ball"):
        return "leg_" + side
    return "torso"


def vertex_segments(ob):
    names = {g.index: segment_of(g.name) for g in ob.vertex_groups}
    out = []
    for v in ob.data.vertices:
        best = max(v.groups, key=lambda g: g.weight, default=None)
        out.append(names.get(best.group, "torso") if best else "torso")
    return out


def counts_against(own, other):
    """Whether geometry of segment `other` may shade segment `own` (it stays near in any pose)."""
    if own == other:
        return True
    a, b = sorted((own, other))
    return a.startswith("arm_") and b.startswith("hand_") and a[-1] == b[-1]


def hemisphere(n):
    """Cosine-weighted directions about +z (a Fibonacci spiral, so the result is deterministic)."""
    golden = math.pi * (3 - math.sqrt(5))
    out = []
    for i in range(n):
        u = (i + 0.5) / n
        r = math.sqrt(u)
        a = i * golden
        out.append(Vector((r * math.cos(a), r * math.sin(a), math.sqrt(1 - u))))
    return out


def bake_ao(low, high, lens_slots):
    """Per-vertex AO for `low`, from rays against the full-resolution body."""
    from mathutils.bvhtree import BVHTree

    hv = [v.co.copy() for v in high.data.vertices]
    hseg = vertex_segments(high)
    polys, pseg = [], []
    for p in high.data.polygons:
        if p.material_index in lens_slots:
            continue
        polys.append(tuple(p.vertices))
        pseg.append(hseg[p.vertices[0]])
    bvh = BVHTree.FromPolygons(hv, polys)
    dirs = hemisphere(AO_RAYS)
    lseg = vertex_segments(low)
    lens_v = set()
    for p in low.data.polygons:
        if p.material_index in lens_slots:
            lens_v.update(p.vertices)
    ao = [1.0] * len(low.data.vertices)
    for v in low.data.vertices:
        if v.index in lens_v:
            continue
        n = v.normal.normalized()
        frame = n.to_track_quat("Z", "Y")
        hit_sum = 0.0
        for d0 in dirs:
            d = frame @ d0
            o = v.co + n * 0.002
            left = AO_DIST
            for _ in range(AO_LIMIT):
                loc, nrm, idx, dist = bvh.ray_cast(o, d, left)
                if loc is None:
                    break
                # Hits from inside the surface, or on another limb, don't occlude: carry on past them.
                if nrm.dot(d) < 0 and counts_against(lseg[v.index], pseg[idx]):
                    hit_sum += 1.0 - 0.5 * (AO_DIST - left + dist) / AO_DIST
                    break
                o = loc + d * 1e-4
                left -= dist + 1e-4
                if left <= 0:
                    break
        ao[v.index] = 1.0 - hit_sum / len(dirs)
    # Two smoothing passes over the edges, then soften the hands (their fingers move).
    edges = [tuple(e.vertices) for e in low.data.edges]
    for _ in range(2):
        acc = list(ao)
        cnt = [1] * len(ao)
        for a, b in edges:
            acc[a] += ao[b]
            acc[b] += ao[a]
            cnt[a] += 1
            cnt[b] += 1
        ao = [x / c if i not in lens_v else 1.0 for i, (x, c) in enumerate(zip(acc, cnt))]
    for i, s in enumerate(lseg):
        if s.startswith("hand_"):
            ao[i] = 0.55 + 0.45 * ao[i]
    return ao


def resample_web(low, high, lens_slots):
    """Give every corner of `low` the web coordinates of the full-resolution body under it.

    Decimation interpolates corner data face by face, so two faces sharing a vertex can end up
    disagreeing about its web coordinates, and the rings break into jagged steps along the
    edges. Sampling the high mesh's own corners at each vertex's nearest point on its cell
    makes them agree again (and the exporter splits fewer vertices)."""
    from mathutils.bvhtree import BVHTree
    from mathutils.interpolate import poly_3d_calc

    hme, lme = high.data, low.data
    names = ("web_p", "web_q", "web_r")
    hattr = [hme.attributes[n].data for n in names]
    lattr = [lme.attributes[n].data for n in names]
    verts = [v.co for v in hme.vertices]
    cells = {}
    for p in hme.polygons:
        if p.material_index in lens_slots:
            continue
        cells.setdefault(round(hattr[2][p.loop_start].vector[2]), []).append(p.index)
    trees = {c: (BVHTree.FromPolygons(verts, [tuple(hme.polygons[i].vertices) for i in idx]), idx) for c, idx in cells.items()}
    cache = {}
    for p in lme.polygons:
        if p.material_index in lens_slots:
            continue
        cell = round(lattr[2][p.loop_start].vector[2])
        tree, idx = trees[cell]
        for li in range(p.loop_start, p.loop_start + p.loop_total):
            vi = lme.loops[li].vertex_index
            key = (vi, cell)
            if key not in cache:
                loc, _n, fi, _d = tree.find_nearest(lme.vertices[vi].co)
                hp = hme.polygons[idx[fi]]
                w = poly_3d_calc([verts[v] for v in hp.vertices], loc)
                cache[key] = [sum((hattr[a][hp.loop_start + k].vector * w[k] for k in range(hp.loop_total)), Vector()) for a in range(3)]
            for a in range(3):
                lattr[a][li].vector = cache[key][a]


def game_export(o, sc, rig, high, low, lens_slots, names):
    me = low.data
    for p in me.polygons:
        p.use_smooth = True
    resample_web(low, high, lens_slots)
    # Lens and rim shells: marked in the web kind (they carry no web of their own).
    r = me.attributes["web_r"].data
    for p in me.polygons:
        if p.material_index in lens_slots:
            kind = KIND_LENS if names[p.material_index] == "Lens" else KIND_RIM
            for li in range(p.loop_start, p.loop_start + p.loop_total):
                r[li].vector = (0.0, 0.0, kind)
    for name in ("web_p", "web_q", "web_r"):
        me.attributes[name].name = "_" + name
    if "rest" in me.attributes:
        me.attributes.remove(me.attributes["rest"])
    ao = bake_ao(low, high, lens_slots)
    me.attributes.new("_ao", "FLOAT", "POINT").data.foreach_set("value", ao)
    print(f"[export] AO: min {min(ao):.2f}, mean {sum(ao) / len(ao):.2f}")
    kinds = sorted({round(d.vector[2], 3) for d in me.attributes["_web_r"].data})
    print("[export] web kinds:", kinds[:16], "…" if len(kinds) > 16 else "")
    me.materials.clear()

    bpy.data.objects.remove(high, do_unlink=True)
    for ob in list(sc.objects):
        if ob not in (low, rig):
            bpy.data.objects.remove(ob, do_unlink=True)
    low.parent = rig
    bpy.ops.object.select_all(action="DESELECT")
    low.select_set(True)
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    os.makedirs(os.path.dirname(o["out"]), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=o["out"],
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
    )
    print("[export] wrote", o["out"], f"{os.path.getsize(o['out']) / 1e6:.2f} MB")


def main():
    o = args()
    sc = bpy.context.scene
    rig = bpy.data.objects["NodeRig"]
    high = bpy.data.objects["Node"]
    for pb in rig.pose.bones:
        pb.matrix_basis.identity()
    rig.data.pose_position = "REST"

    # High: the baking source, with the flat colour materials.
    names = [m.name if m else "" for m in high.data.materials]
    flat = {"Suit": albedo_material("BakeSuit"), "Lens": flat_material("BakeLens", "#ffffff"), "LensRim": flat_material("BakeRim", "#141414")}
    for i, n in enumerate(names):
        if n in flat:
            high.data.materials[i] = flat[n]

    # Low: a decimated copy.
    low = high.copy()
    low.data = high.data.copy()
    low.name = low.data.name = "TheNode"
    sc.collection.objects.link(low)
    protect = low.vertex_groups.new(name="decimate_protect")
    keep = set()
    lens_slots = {i for i, n in enumerate(names) if n in ("Lens", "LensRim")}
    hand_groups = {g.index for g in low.vertex_groups if g.name.split("_")[0] in ("hand", "thumb", "index", "middle", "ring", "pinky", "head")}
    for p in low.data.polygons:
        if p.material_index in lens_slots:
            keep.update(p.vertices)
    for v in low.data.vertices:
        if any(g.group in hand_groups and g.weight > 0.3 for g in v.groups):
            keep.add(v.index)
    protect.add(list(keep), 1.0, "REPLACE")
    before = tri_count(low)
    dec = low.modifiers.new("Decimate", "DECIMATE")
    dec.decimate_type = "COLLAPSE"
    dec.use_symmetry = True
    dec.symmetry_axis = "X"
    if not o["game"]:
        dec.vertex_group = protect.name
        dec.vertex_group_factor = 0.6
    # (In collapse mode a vertex group picks which vertices may collapse at all: weight 1 is
    # decimated, so the group above thins the hands, face and lenses rather than protecting
    # them. The game model leaves it out; the quadric error keeps fingers and lenses anyway.)
    # The armature modifier must stay last (and unapplied): decimate first.
    bpy.context.view_layer.objects.active = low
    while low.modifiers[0].name != dec.name:
        bpy.ops.object.modifier_move_up(modifier=dec.name)
    lo, hi = 0.05, 1.0
    for _ in range(14):
        dec.ratio = (lo + hi) / 2
        if tri_count(low) > o["tris"]:
            hi = dec.ratio
        else:
            lo = dec.ratio
    dec.ratio = lo
    protect_name = protect.name
    bpy.ops.object.modifier_apply(modifier=dec.name)
    low.vertex_groups.remove(low.vertex_groups[protect_name])
    print(f"[export] decimated {before} → {tri_count(low)} triangles, {len(low.data.vertices)} vertices")
    if o["game"]:
        game_export(o, sc, rig, high, low, lens_slots, names)
        return
    for name in [a.name for a in low.data.attributes]:
        if name.startswith("web_") or name == "rest":
            low.data.attributes.remove(low.data.attributes[name])

    # UVs for the baked texture.
    bpy.ops.object.select_all(action="DESELECT")
    low.select_set(True)
    bpy.context.view_layer.objects.active = low
    while low.data.uv_layers:
        low.data.uv_layers.remove(low.data.uv_layers[0])
    low.data.uv_layers.new(name="UVMap")
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.004, area_weight=0.0, scale_to_bounds=True)
    bpy.ops.object.mode_set(mode="OBJECT")

    # One material on the low mesh with the image to bake into.
    img = bpy.data.images.new("TheNode_albedo", o["tex"], o["tex"], alpha=False)
    img.colorspace_settings.name = "sRGB"
    mat = bpy.data.materials.new("TheNodeSuit")
    nt, nodes, links = R.nodes_of(mat)
    tex = nodes.new("ShaderNodeTexImage")
    tex.image = img
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Roughness"].default_value = 0.6
    links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    out = nodes.new("ShaderNodeOutputMaterial")
    links.new(bsdf.outputs[0], out.inputs["Surface"])
    nodes.active = tex
    low.data.materials.clear()
    low.data.materials.append(mat)
    for p in low.data.polygons:
        p.material_index = 0
        p.use_smooth = True

    # Bake high → low (both at rest, same place).
    sc.render.engine = "CYCLES"
    sc.cycles.samples = 4
    sc.cycles.device = "CPU"
    sc.render.bake.use_selected_to_active = True
    sc.render.bake.cage_extrusion = 0.012
    sc.render.bake.max_ray_distance = 0.03
    sc.render.bake.margin = 6
    bpy.ops.object.select_all(action="DESELECT")
    high.select_set(True)
    low.select_set(True)
    bpy.context.view_layer.objects.active = low
    bpy.ops.object.bake(type="EMIT")
    img.filepath_raw = os.path.join(HERE, "build", "hero-albedo.png")
    img.file_format = "PNG"
    img.save()
    img.pack()
    print("[export] baked", img.filepath_raw)

    # Export the low mesh and the skeleton only.
    bpy.data.objects.remove(high, do_unlink=True)
    for ob in list(sc.objects):
        if ob not in (low, rig):
            bpy.data.objects.remove(ob, do_unlink=True)
    low.parent = rig
    bpy.ops.object.select_all(action="DESELECT")
    low.select_set(True)
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.export_scene.gltf(
        filepath=o["out"],
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=False,
        export_skins=True,
        export_animations=False,
        export_morph=False,
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_def_bones=False,
        export_influence_nb=4,
        export_all_influences=False,
    )
    print("[export] wrote", o["out"], f"{os.path.getsize(o['out']) / 1e6:.2f} MB")


main()
