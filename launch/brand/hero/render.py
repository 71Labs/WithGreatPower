"""
Renders The Node mid-swing in the game's comic style, on a transparent background.

    blender -b launch/brand/hero/build/hero-base.blend -P launch/brand/hero/render.py -- \
        --pose a --out launch/brand/hero/hero-swing.png [--height 2200] [--quick] [--no-web]

  --pose     a pose name from posing.POSES
  --height   pixel height of the figure itself (the canvas adds margins and the web strand)
  --quick    workbench preview (seconds) for checking a pose
  --no-web   leave out the web strand

The render's frame: the camera looks along +y, so "screen" directions in posing.py are
world directions. A JSON sidecar (<out>.json) records where the fist and the strand land
in the image, so the header can line the strand up with its own web.
"""

import json
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import posing  # noqa: E402

INK = (0.0080, 0.0080, 0.0080)  # #141414 in linear
WEB_SLOPE = 0.25  # the header's web rises 1 px for every 4 px to the left


def srgb(hexstr):
    h = hexstr.lstrip("#")
    c = [int(h[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple((x / 12.92) if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c) + (1.0,)


# The sticker red and its comic shading bands (shadows lean toward the night's blue-violet).
SUIT = {
    "deep": srgb("#5e1330"),
    "shadow": srgb("#9c1f2c"),
    "mid": srgb("#c92c26"),
    "base": srgb("#e5392c"),
    "light": srgb("#f45f45"),
    "spec": srgb("#ff9d7c"),
    "rim": srgb("#ffd9a0"),
}


def args():
    a = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    out = {"pose": "a", "out": os.path.join(HERE, "hero-swing.png"), "height": 2200, "quick": False, "web": True}
    i = 0
    while i < len(a):
        k = a[i]
        if k == "--pose":
            out["pose"] = a[i + 1]
            i += 1
        elif k == "--out":
            out["out"] = os.path.abspath(a[i + 1])
            i += 1
        elif k == "--height":
            out["height"] = int(a[i + 1])
            i += 1
        elif k == "--quick":
            out["quick"] = True
        elif k == "--no-web":
            out["web"] = False
        i += 1
    return out


# ---------------------------------------------------------------------------------------
# Materials


def nodes_of(mat):
    mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    return nt, nt.nodes, nt.links


def math_node(nodes, links, op, a=None, b=None, c=None, clamp=False):
    n = nodes.new("ShaderNodeMath")
    n.operation = op
    n.use_clamp = clamp
    for i, v in enumerate((a, b, c)):
        if v is None:
            continue
        if isinstance(v, (int, float)):
            n.inputs[i].default_value = v
        else:
            links.new(v, n.inputs[i])
    return n.outputs[0]


def attr(nodes, name):
    n = nodes.new("ShaderNodeAttribute")
    n.attribute_type = "GEOMETRY"
    n.attribute_name = name
    sep = nodes.new("ShaderNodeSeparateXYZ")
    nodes.id_data.links.new(n.outputs["Vector"], sep.inputs[0])
    return sep.outputs[0], sep.outputs[1], sep.outputs[2]


def web_mask(nodes, links, width=0.0036, aa=0.0010):
    """1 on the ink web lines, 0 elsewhere (see build.web_fields for the attributes)."""
    M = lambda op, a=None, b=None, c=None, clamp=False: math_node(nodes, links, op, a, b, c, clamp)  # noqa: E731
    cx, sx, d = attr(nodes, "web_p")
    rho, N, S = attr(nodes, "web_q")
    A, B, _kind = attr(nodes, "web_r")
    theta = M("ARCTAN2", sx, cx)
    # t: position between neighbouring radial lines, 0..1
    tr = M("MULTIPLY", M("DIVIDE", theta, 2 * math.pi), N)
    t = M("FRACT", tr)
    tm = M("MINIMUM", t, M("SUBTRACT", 1.0, t))
    # Radial line distance in metres.
    dist_rad = M("MULTIPLY", M("MULTIPLY", tm, M("DIVIDE", 2 * math.pi, N)), rho)
    radial = smoothstep_inv(nodes, links, dist_rad, width, aa)
    # Ring sag f = 4t(1-t)
    f = M("MULTIPLY", 4.0, M("MULTIPLY", t, M("SUBTRACT", 1.0, t)))
    denom = M("MULTIPLY", S, M("SUBTRACT", 1.0, M("MULTIPLY", B, f)))
    q = M("DIVIDE", M("ADD", d, M("MULTIPLY", A, f)), denom)
    qf = M("SUBTRACT", q, M("ROUND", q))
    dist_ring = M("MULTIPLY", M("ABSOLUTE", qf), denom)
    ring = smoothstep_inv(nodes, links, dist_ring, width, aa)
    # No rings at the very centre, where radials converge anyway.
    ring = M("MULTIPLY", ring, M("GREATER_THAN", q, 0.6))
    # Radial cells keep a clean hub: radials start at the first ring, so the centre is a
    # plain disc ringed in ink (no star that could read as an emblem).
    hub = M("GREATER_THAN", q, 0.97)
    radial = M("MULTIPLY", radial, M("MAXIMUM", hub, M("GREATER_THAN", A, 0.0001)))
    return M("MAXIMUM", radial, ring, clamp=True)


def smoothstep_inv(nodes, links, x, edge, aa):
    """1 where x < edge - aa, 0 where x > edge + aa."""
    n = nodes.new("ShaderNodeMapRange")
    n.interpolation_type = "SMOOTHSTEP"
    links.new(x, n.inputs["Value"])
    n.inputs["From Min"].default_value = edge - aa
    n.inputs["From Max"].default_value = edge + aa
    n.inputs["To Min"].default_value = 1.0
    n.inputs["To Max"].default_value = 0.0
    return n.outputs["Result"]


def cel_ramp(nodes, links, fac, stops):
    ramp = nodes.new("ShaderNodeValToRGB")
    cr = ramp.color_ramp
    cr.interpolation = "LINEAR"
    while len(cr.elements) > 1:
        cr.elements.remove(cr.elements[-1])
    first = True
    for pos, col in stops:
        if first:
            cr.elements[0].position = pos
            cr.elements[0].color = col
            first = False
        else:
            e = cr.elements.new(pos)
            e.color = col
    links.new(fac, ramp.inputs["Fac"])
    return ramp.outputs["Color"]


def light_terms(nodes, links):
    """Lambert light from the scene's key, as a 0..1 value via Shader to RGB."""
    diff = nodes.new("ShaderNodeBsdfDiffuse")
    diff.inputs["Color"].default_value = (1, 1, 1, 1)
    s2r = nodes.new("ShaderNodeShaderToRGB")
    links.new(diff.outputs[0], s2r.inputs[0])
    bw = nodes.new("ShaderNodeRGBToBW")
    links.new(s2r.outputs["Color"], bw.inputs[0])
    return bw.outputs[0]


def rim_term(nodes, links, M, rim_dir):
    """A hard rim on the edges that face rim_dir (world), from the view angle."""
    lw = nodes.new("ShaderNodeLayerWeight")
    lw.inputs["Blend"].default_value = 0.5
    geo = nodes.new("ShaderNodeNewGeometry")
    dot = nodes.new("ShaderNodeVectorMath")
    dot.operation = "DOT_PRODUCT"
    links.new(geo.outputs["Normal"], dot.inputs[0])
    dot.inputs[1].default_value = Vector(rim_dir).normalized()
    edge = smoothstep_inv(nodes, links, lw.outputs["Facing"], 0.62, 0.03)
    edge = M("SUBTRACT", 1.0, edge)
    side = M("GREATER_THAN", dot.outputs["Value"], 0.25)
    return M("MULTIPLY", edge, side)


def halftone(nodes, links, M, res, spacing_px, radius):
    """Screen-space dots, 1 inside a dot."""
    tc = nodes.new("ShaderNodeTexCoord")
    sep = nodes.new("ShaderNodeSeparateXYZ")
    links.new(tc.outputs["Window"], sep.inputs[0])
    x = M("MULTIPLY", sep.outputs[0], res[0] / spacing_px)
    y = M("MULTIPLY", sep.outputs[1], res[1] / spacing_px)
    # 45° screen: rotate the lattice.
    xr = M("ADD", x, y)
    yr = M("SUBTRACT", x, y)
    fx = M("SUBTRACT", M("FRACT", M("MULTIPLY", xr, 0.7071)), 0.5)
    fy = M("SUBTRACT", M("FRACT", M("MULTIPLY", yr, 0.7071)), 0.5)
    r = M("SQRT", M("ADD", M("MULTIPLY", fx, fx), M("MULTIPLY", fy, fy)))
    return smoothstep_inv(nodes, links, r, radius, 0.06)


def make_suit(res):
    mat = bpy.data.materials.get("Suit") or bpy.data.materials.new("Suit")
    nt, nodes, links = nodes_of(mat)
    M = lambda op, a=None, b=None, c=None, clamp=False: math_node(nodes, links, op, a, b, c, clamp)  # noqa: E731
    light = light_terms(nodes, links)
    # Ambient occlusion deepens the creases between muscles before banding.
    ao = nodes.new("ShaderNodeAmbientOcclusion")
    ao.samples = 16
    ao.inputs["Distance"].default_value = 0.08
    aof = M("ADD", 0.55, M("MULTIPLY", ao.outputs["AO"], 0.45))
    lit = M("MULTIPLY", light, aof)
    col = cel_ramp(
        nodes,
        links,
        lit,
        [
            (0.0, SUIT["deep"]),
            (0.07, SUIT["deep"]),
            (0.1, SUIT["shadow"]),
            (0.22, SUIT["shadow"]),
            (0.25, SUIT["mid"]),
            (0.4, SUIT["mid"]),
            (0.43, SUIT["base"]),
            (0.7, SUIT["base"]),
            (0.73, SUIT["light"]),
            (0.9, SUIT["light"]),
            (0.93, SUIT["spec"]),
        ],
    )
    # Halftone dots in the shadow bands.
    dots = halftone(nodes, links, M, res, 9.0, 0.24)
    in_shadow = M("MULTIPLY", smoothstep_inv(nodes, links, lit, 0.24, 0.02), M("GREATER_THAN", lit, 0.06))
    dot_mix = nodes.new("ShaderNodeMix")
    dot_mix.data_type = "RGBA"
    links.new(M("MULTIPLY", dots, M("MULTIPLY", in_shadow, 0.55)), dot_mix.inputs["Factor"])
    links.new(col, dot_mix.inputs["A"])
    dot_mix.inputs["B"].default_value = SUIT["deep"]
    col = dot_mix.outputs["Result"]
    # Rim light from the moon (screen left, behind).
    rim = rim_term(nodes, links, M, (-0.9, 0.35, 0.3))
    rim_mix = nodes.new("ShaderNodeMix")
    rim_mix.data_type = "RGBA"
    links.new(M("MULTIPLY", rim, 0.85), rim_mix.inputs["Factor"])
    links.new(col, rim_mix.inputs["A"])
    rim_mix.inputs["B"].default_value = SUIT["rim"]
    col = rim_mix.outputs["Result"]
    # Ink web.
    web = web_mask(nodes, links)
    ink_mix = nodes.new("ShaderNodeMix")
    ink_mix.data_type = "RGBA"
    links.new(web, ink_mix.inputs["Factor"])
    links.new(col, ink_mix.inputs["A"])
    ink_mix.inputs["B"].default_value = INK + (1.0,)
    emit = nodes.new("ShaderNodeEmission")
    links.new(ink_mix.outputs["Result"], emit.inputs["Color"])
    out = nodes.new("ShaderNodeOutputMaterial")
    links.new(emit.outputs[0], out.inputs["Surface"])
    return mat


def make_flat(name, stops):
    """White lens / black rim: banded but nearly flat."""
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    nt, nodes, links = nodes_of(mat)
    light = light_terms(nodes, links)
    col = cel_ramp(nodes, links, light, stops)
    emit = nodes.new("ShaderNodeEmission")
    links.new(col, emit.inputs["Color"])
    out = nodes.new("ShaderNodeOutputMaterial")
    links.new(emit.outputs[0], out.inputs["Surface"])
    return mat


def make_ink():
    mat = bpy.data.materials.get("Ink") or bpy.data.materials.new("Ink")
    nt, nodes, links = nodes_of(mat)
    emit = nodes.new("ShaderNodeEmission")
    emit.inputs["Color"].default_value = INK + (1.0,)
    # The hull is a shell around the body: it must not shadow what's inside it.
    lp = nodes.new("ShaderNodeLightPath")
    clear = nodes.new("ShaderNodeBsdfTransparent")
    mix = nodes.new("ShaderNodeMixShader")
    links.new(lp.outputs["Is Shadow Ray"], mix.inputs["Fac"])
    links.new(emit.outputs[0], mix.inputs[1])
    links.new(clear.outputs[0], mix.inputs[2])
    out = nodes.new("ShaderNodeOutputMaterial")
    links.new(mix.outputs[0], out.inputs["Surface"])
    mat.use_backface_culling = True
    for attr_name, val in (("use_transparent_shadow", True), ("use_backface_culling_shadow", True)):
        if hasattr(mat, attr_name):
            setattr(mat, attr_name, val)
    return mat


def add_hull(ob, ink, thickness, group=None):
    if ink.name not in [m.name for m in ob.data.materials if m]:
        ob.data.materials.append(ink)
    idx = [m.name for m in ob.data.materials].index(ink.name)
    mod = ob.modifiers.new("InkHull", "SOLIDIFY")
    mod.thickness = thickness
    mod.offset = 1.0
    mod.use_flip_normals = True
    mod.use_rim = False
    mod.use_even_offset = False
    mod.use_quality_normals = False
    mod.material_offset = idx
    mod.material_offset_rim = idx
    if group:
        mod.vertex_group = group
    return mod


# ---------------------------------------------------------------------------------------
# Scene


def evaluated_points(objs):
    dg = bpy.context.evaluated_depsgraph_get()
    pts = []
    for ob in objs:
        ev = ob.evaluated_get(dg)
        me = ev.to_mesh()
        mw = ob.matrix_world
        pts.extend(mw @ v.co for v in me.vertices)
        ev.to_mesh_clear()
    return pts


def project(cam, p, focal, sensor):
    rel = p - cam.location
    depth = rel.y
    return Vector((rel.x / depth * focal / sensor, rel.z / depth * focal / sensor))


def frame_camera(pts, figure_px, extra_left=None, margin=0.06):
    """Camera looking +y at the points; resolution set so the figure is figure_px tall."""
    sc = bpy.context.scene
    cd = bpy.data.cameras.new("HeroCam")
    cd.lens = 70.0
    cd.sensor_fit = "AUTO"
    cd.sensor_width = 36.0
    cam = bpy.data.objects.new("HeroCam", cd)
    sc.collection.objects.link(cam)
    sc.camera = cam
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    c = (lo + hi) / 2
    cam.location = Vector((c.x, lo.y - 5.5, c.z))
    cam.rotation_euler = (math.radians(90), 0, 0)  # looks along +y
    uv = [project(cam, p, cd.lens, cd.sensor_width) for p in pts]
    u0, u1 = min(q.x for q in uv), max(q.x for q in uv)
    v0, v1 = min(q.y for q in uv), max(q.y for q in uv)
    fig_h = v1 - v0
    pad = fig_h * margin
    u0 -= pad
    u1 += pad
    v0 -= pad
    v1 += pad
    if extra_left is not None:
        u0 = min(u0, extra_left)
    W, H = u1 - u0, v1 - v0
    scale = 1.0 / max(W, H)
    cd.lens *= scale
    px_per_unit = figure_px / fig_h
    sc.render.resolution_x = int(round(W * px_per_unit))
    sc.render.resolution_y = int(round(H * px_per_unit))
    sc.render.resolution_percentage = 100
    cd.shift_x = (u0 + u1) / 2 * scale
    cd.shift_y = (v0 + v1) / 2 * scale
    return cam


def to_pixel(cam, p):
    sc = bpy.context.scene
    from bpy_extras.object_utils import world_to_camera_view

    co = world_to_camera_view(sc, cam, p)
    return (co.x * sc.render.resolution_x, (1 - co.y) * sc.render.resolution_y)


def add_strand(start, length=3.0, radius=0.0045):
    """The web: a thin white line from the fist off to the left, rising at WEB_SLOPE."""
    d = Vector((-1.0, 0.0, WEB_SLOPE)).normalized()
    bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=radius, depth=length, location=start + d * (length / 2 - 0.01))
    ob = bpy.context.active_object
    ob.name = "Web"
    ob.rotation_euler = d.to_track_quat("Z", "Y").to_euler()
    bpy.ops.object.shade_smooth()
    return ob


def setup_world_and_lights():
    sc = bpy.context.scene
    world = sc.world or bpy.data.worlds.new("World")
    sc.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs["Color"].default_value = (0.0, 0.0, 0.0, 1.0)
        bg.inputs["Strength"].default_value = 0.0
    sun_d = bpy.data.lights.new("Key", "SUN")
    sun_d.energy = 3.2
    sun_d.angle = math.radians(2.0)
    sun = bpy.data.objects.new("Key", sun_d)
    sc.collection.objects.link(sun)
    # From the upper left of the picture (the moon), a little in front of the hero.
    to_light = Vector((-0.75, -0.55, 0.65)).normalized()
    sun.rotation_euler = (-to_light).to_track_quat("-Z", "Y").to_euler()
    return sun


def render_settings(quick, out):
    sc = bpy.context.scene
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    sc.render.image_settings.color_depth = "8"
    sc.render.filepath = out
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.look = "None"
    if quick:
        sc.render.engine = "BLENDER_WORKBENCH"
        sc.display.shading.light = "STUDIO"
        sc.display.shading.color_type = "MATERIAL"
        sc.display.shading.show_cavity = True
        sc.display.shading.show_object_outline = True
        return
    sc.render.engine = "BLENDER_EEVEE"
    ee = sc.eevee
    ee.taa_render_samples = 64
    try:
        ee.use_shadows = True
    except AttributeError:
        pass
    sc.render.use_freestyle = True
    sc.render.line_thickness_mode = "ABSOLUTE"
    vl = sc.view_layers[0]
    vl.use_freestyle = True
    fs = vl.freestyle_settings
    fs.crease_angle = math.radians(120)
    for ls in list(fs.linesets):
        fs.linesets.remove(ls)
    ls = fs.linesets.new("Inner")
    ls.select_by_visibility = True
    ls.visibility = "VISIBLE"
    ls.select_by_edge_types = True
    ls.select_silhouette = True
    ls.select_border = False
    ls.select_crease = True
    ls.select_contour = True
    ls.select_external_contour = False
    ls.select_by_collection = True
    ls.collection = bpy.data.collections.get("Lines")
    lst = ls.linestyle
    lst.color = INK
    lst.thickness = 3.2
    lst.thickness_position = "CENTER"
    lst.caps = "ROUND"
    lst.chaining = "PLAIN"
    # Taper the strokes a little so they read as brush ink.
    mod = lst.thickness_modifiers.new("Taper", "ALONG_STROKE")
    mod.mapping = "CURVE"
    mod.blend = "MULTIPLY"
    curve = mod.curve
    pts = curve.curves[0].points
    pts[0].location = (0.0, 0.35)
    pts[-1].location = (1.0, 0.35)
    pts.new(0.5, 1.0)
    curve.update()


def main():
    o = args()
    sc = bpy.context.scene
    rig = bpy.data.objects["NodeRig"]
    body = bpy.data.objects["Node"]
    p = posing.POSES[o["pose"]](rig)
    bpy.context.view_layer.update()

    # Grip point: inside the curled fingers of the right fist.
    grip = (p.head("index_01_r") + p.head("pinky_01_r")) / 2
    grip = grip + (rig.matrix_world.to_3x3() @ p.palm("r")) * 0.022 + (p.head("index_01_r") - p.head("hand_r")) * 0.15

    pts = evaluated_points([body])
    res_guess = (3000, 3000)
    # Strand: reserve room to its left of 0.9 of the figure's larger side, so at header
    # scale it always reaches past the moon window's rim (~200 header px left of the fist).
    fig_h = max(q.z for q in pts) - min(q.z for q in pts)
    fig_w = max(q.x for q in pts) - min(q.x for q in pts)
    left = grip + Vector((-1.0, 0.0, WEB_SLOPE)).normalized() * max(fig_h, fig_w) * 0.9
    cam = frame_camera(pts + ([grip, left] if o["web"] else []), o["height"])
    res = (sc.render.resolution_x, sc.render.resolution_y)

    lines = bpy.data.collections.new("Lines")
    sc.collection.children.link(lines)
    for c in list(body.users_collection):
        c.objects.unlink(body)
    lines.objects.link(body)

    ink = make_ink()
    suit = make_suit(res)
    lens = make_flat("Lens", [(0.0, srgb("#c9d3e6")), (0.3, srgb("#c9d3e6")), (0.33, srgb("#ffffff"))])
    rim = make_flat("LensRim", [(0.0, srgb("#141414")), (1.0, srgb("#141414"))])
    mats = {m.name: m for m in (suit, lens, rim)}
    for i, m in enumerate(body.data.materials):
        if m and m.name in mats:
            body.data.materials[i] = mats[m.name]
    # Subdivide for a smooth silhouette, then the ink hull over everything.
    sub = body.modifiers.new("Smooth", "SUBSURF")
    sub.levels = 1
    sub.render_levels = 2 if not o["quick"] else 1
    if "hull" not in body.vertex_groups:
        vg = body.vertex_groups.new(name="hull")
        lens_idx = {i for i, m in enumerate(body.data.materials) if m and m.name in ("Lens", "LensRim")}
        keep = [v.index for v in body.data.vertices]
        vg.add(keep, 1.0, "REPLACE")
        lens_verts = {v for poly in body.data.polygons if poly.material_index in lens_idx for v in poly.vertices}
        vg.add(list(lens_verts), 0.0, "REPLACE")
    add_hull(body, ink, 0.011, group="hull")
    for poly in body.data.polygons:
        poly.use_smooth = True

    meta = {"pose": o["pose"], "resolution": list(res)}
    if o["web"]:
        web = add_strand(grip)
        web.data.materials.append(lens)
        add_hull(web, ink, 0.0035)
        meta["fist_px"] = list(to_pixel(cam, grip))
        meta["strand_slope"] = WEB_SLOPE
        meta["strand_note"] = "the strand leaves the fist toward the left edge, rising 1 px per 4 px"
    else:
        meta["fist_px"] = list(to_pixel(cam, grip))
    head_top = max(pts, key=lambda q: q.z)
    meta["figure_px_height"] = o["height"]

    setup_world_and_lights()
    render_settings(o["quick"], o["out"])
    bpy.ops.render.render(write_still=True)
    with open(os.path.splitext(o["out"])[0] + ".json", "w") as f:
        json.dump(meta, f, indent=2)
    print("[render] wrote", o["out"], meta)


if __name__ == "__main__":
    main()
