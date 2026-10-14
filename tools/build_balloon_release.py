"""Build assets/models/balloon-release.glb: a looping animation of the drone balloon release.

Run from the repo root. One command (runs both stages inside Blender; nothing is saved back
to the .blend files):

    /Applications/Blender.app/Contents/MacOS/Blender -b \\
        /Users/aborra/Documents/SMARTIES/Visualizations/wind_farm.blend \\
        --python tools/build_balloon_release.py -- assets/models/balloon-release.glb

Optional 2nd argument after "--": the drone .blend (default below, collection "Drone").

Or in two steps (handy when only the animation timing changes):

    Blender -b wind_farm.blend --python tools/build_balloon_release.py -- static.glb --static-only
    python3 tools/build_balloon_release.py static.glb assets/models/balloon-release.glb

Stage 1 (Blender, in memory): starts from the farm scene, removes the 20 static balloon
tracers, keeps one balloon+basket+strings group as a template (red, drawn 2.5x), adds the
"Ground" plane/material (name used by assets/js/site.js), appends the DJI drone from the
drone .blend under an empty "DroneRig" (drawn 4.5x), adds a payload box, four tethers,
four short burn stubs, four burn-wire glow dots and a glow halo, and exports a
Draco-compressed GLB.

Stage 2 (pure Python, same file): adds the animation "Release" (LOOP seconds):
   0.0- 2.0  drone on the ground, four balloons resting around it on 6 m tethers
   1.0- 2.0  propellers spin up
   2.0- 7.5  vertical climb to release height (drone at ~25 m) upwind of the farm;
             tethers go taut, balloons lift off and hang below the payload
   8.3- 9.8  burn wires in the payload heat up: orange emissive glow that grows/flickers
   9.8       strings part: short burnt stubs stay on the payload (and shrink away),
             the cut strings fall back onto the balloons
   9.8-18.6  the four balloons drift downwind (toward -x in Blender) through the
             farm, spreading slightly; they shrink away ~140 m downwind (18.0-18.8)
  11.5-16.5  drone hovers, then descends back to the ground; props spin down 16.6-17.6
  18.8-19.8  a new set of four balloons appears around the landed drone -> seamless loop
Turbine rotors turn 4 whole revolutions per loop.
"""
import json, math, os, struct, sys

LOOP = 20.0          # s
FPS = 30             # key rate for the procedural tracks
S_D = 4.5            # drone drawn scale
S_B = 2.5            # balloon drawn scale
X0, Y0 = 21.0, 13.0  # drone launch spot (Blender coords; wind blows toward -x)
Z_REL = 24.8         # drone (landing-gear) height at release
L_T = 6.0            # drawn tether length (m)
R_HANG = 1.35        # horizontal offset of each hanging balloon from the cluster axis
R_GROUND = 5.0       # resting balloons' distance from the drone on the ground
DRONE_BLEND = "/Users/aborra/Documents/Bubble Project/Setup_figures/main_APS_static_animation5.blend"
# payload burn-wire attach points, drone-rig local (real metres, rig origin = landing-gear bottom centre)
ATTACH = [(0.055, 0.055, 0.075), (-0.055, 0.055, 0.075), (-0.055, -0.055, 0.075), (0.055, -0.055, 0.075)]
DIRS = [(math.cos(a), math.sin(a)) for a in (math.pi / 4, 3 * math.pi / 4, 5 * math.pi / 4, 7 * math.pi / 4)]
BAL_TOP_REST = 0.0   # filled in by stage 1 metadata (height of balloon top above basket bottom)


# =====================================================================================
# Stage 1: Blender
# =====================================================================================
def stage1(out, drone_blend):
    import bpy
    from mathutils import Vector, Matrix
    sc = bpy.context.scene
    # ---- keep one balloon group as template, delete the rest
    keep = {"balon.004", "bascet.004", "Cylinder.016", "Cylinder.017", "Cylinder.018", "Cylinder.019"}
    for o in list(sc.objects):
        if o.name.split(".")[0] in ("balon", "bascet", "Cylinder") and o.name not in keep:
            bpy.data.objects.remove(o, do_unlink=True)
    tmpl = [bpy.data.objects[n] for n in keep]
    bal = bpy.data.objects["balon.004"]
    for mat in bal.data.materials:
        if mat and mat.use_nodes:
            for nd in mat.node_tree.nodes:
                if nd.type == 'BSDF_PRINCIPLED':
                    for l in list(nd.inputs["Base Color"].links):
                        mat.node_tree.links.remove(l)
                    nd.inputs["Base Color"].default_value = (0.75, 0.04, 0.04, 1)
                    nd.inputs["Roughness"].default_value = 0.4
    bpy.ops.object.select_all(action='DESELECT')
    for o in tmpl:
        o.select_set(True)
    bpy.context.view_layer.objects.active = bal
    bpy.ops.object.join()
    unit = bpy.context.object
    unit.name = "Balloon1"
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    me = unit.data
    zs = [v.co.z for v in me.vertices]
    top = max(zs); bot = min(zs)
    loc = unit.location.copy()
    # balloon top (tether attachment) becomes the origin; geometry scaled S_B
    xs = [v.co.x for v in me.vertices]; ys = [v.co.y for v in me.vertices]
    cx = (max(xs) + min(xs)) / 2; cy = (max(ys) + min(ys)) / 2
    for v in me.vertices:
        v.co = Vector(((v.co.x - cx) * S_B, (v.co.y - cy) * S_B, (v.co.z - top) * S_B))
    unit.location = (0, 0, 0)
    height = (top - bot) * S_B
    balloons = [unit]
    for i in range(2, 5):
        d = unit.copy(); d.name = "Balloon%d" % i; sc.collection.objects.link(d); balloons.append(d)

    # ---- ground (material name "Ground" is recoloured by assets/js/site.js)
    bpy.ops.mesh.primitive_plane_add(size=1, location=(-55, 30.1, 0))
    g = bpy.context.object; g.name = "Ground"; g.scale = (200, 225, 1)
    m = bpy.data.materials.new("Ground"); m.use_nodes = True
    bs = m.node_tree.nodes["Principled BSDF"]
    bs.inputs["Base Color"].default_value = (0.16, 0.3, 0.12, 1); bs.inputs["Roughness"].default_value = 1
    g.data.materials.append(m)

    # ---- drone
    with bpy.data.libraries.load(drone_blend, link=False) as (src, dst):
        dst.objects = ["Cylinder.002", "Cylinder.008", "Cylinder.010", "Cylinder.011", "Cylinder.012"]
    objs = [o for o in dst.objects if o]
    body = objs[0]
    for o in objs:
        sc.collection.objects.link(o)
        o.animation_data_clear()
    body.name = "DroneBody"
    for i, o in enumerate(objs[1:]):
        o.name = "DroneProp%d" % (i + 1)
    bpy.context.view_layer.update()
    pts = [body.matrix_world @ Vector(c) for c in body.bound_box]
    for o in objs[1:]:
        pts += [o.matrix_world @ Vector(c) for c in o.bound_box]
    ref = Vector(((min(p.x for p in pts) + max(p.x for p in pts)) / 2,
                  (min(p.y for p in pts) + max(p.y for p in pts)) / 2, min(p.z for p in pts)))
    rig = bpy.data.objects.new("DroneRig", None); sc.collection.objects.link(rig)
    rig.location = (X0, Y0, 0); rig.scale = (S_D,) * 3
    bpy.context.view_layer.update()
    body_w = body.matrix_world.copy()
    body.parent = rig; body.matrix_parent_inverse = Matrix.Identity(4)
    body.matrix_world = rig.matrix_world @ Matrix.Translation(-ref) @ body_w

    def mat(name, rgb, rough=0.6):
        mm = bpy.data.materials.new(name); mm.use_nodes = True
        b = mm.node_tree.nodes["Principled BSDF"]
        b.inputs["Base Color"].default_value = (*rgb, 1); b.inputs["Roughness"].default_value = rough
        return mm

    def child(obj, local):
        obj.parent = rig; obj.matrix_parent_inverse = Matrix.Identity(4); obj.location = local

    bpy.ops.mesh.primitive_cube_add(size=1)
    pl = bpy.context.object; pl.name = "Payload"; pl.scale = (0.17, 0.17, 0.07)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    pl.data.materials.append(mat("PayloadBox", (0.08, 0.08, 0.09)))
    child(pl, (0, 0, 0.115))
    glow = mat("BurnGlow", (1.0, 0.45, 0.08))
    halo = mat("BurnHalo", (1.0, 0.55, 0.15))
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=0.045)
    dot = bpy.context.object; dot.name = "Glow1"; dot.data.materials.append(glow); child(dot, ATTACH[0])
    for i in range(1, 4):
        d = dot.copy(); d.name = "Glow%d" % (i + 1); sc.collection.objects.link(d); child(d, ATTACH[i])
    bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12, radius=0.24)
    h = bpy.context.object; h.name = "GlowHalo"; h.data.materials.append(halo); child(h, (0, 0, 0.09))
    h2 = bpy.data.objects.new("GlowHalo2", h.data.copy()); sc.collection.objects.link(h2)
    h2.data.materials[0] = mat("BurnHaloOuter", (1.0, 0.6, 0.2)); child(h2, (0, 0, 0.09)); h2.scale = (1.8,) * 3

    # tethers: unit-length cylinders hanging from the origin along -Z
    bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=0.05, depth=1, location=(0, 0, -0.5))
    t = bpy.context.object; t.name = "Tether1"
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    t.data.materials.append(mat("Tether", (0.85, 0.85, 0.82)))
    for nm in ["Tether2", "Tether3", "Tether4", "Stub1", "Stub2", "Stub3", "Stub4"]:
        d = t.copy(); d.name = nm; sc.collection.objects.link(d)

    bpy.ops.object.select_all(action='DESELECT')
    for o in sc.objects:
        if o.type in {'MESH', 'CURVE', 'EMPTY'} and not o.hide_render:
            o.select_set(True)
    rig.select_set(True)
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_apply=True,
                              export_animations=False, export_cameras=False, export_lights=False,
                              export_draco_mesh_compression_enable=True,
                              export_draco_mesh_compression_level=7, export_yup=True,
                              export_extras=False)
    # remember the balloon height for stage 2
    raw, gl, binbuf = read_glb(out)
    gl.setdefault("asset", {}).setdefault("extras", {})["balloonHeight"] = height
    write_glb(out, gl, binbuf)
    print("STAGE1 OK balloon height %.2f m, drone ref %s" % (height, tuple(round(v, 3) for v in ref)))


# =====================================================================================
# GLB helpers
# =====================================================================================
def read_glb(path):
    raw = open(path, "rb").read()
    jlen = struct.unpack("<I", raw[12:16])[0]
    gl = json.loads(raw[20:20 + jlen])
    p = 20 + jlen
    blen = struct.unpack("<I", raw[p:p + 4])[0]
    return raw, gl, bytearray(raw[p + 8:p + 8 + blen])


def write_glb(out, gl, binbuf):
    while len(binbuf) % 4:
        binbuf.append(0)
    gl["buffers"][0]["byteLength"] = len(binbuf)
    js = json.dumps(gl, separators=(",", ":")).encode()
    js += b" " * ((4 - len(js) % 4) % 4)
    total = 12 + 8 + len(js) + 8 + len(binbuf)
    with open(out, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(js), 0x4E4F534A)); f.write(js)
        f.write(struct.pack("<II", len(binbuf), 0x004E4942)); f.write(binbuf)
    return total


# =====================================================================================
# Stage 2: animation (pure Python)
# =====================================================================================
def smooth(a, b, t):
    if t <= a: return 0.0
    if t >= b: return 1.0
    u = (t - a) / (b - a)
    return u * u * (3 - 2 * u)


def to_gl(v):
    return [v[0], v[2], -v[1]]


def qmul(a, b):
    ax, ay, az, aw = a; bx, by, bz, bw = b
    return [aw*bx + ax*bw + ay*bz - az*by, aw*by - ax*bz + ay*bw + az*bx,
            aw*bz + ax*by - ay*bx + az*bw, aw*bw - ax*bx - ay*by - az*bz]


def axis_q(axis, ang):
    s = math.sin(ang / 2)
    return [axis[0]*s, axis[1]*s, axis[2]*s, math.cos(ang / 2)]


def q_from_to(u, v):
    """quaternion rotating unit vector u onto unit vector v"""
    d = sum(a * b for a, b in zip(u, v))
    if d < -0.999999:
        return [1.0, 0.0, 0.0, 0.0]
    c = [u[1]*v[2] - u[2]*v[1], u[2]*v[0] - u[0]*v[2], u[0]*v[1] - u[1]*v[0]]
    q = [c[0], c[1], c[2], 1 + d]
    n = math.sqrt(sum(x * x for x in q))
    return [x / n for x in q]


def sub(a, b): return [a[i] - b[i] for i in range(3)]
def add(a, b): return [a[i] + b[i] for i in range(3)]
def mulv(a, s): return [x * s for x in a]
def norm(a): return math.sqrt(sum(x * x for x in a))
def lerpv(a, b, u): return [a[i] + (b[i] - a[i]) * u for i in range(3)]


# ---------------- timeline (Blender coordinates, metres, seconds) ----------------
T_CLIMB0, T_CLIMB1 = 2.0, 7.5
T_HEAT0, T_CUT = 8.3, 9.8
T_DESC0, T_DESC1 = 11.5, 16.5
T_GONE0, T_GONE1 = 18.0, 18.8
T_NEW0, T_NEW1 = 18.8, 19.8
U_WIND = 19.0        # drawn drift speed (m/s, compressed time)
TAU = 0.9            # balloon spin-up time constant after release
SPREAD = [(0.35, 0.10, 0.6), (0.55, -0.12, 2.1), (-0.30, 0.05, 3.7), (-0.55, -0.08, 5.0)]  # vy, vz, phase


def drone_pos(t):
    z = Z_REL * (smooth(T_CLIMB0, T_CLIMB1, t) - smooth(T_DESC0, T_DESC1, t))
    if T_CLIMB1 < t < T_DESC0:   # light hover bob
        z += 0.12 * math.sin(2 * math.pi * (t - T_CLIMB1) / 1.7) * smooth(T_CLIMB1, T_CLIMB1 + 0.8, t) \
             * (1 - smooth(T_DESC0 - 0.8, T_DESC0, t))
    return [X0, Y0, z]


def attach_world(t, i):
    p = drone_pos(t)
    return add(p, mulv(ATTACH[i], S_D))


def tethered_top(t, i, H):
    """balloon-top position while tethered (resting on the ground, then hanging)"""
    a = attach_world(t, i)
    z_rest = H                      # balloon top when the basket sits on the ground
    lean = 0.9 * smooth(T_CLIMB0 + 2.0, T_CLIMB1 + 0.5, t)   # hanging cluster leans downwind
    dx, dy = DIRS[i]
    dz = a[2] - z_rest
    if dz <= 0:
        r = R_GROUND
    else:
        r = math.sqrt(max(L_T ** 2 - dz ** 2, 0.0))
    # soft clamp of the horizontal distance between the resting radius and the hanging radius
    k = 0.6
    r = R_GROUND - (R_GROUND - r + math.sqrt((R_GROUND - r) ** 2 + k * k)) / 2 + k / 2
    r = R_HANG + (r - R_HANG + math.sqrt((r - R_HANG) ** 2 + k * k)) / 2 - k / 2
    zt = math.sqrt(max(L_T ** 2 - r ** 2, 0.0))
    z_hang = a[2] - zt
    z = (z_hang + z_rest + math.sqrt((z_hang - z_rest) ** 2 + 0.3)) / 2   # smooth max(ground, hang)
    sway = 0.15 * math.sin(1.3 * t + i) * smooth(T_CLIMB1 - 1, T_CLIMB1, t)
    return [X0 + dx * r - lean + sway, Y0 + dy * r, z]


def balloon_top(t, i, H):
    if t >= T_NEW0:                 # next set, resting around the landed drone
        return tethered_top(t - LOOP, i, H)
    if t < T_CUT:
        return tethered_top(t, i, H)
    p0 = tethered_top(T_CUT, i, H)
    tau = t - T_CUT
    dist = U_WIND * (tau - TAU * (1 - math.exp(-tau / TAU)))
    vy, vz, ph = SPREAD[i]
    return [p0[0] - dist, p0[1] + vy * tau, p0[2] + vz * tau + 0.5 * math.sin(0.9 * tau + ph) - 0.5 * math.sin(ph)]


def balloon_scale(t):
    if t < T_GONE0 - 1e-9 and t >= 0:
        return 1.0
    if t < T_NEW0:
        return 1.0 - smooth(T_GONE0, T_GONE1, t)
    return smooth(T_NEW0, T_NEW1, t)


def build(static, out):
    raw, gl, binbuf = read_glb(static)
    H = gl["asset"].get("extras", {}).pop("balloonHeight")
    if not gl["asset"]["extras"]:
        del gl["asset"]["extras"]

    def add_bytes(data):
        while len(binbuf) % 4:
            binbuf.append(0)
        off = len(binbuf); binbuf.extend(data)
        gl["bufferViews"].append({"buffer": 0, "byteOffset": off, "byteLength": len(data)})
        return len(gl["bufferViews"]) - 1

    def accessor(values, typ, minmax=False):
        n = {"SCALAR": 1, "VEC3": 3, "VEC4": 4}[typ]
        flat = [c for v in values for c in (v if n > 1 else [v])]
        acc = {"bufferView": add_bytes(struct.pack("<%df" % len(flat), *flat)), "componentType": 5126,
               "count": len(values), "type": typ}
        if minmax:
            acc["min"] = [min(values)]; acc["max"] = [max(values)]
        gl["accessors"].append(acc)
        return len(gl["accessors"]) - 1

    nodes = gl["nodes"]
    by_name = {n.get("name"): i for i, n in enumerate(nodes)}
    samplers, channels = [], []
    nk = int(LOOP * FPS)
    times = [LOOP * k / nk for k in range(nk + 1)]
    t_acc = accessor(times, "SCALAR", minmax=True)
    cache = {}

    def track(node_name, path, values, t_list=None, interp="LINEAR"):
        if t_list is None:
            ti = t_acc
        else:
            key = tuple(round(x, 6) for x in t_list)
            if key not in cache:
                cache[key] = accessor(t_list, "SCALAR", minmax=True)
            ti = cache[key]
        typ = "VEC4" if path == "rotation" else "VEC3"
        samplers.append({"input": ti, "output": accessor(values, typ), "interpolation": interp})
        channels.append({"sampler": len(samplers) - 1, "target": {"node": by_name[node_name], "path": path}})

    # ---- materials: glow (emissive orange), halo (unlit, translucent), tether, balloon
    for m in gl["materials"]:
        if m.get("name") == "BurnGlow":
            m["pbrMetallicRoughness"] = {"baseColorFactor": [1.0, 0.5, 0.1, 1], "metallicFactor": 0, "roughnessFactor": 1}
            m["emissiveFactor"] = [1.0, 0.42, 0.06]
            m["extensions"] = {"KHR_materials_emissive_strength": {"emissiveStrength": 4.0}}
        elif m.get("name") == "BurnHalo":
            m["pbrMetallicRoughness"] = {"baseColorFactor": [1.0, 0.5, 0.1, 0.6], "metallicFactor": 0, "roughnessFactor": 1}
            m["alphaMode"] = "BLEND"
            m["extensions"] = {"KHR_materials_unlit": {}}
        elif m.get("name") == "BurnHaloOuter":
            m["pbrMetallicRoughness"] = {"baseColorFactor": [1.0, 0.45, 0.08, 0.2], "metallicFactor": 0, "roughnessFactor": 1}
            m["alphaMode"] = "BLEND"
            m["extensions"] = {"KHR_materials_unlit": {}}
        elif m.get("name") in ("body-drone-1", "body-1"):
            # light grey so the drone reads on the dark ground (as in tools/animate_glb.py)
            pbr = m.setdefault("pbrMetallicRoughness", {})
            pbr.pop("baseColorTexture", None)
            pbr["baseColorFactor"] = [0.88, 0.89, 0.88, 1] if m["name"] == "body-drone-1" else [0.55, 0.56, 0.55, 1]
            pbr["metallicFactor"] = 0.1; pbr["roughnessFactor"] = 0.6
            m["emissiveFactor"] = [0.35, 0.35, 0.35] if m["name"] == "body-drone-1" else [0.08, 0.08, 0.08]
            m.pop("emissiveTexture", None)
        elif m.get("name") == "Tether":
            m["emissiveFactor"] = [0.35, 0.35, 0.33]
    used = gl.setdefault("extensionsUsed", [])
    for e in ("KHR_materials_unlit", "KHR_materials_emissive_strength"):
        if e not in used:
            used.append(e)

    # ---- drone translation
    rig = nodes[by_name["DroneRig"]]
    track("DroneRig", "translation", [to_gl(drone_pos(t)) for t in times])

    # ---- propellers: spin up 1-2 s, down 16.6-17.6 s; whole revolutions per loop
    def omega(t):
        return smooth(1.0, 2.0, t) * (1 - smooth(T_DESC1 + 0.1, T_DESC1 + 1.1, t))
    ang, angs = 0.0, [0.0]
    for k in range(1, nk + 1):
        ang += 0.5 * (omega(times[k - 1]) + omega(times[k])) * (times[k] - times[k - 1])
        angs.append(ang)
    # ~4.6 rev/s at full speed, rounded so each loop is a whole number of revolutions
    scale_ang = 2 * math.pi * round(4.6 * ang) / ang
    for p in range(1, 5):
        nm = "DroneProp%d" % p
        base = nodes[by_name[nm]].get("rotation", [0, 0, 0, 1])
        track(nm, "rotation", [qmul(base, axis_q([0, 1, 0], (1 if p % 2 else -1) * scale_ang * a)) for a in angs])

    # ---- balloons + tethers + stubs
    unit_up = [0.0, -1.0, 0.0]   # tether mesh hangs along local -Y (glTF)
    for i in range(4):
        tops = [balloon_top(t, i, H) for t in times]
        scl = [balloon_scale(t) for t in times]
        track("Balloon%d" % (i + 1), "translation", [to_gl(p) for p in tops])
        track("Balloon%d" % (i + 1), "scale", [[s, s, s] for s in scl])
        tt, tr, ts = [], [], []
        st, sr, ss = [], [], []
        cut_dir = None
        for t, top, s in zip(times, tops, scl):
            a = attach_world(t, i)
            if t < T_CUT or t >= T_NEW0:
                anchor, d = a, sub(top, a)
                length = norm(d) * s if t >= T_NEW0 else norm(d)
            else:
                if cut_dir is None:
                    a0 = attach_world(T_CUT, i); t0 = balloon_top(T_CUT, i, H)
                    cut_dir = mulv(sub(a0, t0), 1 / norm(sub(a0, t0)))
                u = smooth(T_CUT, T_CUT + 0.9, t)
                # cut string falls back: shortens and trails upwind/up from the balloon top
                up = lerpv(cut_dir, [0.55, 0.0, 0.84], u)
                up = mulv(up, 1 / norm(up))
                ln = (L_T + (1.6 - L_T) * u) * s
                anchor = add(top, mulv(up, ln))
                d = mulv(up, -1.0); length = ln
            dg = to_gl(d); n_ = norm(dg) or 1.0
            tt.append(to_gl(anchor)); tr.append(q_from_to(unit_up, [c / n_ for c in dg]))
            ts.append([1.0, max(length, 0.0) if s > 0 else 0.0, 1.0] if length > 1e-4 else [0.0, 0.0, 0.0])
            # burnt stub left on the payload: appears at the cut, shrinks away over 1.8 s
            if T_CUT <= t < T_CUT + 1.8:
                d0 = sub(balloon_top(T_CUT, i, H), attach_world(T_CUT, i))
                sl = 0.75 * (1 - smooth(T_CUT + 0.3, T_CUT + 1.8, t))
                dg = to_gl(d0); n_ = norm(dg)
                st.append(to_gl(a)); sr.append(q_from_to(unit_up, [c / n_ for c in dg]))
                ss.append([1.0, sl, 1.0] if sl > 1e-3 else [0.0, 0.0, 0.0])
            else:
                st.append(to_gl(a)); sr.append([0, 0, 0, 1]); ss.append([0.0, 0.0, 0.0])
        for nm, (a_, b_, c_) in (("Tether%d" % (i + 1), (tt, tr, ts)), ("Stub%d" % (i + 1), (st, sr, ss))):
            track(nm, "translation", a_); track(nm, "rotation", b_); track(nm, "scale", c_)
            nodes[by_name[nm]]["scale"] = c_[0]
            nodes[by_name[nm]]["translation"] = a_[0]
            nodes[by_name[nm]]["rotation"] = b_[0]
        nodes[by_name["Balloon%d" % (i + 1)]]["translation"] = to_gl(tops[0])

    # ---- burn-wire glow (scales are relative to the S_D-scaled drone rig)
    def heat(t):
        g = smooth(T_HEAT0, T_CUT - 0.3, t) * (1 - smooth(T_CUT + 0.1, T_CUT + 1.2, t))
        return g * (1 + 0.18 * math.sin(2 * math.pi * 7.3 * t) * smooth(T_HEAT0 + 0.5, T_CUT, t))
    for i in range(4):
        vals = []
        for t in times:
            g = heat(t)
            vals.append([g, g, g])
        track("Glow%d" % (i + 1), "scale", vals)
        nodes[by_name["Glow%d" % (i + 1)]]["scale"] = [0.0, 0.0, 0.0]
    halo = []
    for t in times:
        g = heat(t) * (1 + 0.6 * math.exp(-((t - T_CUT) / 0.25) ** 2))   # flash at the moment of release
        halo.append([g, g, g])
    track("GlowHalo", "scale", halo)
    nodes[by_name["GlowHalo"]]["scale"] = [0.0, 0.0, 0.0]
    track("GlowHalo2", "scale", [[1.8 * v[0]] * 3 for v in halo])
    nodes[by_name["GlowHalo2"]]["scale"] = [0.0, 0.0, 0.0]

    # ---- turbine rotors: 4 whole revolutions per loop about the shaft (Blender x axis = glTF x)
    REVS, KPR = 4, 12
    rt = [LOOP * k / (REVS * KPR) for k in range(REVS * KPR + 1)]
    for n in list(nodes):
        nm = n.get("name", "")
        if nm.startswith("Blade "):
            base = n.get("rotation", [0, 0, 0, 1])
            track(nm, "rotation", [qmul(axis_q([1, 0, 0], -2 * math.pi * REVS * t / LOOP), base) for t in rt], t_list=rt)

    gl.setdefault("animations", []).append({"name": "Release", "samplers": samplers, "channels": channels})
    total = write_glb(out, gl, binbuf)
    print("wrote %s  %.2f MB  animation 'Release' %.1f s, %d channels" % (out, total / 1e6, LOOP, len(channels)))


# =====================================================================================
if __name__ == "__main__":
    try:
        import bpy  # noqa: F401
        in_blender = True
    except ImportError:
        in_blender = False
    if in_blender:
        args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
        out = args[0]
        static_only = "--static-only" in args
        rest = [a for a in args[1:] if not a.startswith("--")]
        drone = rest[0] if rest else DRONE_BLEND
        if static_only:
            stage1(out, drone)
        else:
            tmp = out + ".static.glb"
            stage1(tmp, drone)
            build(tmp, out)
            os.remove(tmp)
    else:
        build(sys.argv[1], sys.argv[2])
