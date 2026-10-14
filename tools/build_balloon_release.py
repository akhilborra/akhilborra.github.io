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

The launch rig (as built by the owner):
  * the DJI drone carries, on four thick strings, a white release HUB: a half-dome with four
    long carbon-fibre rods sticking out horizontally. The hub belongs to the launch system and
    stays with the drone.
  * each balloon's string runs through a rod into the dome; the burn mechanism (heated wires)
    sits inside the dome, at the centre.
  * four balloons sit at the rod tips; each carries its own small radiosonde hanging below it,
    so each balloon is an individual tracer.

Stage 1 (Blender, in memory): starts from the farm scene, removes its 20 static balloon
tracers, adds the "Ground" plane/material (name used by assets/js/site.js), appends the DJI
drone (objects of collection "Drone" in the drone .blend) under an empty "DroneRig", and
builds the hub ("Hub", with the burn glow "Glow" as a child), four balloon tracers
("Balloon1-4": balloon + string + radiosonde), four thick hub strings ("Tether1-4") and four
balloon strings ("BString1-4", rod tip -> balloon). Drone, hub and balloons are all drawn
S_D (4.5x) larger than life. Exports a Draco-compressed GLB.

Stage 2 (pure Python, same file): adds the animation "Release" (LOOP = 20 s):
   0.0- 2.0  drone on the ground; the hub rests on the ground beside it with the four
             balloons at its rod tips (thick strings slack)
   1.0- 2.0  propellers spin up
   2.0- 7.5  vertical climb to release height (drone at ~28 m) upwind of the farm; the thick
             strings go taut and lift the hub, which hangs ~6 m below the drone
   8.3- 9.8  burn wires inside the dome heat up: small orange glow at the dome centre,
             flickering, with a brief small flash at 9.8
   9.8       all four balloon strings burn through at once and vanish
   9.8-18.8  the four balloons (each with its radiosonde) drift downwind (toward -x in
             Blender) through the farm as individual tracers with slightly different speeds
             and paths, spreading apart; they shrink away 18.0-18.8 s
  11.5-16.5  drone hovers, then descends with the hub still hanging below it; the hub
             touches down first and settles beside the drone; props spin down 16.6-17.6
  18.9-19.9  a new set of four balloons grows in at the rod tips -> seamless loop
Turbine rotors turn 4 whole revolutions per loop.
"""
import json, math, os, struct, sys

LOOP = 20.0          # s
FPS = 30             # key rate for the procedural tracks
S_D = 4.5            # drawn scale of drone, hub and balloons
X0, Y0 = 21.0, 13.0  # drone launch spot (Blender coords; wind blows toward -x)
Z_REL = 28.0         # drone (landing-gear) height at release
L_T = 6.0            # drawn length of the thick hub strings (m)
R_GROUND = 5.5       # resting hub distance (downwind) from the drone on the ground (drawn m)
DRONE_BLEND = "/Users/aborra/Documents/Bubble Project/Setup_figures/main_APS_static_animation5.blend"
# thick-string attach points under the drone, drone-rig local (real m, origin = landing-gear bottom centre)
ATTACH = [(0.07, 0.07, 0.075), (-0.07, 0.07, 0.075), (-0.07, -0.07, 0.075), (0.07, -0.07, 0.075)]
# hub geometry, real metres, origin = centre of the dome base
DOME_R = 0.08
ROD_R0, ROD_TIP, ROD_Z = 0.05, 0.42, 0.025       # rods from r=ROD_R0 to r=ROD_TIP at height ROD_Z
HUB_ATTACH = [(0.03 * (1 if i in (0, 3) else -1), 0.03 * (1 if i in (0, 1) else -1), 0.068) for i in range(4)]
ROD_YAW = math.radians(20)                       # rods at 20, 110, 200, 290 deg (reads as 4 from the default view)
DIRS = [(math.cos(ROD_YAW + k * math.pi / 2), math.sin(ROD_YAW + k * math.pi / 2)) for k in range(4)]
BAL_RAD, BAL_SQ = 0.19, 1.08                     # balloon radius and vertical stretch
BAL_OUT, BAL_UP = 0.50, 0.42                     # balloon centre: radius / height in hub frame
BAL_BOTTOM = BAL_RAD * BAL_SQ                    # balloon centre -> balloon bottom (string knot)


# =====================================================================================
# Stage 1: Blender
# =====================================================================================
def stage1(out, drone_blend):
    import bpy, bmesh
    from mathutils import Vector, Matrix
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

    def join(parts, name):
        bpy.ops.object.select_all(action='DESELECT')
        for o in parts:
            o.select_set(True)
        bpy.context.view_layer.objects.active = parts[0]
        bpy.ops.object.join()
        o = bpy.context.object; o.name = name
        o.scale = (S_D,) * 3
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        return o

    def add(parts, op, material, **kw):
        op(**kw); o = bpy.context.object; o.data.materials.append(material); parts.append(o); return o

    # ---- ground (material name "Ground" is recoloured by assets/js/site.js)
    bpy.ops.mesh.primitive_plane_add(size=1, location=(-55, 30.1, 0))
    g = bpy.context.object; g.name = "Ground"; g.scale = (200, 225, 1)
    m = bpy.data.materials.new("Ground"); m.use_nodes = True
    bs = m.node_tree.nodes["Principled BSDF"]
    bs.inputs["Base Color"].default_value = (0.16, 0.3, 0.12, 1); bs.inputs["Roughness"].default_value = 1
    g.data.materials.append(m)

    # ---- hub: white half-dome + four carbon-fibre rods
    white = mat("HubWhite", (0.92, 0.92, 0.9), 0.45)
    carbon = mat("CarbonRod", (0.05, 0.05, 0.06), 0.4)
    parts = []
    dome = add(parts, bpy.ops.mesh.primitive_uv_sphere_add, white, segments=24, ring_count=12, radius=DOME_R)
    bm = bmesh.new(); bm.from_mesh(dome.data)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -1e-5], context='VERTS')
    edge = [e for e in bm.edges if e.is_boundary]
    bmesh.ops.edgeloop_fill(bm, edges=edge)
    bm.to_mesh(dome.data); bm.free()
    L = ROD_TIP - ROD_R0
    for c, s in DIRS:
        add(parts, bpy.ops.mesh.primitive_cylinder_add, carbon, vertices=8, radius=0.008, depth=L,
            location=(c * (ROD_R0 + L / 2), s * (ROD_R0 + L / 2), ROD_Z),
            rotation=(0, math.pi / 2, math.atan2(s, c)))
    hub = join(parts, "Hub")
    hub.location = (X0 - R_GROUND, Y0, 0)
    glow = mat("BurnGlow", (1.0, 0.45, 0.08))
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=8, radius=0.07 * S_D)
    gl_ = bpy.context.object; gl_.name = "Glow"; gl_.data.materials.append(glow)
    gl_.parent = hub; gl_.matrix_parent_inverse = Matrix.Identity(4); gl_.location = (0, 0, 0.03 * S_D)

    # ---- balloon tracer: balloon + short string + radiosonde (origin = balloon centre)
    red = mat("BalloonRed", (0.78, 0.05, 0.04), 0.35)
    sonde = mat("SondeWhite", (0.9, 0.9, 0.88), 0.5)
    thin = mat("BString", (0.85, 0.85, 0.82), 0.6)
    parts = []
    b = add(parts, bpy.ops.mesh.primitive_uv_sphere_add, red, segments=20, ring_count=12, radius=BAL_RAD)
    b.scale = (1, 1, BAL_SQ)
    add(parts, bpy.ops.mesh.primitive_cone_add, red, vertices=10, radius1=0.035, radius2=0.0, depth=0.05,
        location=(0, 0, -BAL_BOTTOM + 0.005), rotation=(math.pi, 0, 0))
    add(parts, bpy.ops.mesh.primitive_cylinder_add, thin, vertices=6, radius=0.004, depth=0.12,
        location=(0, 0, -BAL_BOTTOM - 0.06))
    add(parts, bpy.ops.mesh.primitive_cube_add, sonde, size=1, location=(0, 0, -BAL_BOTTOM - 0.155))
    parts[-1].scale = (0.05, 0.05, 0.07)
    bal = join(parts, "Balloon1")
    balloons = [bal]
    for i in range(2, 5):
        d = bal.copy(); d.name = "Balloon%d" % i; sc.collection.objects.link(d); balloons.append(d)
    for i, o in enumerate(balloons):
        c, s = DIRS[i]
        o.location = (X0 - R_GROUND + c * BAL_OUT * S_D, Y0 + s * BAL_OUT * S_D, BAL_UP * S_D)

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
    bpy.ops.mesh.primitive_cube_add(size=1)
    pl = bpy.context.object; pl.name = "StringMount"; pl.scale = (0.19, 0.19, 0.05)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    pl.data.materials.append(mat("MountDark", (0.08, 0.08, 0.09)))
    pl.parent = rig; pl.matrix_parent_inverse = Matrix.Identity(4); pl.location = (0, 0, 0.105)

    # ---- strings: unit-length cylinders hanging from the origin along -Z (radius in drawn m)
    def string(name, radius, material):
        bpy.ops.mesh.primitive_cylinder_add(vertices=6, radius=radius, depth=1, location=(0, 0, -0.5))
        t = bpy.context.object; t.name = name + "1"
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        t.data.materials.append(material)
        for k in range(2, 5):
            d = t.copy(); d.name = name + str(k); sc.collection.objects.link(d)
    string("Tether", 0.055, mat("Tether", (0.85, 0.85, 0.82)))
    string("BString", 0.022, thin)

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
    print("STAGE1 OK")


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
# per balloon: speed factor, extra lateral (m/s), vertical drift (m/s), bob phase, spin (rad/s)
DRIFT = [(1.00, 0.35, 0.18, 0.4, 0.5), (0.86, 0.30, -0.10, 1.9, -0.4),
         (1.13, -0.35, 0.08, 3.3, 0.3), (0.93, -0.25, -0.18, 4.6, -0.6)]


def drone_pos(t):
    z = Z_REL * (smooth(T_CLIMB0, T_CLIMB1, t) - smooth(T_DESC0, T_DESC1, t))
    if T_CLIMB1 < t < T_DESC0:   # light hover bob
        z += 0.12 * math.sin(2 * math.pi * (t - T_CLIMB1) / 1.7) * smooth(T_CLIMB1, T_CLIMB1 + 0.8, t) \
             * (1 - smooth(T_DESC0 - 0.8, T_DESC0, t))
    return [X0, Y0, z]


def attach_world(t, i):
    return add(drone_pos(t), mulv(ATTACH[i], S_D))


def hub_pos(t):
    """hub origin (dome base centre): resting beside the drone, then dragged in and lifted"""
    a = add(drone_pos(t), [0, 0, 0.075 * S_D])     # centre of the string attach points
    top = 0.068 * S_D
    dz = a[2] - top
    r = math.sqrt(max(L_T ** 2 - dz ** 2, 0.0)) if dz > 0 else R_GROUND
    r = smax(smin(r, R_GROUND, 0.8), 0.0, 0.8)
    z_hang = a[2] - math.sqrt(max(L_T ** 2 - r ** 2, 0.0)) - top
    z = smax(z_hang, 0.0, 0.3) - 0.15                # smooth max(hang, ground); -0.15 = smax offset
    lean = 0.8 * smooth(T_CLIMB0 + 2.0, T_CLIMB1 + 0.5, t) * (1 - smooth(T_DESC0 + 1.0, T_DESC1 - 1.5, t))
    sway = 0.15 * math.sin(1.3 * t) * smooth(T_CLIMB1 - 1, T_CLIMB1, t) * (1 - smooth(T_DESC0, T_DESC0 + 2, t))
    return [X0 - r - lean + sway, Y0, max(z, 0.0)]


def balloon_on_hub(t, i):
    h = hub_pos(t)
    c, s = DIRS[i]
    return [h[0] + c * BAL_OUT * S_D, h[1] + s * BAL_OUT * S_D, h[2] + BAL_UP * S_D]


def balloon_pos(t, i):
    if t >= T_GONE1 + 0.01:            # next set, at the rod tips of the landed hub
        return balloon_on_hub(t - LOOP, i)
    if t < T_CUT:
        return balloon_on_hub(t, i)
    p0 = balloon_on_hub(T_CUT, i)
    f, vy, vz, ph, _ = DRIFT[i]
    tau = t - T_CUT
    dist = U_WIND * f * (tau - TAU * (1 - math.exp(-tau / TAU)))
    return [p0[0] - dist, p0[1] + (DIRS[i][1] * 0.8 + vy) * tau,
            p0[2] + vz * tau + 0.45 * (math.sin(0.9 * tau + ph) - math.sin(ph))]


def balloon_yaw(t, i):
    if t < T_CUT or t >= T_GONE1 + 0.01:
        return 0.0
    return DRIFT[i][4] * (t - T_CUT) * smooth(T_CUT, T_CUT + 1.5, t)


def balloon_scale(t):
    if t < T_GONE0:
        return 1.0
    if t < T_NEW0:
        return 1.0 - smooth(T_GONE0, T_GONE1, t)
    return smooth(T_NEW0, T_NEW1, t)


def build(static, out):
    raw, gl, binbuf = read_glb(static)

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
        elif m.get("name") in ("Tether", "BString"):
            m["emissiveFactor"] = [0.35, 0.35, 0.33]
        elif m.get("name") in ("HubWhite", "SondeWhite"):
            m["emissiveFactor"] = [0.22, 0.22, 0.22]
        elif m.get("name") in ("body-drone-1", "body-1"):
            # light grey so the drone reads on the dark ground (as in tools/animate_glb.py)
            pbr = m.setdefault("pbrMetallicRoughness", {})
            pbr.pop("baseColorTexture", None)
            pbr["baseColorFactor"] = [0.88, 0.89, 0.88, 1] if m["name"] == "body-drone-1" else [0.55, 0.56, 0.55, 1]
            pbr["metallicFactor"] = 0.1; pbr["roughnessFactor"] = 0.6
            m["emissiveFactor"] = [0.35, 0.35, 0.35] if m["name"] == "body-drone-1" else [0.08, 0.08, 0.08]
            m.pop("emissiveTexture", None)
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

    # ---- hub and thick strings (always attached)
    hubs = [hub_pos(t) for t in times]
    track("Hub", "translation", [to_gl(h) for h in hubs])
    unit = [0.0, -1.0, 0.0]   # string meshes hang along local -Y (glTF)

    def strings(name, starts, ends, vis):
        tt, tr, ts = [], [], []
        for a, b, v in zip(starts, ends, vis):
            d = to_gl(sub(b, a)); ln = norm(d)
            tt.append(to_gl(a)); tr.append(q_from_to(unit, [c / ln for c in d]))
            k = ln * v
            ts.append([1.0, k, 1.0] if k > 1e-3 else [0.0, 0.0, 0.0])
        track(name, "translation", tt); track(name, "rotation", tr); track(name, "scale", ts)

    for i in range(4):
        strings("Tether%d" % (i + 1), [attach_world(t, i) for t in times],
                [add(h, mulv(HUB_ATTACH[i], S_D)) for h in hubs], [1.0] * len(times))

    # ---- balloons (each its own tracer) and their strings to the rod tips
    scl = [balloon_scale(t) for t in times]
    for i in range(4):
        c, s = DIRS[i]
        pos = [balloon_pos(t, i) for t in times]
        nm = "Balloon%d" % (i + 1)
        track(nm, "translation", [to_gl(p) for p in pos])
        track(nm, "rotation", [axis_q([0, 1, 0], balloon_yaw(t, i)) for t in times])
        track(nm, "scale", [[v, v, v] for v in scl])
        tips = [add(h, [c * ROD_TIP * S_D, s * ROD_TIP * S_D, ROD_Z * S_D]) for h in hubs]
        knots = [add(p, [0, 0, -BAL_BOTTOM * S_D * v]) for p, v in zip(pos, scl)]
        vis = [0.0 if T_CUT <= t < T_NEW0 else (v if t >= T_NEW0 else 1.0) for t, v in zip(times, scl)]
        strings("BString%d" % (i + 1), tips, knots, vis)

    # ---- burn wires inside the dome: small glow at the centre, flicker, brief small flash
    def heat(t):
        g = smooth(T_HEAT0, T_CUT - 0.2, t) * (1 - smooth(T_CUT + 0.05, T_CUT + 0.45, t))
        return g * (1 + 0.15 * math.sin(2 * math.pi * 7.3 * t) * smooth(T_HEAT0 + 0.5, T_CUT, t)
                    + 0.35 * math.exp(-((t - T_CUT) / 0.12) ** 2))
    track("Glow", "scale", [[heat(t)] * 3 for t in times])

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
