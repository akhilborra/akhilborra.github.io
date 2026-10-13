"""Add a seamless looping animation to the exported bubble-setup GLB.

    python3 tools/animate_glb.py static.glb paths.json out.glb

static.glb  scene exported with:  Blender -b scene.blend --python tools/export_bubble.py -- static.glb --animated
paths.json  bubble trajectories from: Blender -b scene.blend --python tools/bake_bubbles.py -- paths.json 1000

Animation (one loop = one particle lifetime, 187 frames at 24 fps):
  * rotor spins clockwise seen from upstream, REVS whole turns per loop
  * 12-tile LED panel (one row of the scene's 4x4 removed); its light cone rises through the measurement volume
  * drone and met mast materials brightened so they read on a dark background
  * tip-vortex helix rotates with the rotor; for a helix, rotating about its axis is
    the same as convecting downstream (measured handedness: dAngle/dx < 0 in glTF frame)
  * drone propellers spin
  * each bubble follows its simulated path, with births staggered over the loop, and
    respawns at the generator when it reaches the end of its lifetime
"""
import json, math, struct, sys

static, paths_file, out = sys.argv[1:4]
REVS = 3             # rotor revolutions per loop (3 per 7.8 s loop = ~23 rpm)
PROP_REVS = 20       # drone propeller revolutions per loop
KEY_STEP = 2         # bubble keyframe spacing (frames)
R_BUBBLE = 0.12      # drawn radius (m); real bubbles are ~2.5 cm

# ---------- read GLB ----------
raw = open(static, "rb").read()
jlen = struct.unpack("<I", raw[12:16])[0]
gl = json.loads(raw[20:20 + jlen])
p = 20 + jlen
blen = struct.unpack("<I", raw[p:p + 4])[0]
binbuf = bytearray(raw[p + 8:p + 8 + blen])

def add_bytes(data, target=None):
    while len(binbuf) % 4:
        binbuf.append(0)
    off = len(binbuf)
    binbuf.extend(data)
    bv = {"buffer": 0, "byteOffset": off, "byteLength": len(data)}
    if target:
        bv["target"] = target
    gl["bufferViews"].append(bv)
    return len(gl["bufferViews"]) - 1

def accessor(values, typ, comp=5126, minmax=False, target=None):
    n = {"SCALAR": 1, "VEC3": 3, "VEC4": 4}[typ]
    flat = [c for v in values for c in (v if n > 1 else [v])]
    fmt = "<%d%s" % (len(flat), "f" if comp == 5126 else "H")
    acc = {"bufferView": add_bytes(struct.pack(fmt, *flat), target), "componentType": comp,
           "count": len(values), "type": typ}
    if minmax:
        cols = [[v[i] for v in values] for i in range(n)] if n > 1 else [values]
        acc["min"] = [min(c) for c in cols]
        acc["max"] = [max(c) for c in cols]
    gl["accessors"].append(acc)
    return len(gl["accessors"]) - 1

nodes = gl["nodes"]
by_name = {n.get("name"): i for i, n in enumerate(nodes)}
parent = {c: i for i, n in enumerate(nodes) for c in n.get("children", [])}
roots = gl["scenes"][gl.get("scene", 0)]["nodes"]

def qmul(a, b):
    ax, ay, az, aw = a; bx, by, bz, bw = b
    return [aw*bx + ax*bw + ay*bz - az*by, aw*by - ax*bz + ay*bw + az*bx,
            aw*bz + ax*by - ay*bx + az*bw, aw*bw - ax*bx - ay*by - az*bz]

def axis_q(axis, ang):
    s = math.sin(ang / 2)
    return [axis[0]*s, axis[1]*s, axis[2]*s, math.cos(ang / 2)]

# ---------- re-parent the rotor to a clean pivot at the hub ----------
# Tower.001 has non-uniform scale; spinning Rotor.001 beneath it would shear the blades.
rotor, tower = by_name["Rotor.001"], by_name["Tower.001"]
tn, rn = nodes[tower], nodes[rotor]
ts, tt = tn.get("scale", [1, 1, 1]), tn.get("translation", [0, 0, 0])
rs, rt = rn.get("scale", [1, 1, 1]), rn.get("translation", [0, 0, 0])
assert "rotation" not in tn and "rotation" not in rn
nodes[tower]["children"].remove(rotor)
rn["translation"] = [tt[i] + ts[i] * rt[i] for i in range(3)]
rn["scale"] = [ts[i] * rs[i] for i in range(3)]
if all(abs(s - 1) < 1e-3 for s in rn["scale"]):
    del rn["scale"]
roots.append(rotor)

gl.setdefault("animations", [])
samplers, channels = [], []
loop_frames = None

def rotation_track(node, axis, revs, keys_per_rev, sign, T):
    base = nodes[node].get("rotation", [0, 0, 0, 1])
    n = revs * keys_per_rev
    times = [T * k / n for k in range(n + 1)]
    quats = [qmul(base, axis_q(axis, sign * 2 * math.pi * revs * k / n)) for k in range(n + 1)]
    samplers.append({"input": accessor(times, "SCALAR", minmax=True), "output": accessor(quats, "VEC4"),
                     "interpolation": "LINEAR"})
    channels.append({"sampler": len(samplers) - 1, "target": {"node": node, "path": "rotation"}})

# ---------- bubbles ----------
data = json.load(open(paths_file))
W, fps = data["lifetime"], data["fps"]
T = W / fps

# icosahedron mesh shared by every bubble
t_ = (1 + 5 ** 0.5) / 2
iv = [(-1, t_, 0), (1, t_, 0), (-1, -t_, 0), (1, -t_, 0), (0, -1, t_), (0, 1, t_), (0, -1, -t_), (0, 1, -t_),
      (t_, 0, -1), (t_, 0, 1), (-t_, 0, -1), (-t_, 0, 1)]
nrm = [[c / math.sqrt(sum(x * x for x in v)) for c in v] for v in iv]
pos = [[c * R_BUBBLE for c in v] for v in nrm]
faces = [0,11,5, 0,5,1, 0,1,7, 0,7,10, 0,10,11, 1,5,9, 5,11,4, 11,10,2, 10,7,6, 7,1,8,
         3,9,4, 3,4,2, 3,2,6, 3,6,8, 3,8,9, 4,9,5, 2,4,11, 6,2,10, 8,6,7, 9,8,1]
gl["materials"].append({"name": "BubbleGlow", "pbrMetallicRoughness": {"baseColorFactor": [1, 1, 1, 1],
                        "metallicFactor": 0, "roughnessFactor": 0.4}, "emissiveFactor": [0.9, 0.9, 0.9]})
gl["meshes"].append({"name": "Bubble", "primitives": [{
    "attributes": {"POSITION": accessor(pos, "VEC3", minmax=True, target=34962),
                   "NORMAL": accessor(nrm, "VEC3", target=34962)},
    "indices": accessor(faces, "SCALAR", comp=5123, target=34963),
    "material": len(gl["materials"]) - 1}]})
bubble_mesh = len(gl["meshes"]) - 1

to_gl = lambda q: [q[0], q[2], -q[1]]   # Blender Z-up -> glTF Y-up

def at_age(path, a):
    if a >= W - 1:
        return path[-1]
    i = int(a); f = a - i
    return [path[i][k] * (1 - f) + path[i + 1][k] * f for k in range(3)]

group = {"name": "Bubbles", "children": []}
for bi, b in enumerate(data["bubbles"]):
    path = [to_gl(q) for q in b["path"]]
    birth = b["birth"]
    times = sorted(set([float(t) for t in range(0, W, KEY_STEP)] + [float(W)] +
                       ([birth - 1e-3] if birth > 1e-3 else []) + [birth]))
    keys = []
    for t in times:
        a = W - 1 if abs(t - (birth - 1e-3)) < 1e-6 else (t - birth) % W
        keys.append(at_age(path, a))
    nodes.append({"name": "bubble%d" % bi, "mesh": bubble_mesh, "translation": keys[0]})
    group["children"].append(len(nodes) - 1)
    samplers.append({"input": accessor([t / fps for t in times], "SCALAR", minmax=True),
                     "output": accessor(keys, "VEC3"), "interpolation": "LINEAR"})
    channels.append({"sampler": len(samplers) - 1, "target": {"node": len(nodes) - 1, "path": "translation"}})
nodes.append(group)
roots.append(len(nodes) - 1)

# ---------- LED panel: 12 tiles (3 x 4) instead of the scene's 4 x 4 ----------
# drop the row of tiles at x = -4.5 m (Blender coords): Cube.002/.003/.004/.016
DROP = {"Cube.002", "Cube.003", "Cube.004", "Cube.016"}
drop_idx = {i for i, n in enumerate(nodes) if n.get("name") in DROP}
for n in nodes:
    if "children" in n:
        n["children"] = [c for c in n["children"] if c not in drop_idx]
roots[:] = [r for r in roots if r not in drop_idx]

# ---------- light cone from the LED panel into the measurement volume ----------
# LED panel: 3x4 tiles centred at (-6.5, -6) m on the ground; measurement volume ~8-24 m up.
def cone(bottom, r0, top, r1, a0, a1, seg=48, rings=6):
    P, C, I = [], [], []
    for j in range(rings + 1):
        f = j / rings
        c = [bottom[k] + (top[k] - bottom[k]) * f for k in range(3)]
        r = r0 + (r1 - r0) * f
        a = a0 + (a1 - a0) * f ** 0.8
        for i in range(seg):
            th = 2 * math.pi * i / seg
            P.append(to_gl([c[0] + r * math.cos(th), c[1] + r * math.sin(th), c[2]]))
            C.append([1.0, 0.96, 0.86, a])
    for j in range(rings):
        for i in range(seg):
            a, b = j * seg + i, j * seg + (i + 1) % seg
            I += [a, b, a + seg, b, b + seg, a + seg]
    return P, C, I

gl.setdefault("extensionsUsed", [])
if "KHR_materials_unlit" not in gl["extensionsUsed"]:
    gl["extensionsUsed"].append("KHR_materials_unlit")
gl["materials"].append({"name": "LEDBeam", "alphaMode": "BLEND", "doubleSided": True,
                        "pbrMetallicRoughness": {"baseColorFactor": [1, 1, 1, 1], "metallicFactor": 0, "roughnessFactor": 1},
                        "extensions": {"KHR_materials_unlit": {}}})
cp, cc, ci = cone([-6.5, -6, 0.25], 2.2, [-4.8, -6, 25.0], 8.5, 0.30, 0.0)
gl["meshes"].append({"name": "LEDBeam", "primitives": [{
    "attributes": {"POSITION": accessor(cp, "VEC3", minmax=True, target=34962),
                   "COLOR_0": accessor(cc, "VEC4", target=34962)},
    "indices": accessor(ci, "SCALAR", comp=5123, target=34963),
    "material": len(gl["materials"]) - 1}]})
nodes.append({"name": "LEDBeam", "mesh": len(gl["meshes"]) - 1})
roots.append(len(nodes) - 1)

# ---------- brighten parts that disappear on a dark background ----------
LIGHTEN = {
    "body-drone-1": ([0.88, 0.89, 0.88, 1], [0.45, 0.45, 0.45]),   # drone body + tether
    "body-1": ([0.70, 0.71, 0.70, 1], [0.12, 0.12, 0.12]),
    "Material.006": ([0.86, 0.86, 0.84, 1], [0.30, 0.30, 0.29]),   # met mast pole + guy wires
    "USA3D_Steel": ([0.86, 0.86, 0.86, 1], [0.22, 0.22, 0.22]),    # sonic anemometer
    "USA3D_Transducer": ([0.75, 0.75, 0.75, 1], [0.15, 0.15, 0.15]),
    "Material.004": ([1.0, 0.97, 0.88, 1], [1.0, 0.96, 0.85]),     # LED tiles glow
}
for m in gl["materials"]:
    if m.get("name") in LIGHTEN:
        base, emis = LIGHTEN[m["name"]]
        pbr = m.setdefault("pbrMetallicRoughness", {})
        pbr.pop("baseColorTexture", None)
        pbr["baseColorFactor"] = base
        pbr["metallicFactor"] = 0.1
        pbr["roughnessFactor"] = 0.6
        m["emissiveFactor"] = emis
        m.pop("emissiveTexture", None)

# Drone is ~0.7 m across in a 75 m scene; draw it 2.5x larger so it reads from orbit distance
drone = nodes[by_name["Cylinder.002"]]
drone["scale"] = [v * 2.5 for v in drone.get("scale", [1, 1, 1])]

# ---------- rotor, helix, propellers ----------
rotation_track(rotor, [1, 0, 0], REVS, 12, -1, T)
rotation_track(by_name["Helix Strucure"], [1, 0, 0], REVS, 12, -1, T)
for prop in ("Cylinder.008", "Cylinder.010", "Cylinder.011", "Cylinder.012"):
    if prop in by_name:
        rotation_track(by_name[prop], [0, 1, 0], PROP_REVS, 4, 1, T)

gl["animations"].append({"name": "Loop", "samplers": samplers, "channels": channels})

# ---------- write GLB ----------
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
print("wrote", out, "bubbles", len(data["bubbles"]), "loop %.2fs" % T, "size %.1f MB" % (total / 1e6))
