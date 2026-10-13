"""Add a seamless looping animation to the exported bubble-setup GLB.

    python3 tools/animate_glb.py static.glb paths.json out.glb

static.glb  scene exported with:  Blender -b scene.blend --python tools/export_bubble.py -- static.glb --animated
paths.json  bubble trajectories from: Blender -b scene.blend --python tools/bake_bubbles.py -- paths.json 1000

Animation (one loop = one particle lifetime, 187 frames at 24 fps):
  * rotor spins clockwise seen from upstream, REVS whole turns per loop
  * tip-vortex helix rotates with the rotor; for a helix, rotating about its axis is
    the same as convecting downstream (measured handedness: dAngle/dx < 0 in glTF frame)
  * drone propellers spin
  * each bubble follows its simulated path, with births staggered over the loop, and
    respawns at the generator when it reaches the end of its lifetime
"""
import json, math, struct, sys

static, paths_file, out = sys.argv[1:4]
REVS = 5             # rotor revolutions per loop
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
