"""Build assets/models/balloon-release.glb: a looping animation of the drone balloon release.

Run from the repo root. One command (runs both stages inside Blender; nothing is saved back
to the .blend files):

    /Applications/Blender.app/Contents/MacOS/Blender -b \\
        /Users/aborra/Documents/SMARTIES/Visualizations/wind_farm.blend \\
        --python tools/build_balloon_release.py -- assets/models/balloon-release.glb

Optional 2nd argument after "--": the drone .blend (default DRONE_BLEND below).

Or in two steps (handy when only the animation timing changes):

    Blender -b wind_farm.blend --python tools/build_balloon_release.py -- static.glb --static-only
    python3 tools/build_balloon_release.py static.glb assets/models/balloon-release.glb

Stage 1 (Blender, in memory): starts from the farm scene, removes its 20 static balloon
tracers, adds the "Ground" plane/material (name used by assets/js/site.js), appends the DJI
drone (objects of collection "Drone" in the drone .blend) under an empty "DroneRig", adds a
small payload box with four burn-wire glow dots, four strings, and one balloon tracer
"Tracer" modelled on the real one: four red balloons on a light cross-shaped frame around a
small white central sensor, slightly tilted. Drone and tracer are both drawn S_D (4.5x)
larger than life. Exports a Draco-compressed GLB.

Stage 2 (pure Python, same file): adds the animation "Release" (LOOP = 20 s):
   0.0- 2.0  drone on the ground, tracer resting on the ground beside it (strings slack)
   1.0- 2.0  propellers spin up
   2.0- 7.5  vertical climb to release height (drone at ~28 m) upwind of the farm; the
             strings converge from the drone's underside to the tracer hub, go taut,
             and lift the tracer, which then hangs ~8 m below the drone
   8.3- 9.8  burn wires in the payload heat up: four small orange emissive dots at the
             string attachment points, flickering, with a brief small flash at 9.8
   9.8       strings vanish (burnt through); the tracer is released as one unit
   9.8-18.8  the tracer (4 balloons + frame + sensor) drifts downwind (toward -x in
             Blender) through the farm, slowly turning; it shrinks away 18.0-18.8 s
  11.5-16.5  drone hovers, then descends back to the ground; props spin down 16.6-17.6
  18.9-19.9  a new tracer (and its strings) appears beside the landed drone -> seamless loop
Turbine rotors turn 4 whole revolutions per loop.
"""
import json, math, os, struct, sys

LOOP = 20.0          # s
FPS = 30             # key rate for the procedural tracks
S_D = 4.5            # drawn scale of the drone and of the tracer
X0, Y0 = 21.0, 13.0  # drone launch spot (Blender coords; wind blows toward -x)
Z_REL = 28.0         # drone (landing-gear) height at release
L_T = 8.0            # drawn string length (m), drone underside -> tracer hub
R_GROUND = 6.5       # resting tracer hub distance (downwind) from the drone on the ground
DRONE_BLEND = "/Users/aborra/Documents/Bubble Project/Setup_figures/main_APS_static_animation5.blend"
# string attach points / burn wires, drone-rig local (real metres, rig origin = landing-gear bottom centre)
ATTACH = [(0.07, 0.07, 0.075), (-0.07, 0.07, 0.075), (-0.07, -0.07, 0.075), (0.07, -0.07, 0.075)]
HUB_TOP = 0.05       # string convergence point above the tracer origin (real metres)


# =====================================================================================
# Stage 1: Blender
# =====================================================================================
def stage1(out, drone_blend):
    import bpy
    from mathutils import Vector, Matrix, Euler
    sc = bpy.context.scene
    sc.cursor.location = (0, 0, 0)
    for o in list(sc.objects):
        if o.name.split(".")[0] in ("balon", "bascet", "Cylinder"):
            bpy.data.objects.remove(o, do_unlink=True)

    def mat(name, rgb, rough=0.6):
        mm = bpy.data.materials.new(name); mm.use_nodes = True
        b = mm.node_tree.nodes["Principled BSDF"]
        b.inputs["Base Color"].default_value = (*rgb, 1); b.inputs["Roughness"].default_value = rough
        return mm

    # ---- ground (material name "Ground" is recoloured by assets/js/site.js)
    bpy.ops.mesh.primitive_plane_add(size=1, location=(-55, 30.1, 0))
    g = bpy.context.object; g.name = "Ground"; g.scale = (200, 225, 1)
    m = bpy.data.materials.new("Ground"); m.use_nodes = True
    bs = m.node_tree.nodes["Principled BSDF"]
    bs.inputs["Base Color"].default_value = (0.16, 0.3, 0.12, 1); bs.inputs["Roughness"].default_value = 1
    g.data.materials.append(m)

    # ---- tracer: 4 balloons on a cross frame around a central sensor (real size, then x S_D)
    red = mat("BalloonRed", (0.78, 0.05, 0.04), 0.35)
    white = mat("SensorWhite", (0.92, 0.92, 0.9), 0.5)
    dark = mat("SensorDark", (0.08, 0.08, 0.09), 0.5)
    frame = mat("FrameArm", (0.85, 0.85, 0.82), 0.5)
    parts = []

    def add(op, material, **kw):
        op(**kw); o = bpy.context.object; o.data.materials.append(material); parts.append(o); return o
    add(bpy.ops.mesh.primitive_cylinder_add, white, vertices=24, radius=0.075, depth=0.05,
        rotation=(math.pi / 2, 0, 0))
    add(bpy.ops.mesh.primitive_cylinder_add, dark, vertices=24, radius=0.045, depth=0.058,
        rotation=(math.pi / 2, 0, 0))
    ARM = 0.40
    for k, (dz, rb) in enumerate([(0.03, 0.20), (-0.07, 0.19), (0.0, 0.21), (-0.12, 0.20)]):
        a = math.pi / 4 + k * math.pi / 2
        c, s = math.cos(a), math.sin(a)
        add(bpy.ops.mesh.primitive_cylinder_add, frame, vertices=6, radius=0.009, depth=ARM,
            location=(c * ARM / 2, s * ARM / 2, dz / 2), rotation=(0, math.pi / 2 - math.atan2(dz, ARM), a))
        b = add(bpy.ops.mesh.primitive_uv_sphere_add, red, segments=20, ring_count=12, radius=rb,
                location=(c * (ARM + rb * 0.9), s * (ARM + rb * 0.9), dz))
        b.scale = (1, 1, 1.08)
        add(bpy.ops.mesh.primitive_ico_sphere_add, red, subdivisions=1, radius=0.03,
            location=(c * (ARM - 0.01), s * (ARM - 0.01), dz))
    bpy.ops.object.select_all(action='DESELECT')
    for o in parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    tr = bpy.context.object; tr.name = "Tracer"
    tr.rotation_euler = Euler((math.radians(18), math.radians(-8), 0))   # slightly tilted ring
    tr.scale = (S_D,) * 3
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    tracer_bottom = -min(v.co.z for v in tr.data.vertices)    # drawn height of hub above lowest point
    tr.location = (X0 - R_GROUND, Y0, tracer_bottom)

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

    def child(obj, local):
        obj.parent = rig; obj.matrix_parent_inverse = Matrix.Identity(4); obj.location = local

    bpy.ops.mesh.primitive_cube_add(size=1)
    pl = bpy.context.object; pl.name = "Payload"; pl.scale = (0.19, 0.19, 0.07)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    pl.data.materials.append(mat("PayloadBox", (0.08, 0.08, 0.09)))
    child(pl, (0, 0, 0.115))
    glow = mat("BurnGlow", (1.0, 0.45, 0.08))
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=0.045)
    dot = bpy.context.object; dot.name = "Glow1"; dot.data.materials.append(glow); child(dot, ATTACH[0])
    for i in range(1, 4):
        d = dot.copy(); d.name = "Glow%d" % (i + 1); sc.collection.objects.link(d); child(d, ATTACH[i])

    # strings: unit-length cylinders hanging from the origin along -Z
    bpy.ops.mesh.primitive_cylinder_add(vertices=6, radius=0.03, depth=1, location=(0, 0, -0.5))
    t = bpy.context.object; t.name = "Tether1"
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    t.data.materials.append(mat("Tether", (0.85, 0.85, 0.82)))
    for nm in ["Tether2", "Tether3", "Tether4"]:
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
    raw, gl, binbuf = read_glb(out)
    gl.setdefault("asset", {}).setdefault("extras", {})["tracerBottom"] = tracer_bottom
    write_glb(out, gl, binbuf)
    print("STAGE1 OK tracer hub %.2f m above its lowest point" % tracer_bottom)


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


def smax(a, b, k):
    return (a + b + math.sqrt((a - b) ** 2 + k * k)) / 2


def smin(a, b, k):
    return (a + b - math.sqrt((a - b) ** 2 + k * k)) / 2


# ---------------- timeline (Blender coordinates, metres, seconds) ----------------
T_CLIMB0, T_CLIMB1 = 2.0, 7.5
T_HEAT0, T_CUT = 8.3, 9.8
T_DESC0, T_DESC1 = 11.5, 16.5
T_GONE0, T_GONE1 = 18.0, 18.8
T_NEW0, T_NEW1 = 18.9, 19.9
U_WIND = 19.0        # drawn drift speed (m/s, compressed time)
TAU = 0.9            # spin-up time constant of the drift after release


def drone_pos(t):
    z = Z_REL * (smooth(T_CLIMB0, T_CLIMB1, t) - smooth(T_DESC0, T_DESC1, t))
    if T_CLIMB1 < t < T_DESC0:   # light hover bob
        z += 0.12 * math.sin(2 * math.pi * (t - T_CLIMB1) / 1.7) * smooth(T_CLIMB1, T_CLIMB1 + 0.8, t) \
             * (1 - smooth(T_DESC0 - 0.8, T_DESC0, t))
    return [X0, Y0, z]


def attach_world(t, i):
    return add(drone_pos(t), mulv(ATTACH[i], S_D))


def tethered_hub(t, hb):
    """tracer origin while on its strings: resting on the ground, then dragged in and lifted"""
    a = add(drone_pos(t), [0, 0, 0.075 * S_D])     # centre of the string attach points
    top = HUB_TOP * S_D
    z_rest = hb
    dz = a[2] - (z_rest + top)
    r = math.sqrt(max(L_T ** 2 - dz ** 2, 0.0)) if dz > 0 else R_GROUND
    r = smax(smin(r, R_GROUND, 0.8), 0.0, 0.8)
    z_hang = a[2] - math.sqrt(max(L_T ** 2 - r ** 2, 0.0)) - top
    z = smax(z_hang, z_rest, 0.5)
    lean = 0.9 * smooth(T_CLIMB0 + 2.0, T_CLIMB1 + 0.5, t)   # hanging tracer leans downwind
    sway = 0.15 * math.sin(1.3 * t) * smooth(T_CLIMB1 - 1, T_CLIMB1, t)
    return [X0 - r - lean + sway, Y0, z]


def hub_pos(t, hb):
    if t >= T_GONE1 + 0.01:            # next tracer, resting beside the landed drone
        return tethered_hub(t - LOOP, hb)
    if t < T_CUT:
        return tethered_hub(t, hb)
    p0 = tethered_hub(T_CUT, hb)
    tau = t - T_CUT
    dist = U_WIND * (tau - TAU * (1 - math.exp(-tau / TAU)))
    return [p0[0] - dist, p0[1] + 0.35 * tau, p0[2] + 0.06 * tau + 0.5 * math.sin(0.9 * tau)]


def hub_yaw(t):
    if t >= T_GONE1 + 0.01:
        t -= LOOP
    if t < T_CUT:
        return 0.2 * math.sin(0.8 * t) * smooth(T_CLIMB0 + 1.5, T_CLIMB1, t)
    return 0.2 * math.sin(0.8 * T_CUT) + 0.35 * (t - T_CUT) * smooth(T_CUT, T_CUT + 1.5, t)


def tracer_scale(t):
    if t < T_GONE0:
        return 1.0
    if t < T_NEW0:
        return 1.0 - smooth(T_GONE0, T_GONE1, t)
    return smooth(T_NEW0, T_NEW1, t)


def build(static, out):
    raw, gl, binbuf = read_glb(static)
    hb = gl["asset"].get("extras", {}).pop("tracerBottom")
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

    def track(node_name, path, values, t_list=None):
        if t_list is None:
            ti = t_acc
        else:
            key = tuple(round(x, 6) for x in t_list)
            if key not in cache:
                cache[key] = accessor(t_list, "SCALAR", minmax=True)
            ti = cache[key]
        typ = "VEC4" if path == "rotation" else "VEC3"
        samplers.append({"input": ti, "output": accessor(values, typ), "interpolation": "LINEAR"})
        channels.append({"sampler": len(samplers) - 1, "target": {"node": by_name[node_name], "path": path}})
        nodes[by_name[node_name]][path] = values[0]

    # ---- materials
    for m in gl["materials"]:
        if m.get("name") == "BurnGlow":
            m["pbrMetallicRoughness"] = {"baseColorFactor": [1.0, 0.22, 0.0, 1], "metallicFactor": 0, "roughnessFactor": 1}
            m["emissiveFactor"] = [0.85, 0.13, 0.0]
            m["extensions"] = {"KHR_materials_emissive_strength": {"emissiveStrength": 1.0}}
        elif m.get("name") == "Tether":
            m["emissiveFactor"] = [0.35, 0.35, 0.33]
        elif m.get("name") in ("body-drone-1", "body-1"):
            # light grey so the drone reads on the dark ground (as in tools/animate_glb.py)
            pbr = m.setdefault("pbrMetallicRoughness", {})
            pbr.pop("baseColorTexture", None)
            pbr["baseColorFactor"] = [0.88, 0.89, 0.88, 1] if m["name"] == "body-drone-1" else [0.55, 0.56, 0.55, 1]
            pbr["metallicFactor"] = 0.1; pbr["roughnessFactor"] = 0.6
            m["emissiveFactor"] = [0.35, 0.35, 0.35] if m["name"] == "body-drone-1" else [0.08, 0.08, 0.08]
            m.pop("emissiveTexture", None)
        elif m.get("name") == "SensorWhite":
            m["emissiveFactor"] = [0.25, 0.25, 0.25]
    used = gl.setdefault("extensionsUsed", [])
    if "KHR_materials_emissive_strength" not in used:
        used.append("KHR_materials_emissive_strength")

    # ---- drone
    track("DroneRig", "translation", [to_gl(drone_pos(t)) for t in times])

    # ---- propellers: spin up 1-2 s, down 16.6-17.6 s; whole revolutions per loop
    def omega(t):
        return smooth(1.0, 2.0, t) * (1 - smooth(T_DESC1 + 0.1, T_DESC1 + 1.1, t))
    ang, angs = 0.0, [0.0]
    for k in range(1, nk + 1):
        ang += 0.5 * (omega(times[k - 1]) + omega(times[k])) * (times[k] - times[k - 1])
        angs.append(ang)
    scale_ang = 2 * math.pi * round(4.6 * ang) / ang     # ~4.6 rev/s at full speed
    for p in range(1, 5):
        nm = "DroneProp%d" % p
        base = nodes[by_name[nm]].get("rotation", [0, 0, 0, 1])
        track(nm, "rotation", [qmul(base, axis_q([0, 1, 0], (1 if p % 2 else -1) * scale_ang * a)) for a in angs])

    # ---- tracer
    hubs = [hub_pos(t, hb) for t in times]
    scl = [tracer_scale(t) for t in times]
    track("Tracer", "translation", [to_gl(h) for h in hubs])
    track("Tracer", "rotation", [axis_q([0, 1, 0], hub_yaw(t)) for t in times])
    track("Tracer", "scale", [[s, s, s] for s in scl])

    # ---- strings: drone underside -> tracer hub; gone between the release and the next tracer
    unit = [0.0, -1.0, 0.0]   # string mesh hangs along local -Y (glTF)
    for i in range(4):
        tt, tr, ts = [], [], []
        for t, h, s in zip(times, hubs, scl):
            a = attach_world(t, i)
            d = to_gl(sub(add(h, [0, 0, HUB_TOP * S_D * s]), a))
            ln = norm(d)
            visible = t < T_CUT or t >= T_NEW0
            tt.append(to_gl(a)); tr.append(q_from_to(unit, [c / ln for c in d]))
            k = ln * (s if t >= T_NEW0 else 1.0)
            ts.append([1.0, k, 1.0] if visible and k > 1e-3 else [0.0, 0.0, 0.0])
        nm = "Tether%d" % (i + 1)
        track(nm, "translation", tt); track(nm, "rotation", tr); track(nm, "scale", ts)

    # ---- burn wires: small dots glow and flicker, brief small flash, gone 0.4 s after release
    def heat(t):
        g = smooth(T_HEAT0, T_CUT - 0.2, t) * (1 - smooth(T_CUT + 0.05, T_CUT + 0.4, t))
        return g * (1 + 0.2 * math.sin(2 * math.pi * 7.3 * t) * smooth(T_HEAT0 + 0.5, T_CUT, t)
                    + 0.7 * math.exp(-((t - T_CUT) / 0.12) ** 2))
    for i in range(4):
        track("Glow%d" % (i + 1), "scale", [[heat(t)] * 3 for t in times])

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
        rest = [a for a in args[1:] if not a.startswith("--")]
        drone = rest[0] if rest else DRONE_BLEND
        if "--static-only" in args:
            stage1(out, drone)
        else:
            tmp = out + ".static.glb"
            stage1(tmp, drone)
            build(tmp, out)
            os.remove(tmp)
    else:
        build(sys.argv[1], sys.argv[2])
