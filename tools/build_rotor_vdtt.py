"""Build the SCHEMATIC rotor-in-tunnel GLB: MoWiTO 0.6 model turbine in a test-section cut-away.

    python3 tools/build_rotor_vdtt.py assets/models/rotor-vdtt.glb

Pure Python (no Blender, no numpy).  Output: one animation "Spin", 6 s loop, seamless:
  * rotor turns one full revolution (10 rpm), clockwise seen from upstream, flow along +x
  * faint flow arrows advance exactly one arrow spacing per loop (fade in/out at the ends)

SCHEMATIC.  Dimensions are NOT from CAD.  The MoWiTO user manual (ForWind, v1.0, 2019) gives no
rotor diameter or tunnel dimensions; only the component layout (p. 5: 3 blades, nacelle with
generator + pitch stepper motor, spinner/hub, single tower) is taken from it.  Rotor diameter
0.6 m is inferred from the model name; the tunnel is a generic round duct segment
(diameter 1.5 m, length 2.6 m), cut open on the viewer side.  Not the real VDTT geometry.

Scene units: metres.  Flow +x, up +y, viewer side +z.  Hub centre at (0, 0.75, 0).
Materials: Ground (floor, recoloured by site.js data-ground), Duct, DuctSteel, Turbine, Blade, Flow.
"""
import json, math, struct, sys

out = sys.argv[1] if len(sys.argv) > 1 else "rotor-vdtt.glb"

# ---------------- parameters ----------------
D = 0.6                    # rotor diameter (assumed)
CY = 0.75                  # axis height = duct radius
RD = 0.75                  # duct radius (assumed)
XD = 1.3                   # duct half length (assumed)
LOOP = 6.0
NKEY = 48
ARROW_S = 0.5              # arrow spacing along x
ARROW_L = 0.24

# ---------------- tiny mesh helpers ----------------
class Mesh:
    def __init__(self):
        self.p, self.i = [], []
    def add(self, pts, tris):
        o = len(self.p)
        self.p += pts
        self.i += [(a + o, b + o, c + o) for a, b, c in tris]
    def normals(self):
        n = [[0.0, 0.0, 0.0] for _ in self.p]
        for a, b, c in self.i:
            pa, pb, pc = self.p[a], self.p[b], self.p[c]
            u = [pb[k] - pa[k] for k in range(3)]
            v = [pc[k] - pa[k] for k in range(3)]
            f = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]]
            for t in (a, b, c):
                for k in range(3):
                    n[t][k] += f[k]
        for v in n:
            l = math.sqrt(sum(c*c for c in v)) or 1.0
            v[:] = [c / l for c in v]
        return n

def grid(rows, closed_u=False, flip=False):
    """rows: list of rings (each a list of points). Returns (pts, tris) skinning ring to ring."""
    nu = len(rows[0]); pts = [p for r in rows for p in r]; tris = []
    for j in range(len(rows) - 1):
        for u in range(nu if closed_u else nu - 1):
            a = j*nu + u; b = j*nu + (u+1) % nu; c = (j+1)*nu + (u+1) % nu; d = (j+1)*nu + u
            tris += [(a, b, c), (a, c, d)] if not flip else [(a, c, b), (a, d, c)]
    return pts, tris

def revolve(profile, seg=32, flip=False):
    """profile: [(x, r)] revolved about the x axis."""
    rows = [[(x, r*math.cos(2*math.pi*k/seg), r*math.sin(2*math.pi*k/seg)) for k in range(seg)] for x, r in profile]
    return grid(rows, True, flip)

def tube(path, r, seg=10):
    rows = []
    for k, c in enumerate(path):
        a = path[max(k-1, 0)]; b = path[min(k+1, len(path)-1)]
        t = [b[i]-a[i] for i in range(3)]; l = math.sqrt(sum(x*x for x in t)); t = [x/l for x in t]
        ref = (0, 1, 0) if abs(t[1]) < 0.9 else (1, 0, 0)
        n1 = [t[1]*ref[2]-t[2]*ref[1], t[2]*ref[0]-t[0]*ref[2], t[0]*ref[1]-t[1]*ref[0]]
        l = math.sqrt(sum(x*x for x in n1)); n1 = [x/l for x in n1]
        n2 = [t[1]*n1[2]-t[2]*n1[1], t[2]*n1[0]-t[0]*n1[2], t[0]*n1[1]-t[1]*n1[0]]
        rows.append([tuple(c[i] + r*(math.cos(2*math.pi*s/seg)*n1[i] + math.sin(2*math.pi*s/seg)*n2[i]) for i in range(3)) for s in range(seg)])
    return grid(rows, True)

def box(x0, x1, y0, y1, z0, z1):
    P = [(x, y, z) for x in (x0, x1) for y in (y0, y1) for z in (z0, z1)]
    F = [(0,1,3,2),(4,6,7,5),(0,4,5,1),(2,3,7,6),(0,2,6,4),(1,5,7,3)]
    pts, tris = [], []
    for f in F:   # separate verts per face -> flat shading
        o = len(pts); pts += [P[k] for k in f]; tris += [(o, o+1, o+2), (o, o+2, o+3)]
    return pts, tris

# ---------------- geometry ----------------
meshes = {}   # name -> (Mesh, material)

# duct: back half-shell (z<0), cut away on the viewer side
shell = Mesh()
NX, NT = 14, 48
rows = []
for i in range(NX + 1):
    x = -XD + 2*XD*i/NX
    rows.append([(x, CY + RD*math.cos(math.pi*k/NT), -RD*math.sin(math.pi*k/NT)) for k in range(NT + 1)])
shell.add(*grid(rows))
meshes["Duct"] = (shell, "Duct")

steel = Mesh()
def half_ring(x, r, rt):
    path = [(x, CY + r*math.cos(math.pi*k/NT), -r*math.sin(math.pi*k/NT)) for k in range(NT + 1)]
    steel.add(*tube(path, rt, 8))
for x, rt in ((-XD, 0.022), (XD, 0.022), (-XD/2, 0.010), (0.0, 0.010), (XD/2, 0.010)):
    half_ring(x, RD, rt)
# two longitudinal rails along the cut edges
for z, y in ((0.0, CY + RD), (0.0, CY - RD)):
    steel.add(*tube([(-XD, y, z), (XD, y, z)], 0.012, 8))
meshes["DuctSteel"] = (steel, "DuctSteel")

ground = Mesh()
ground.add(*box(-1.9, 1.9, -0.03, 0.0, -1.4, 1.4))
meshes["Ground"] = (ground, "Ground")

turb = Mesh()   # static turbine parts: nacelle + tower + base
RN = 0.05
nac = [(0.00, 0.0), (0.012, 0.030), (0.035, 0.046), (0.07, RN), (0.30, 0.046), (0.38, 0.038), (0.42, 0.028), (0.43, 0.0)]
nac = [(x + 0.03, r) for x, r in nac]
pts, tris = revolve(nac, 40)
turb.add([(x, CY + y, z) for x, y, z in pts], tris)
# tower (slightly tapered) with base plate
tw = [(CY - 0.03, 0.020), (0.02, 0.026)]
rows = [[(0.20, y + 0.0, 0.0)] for y, _ in tw]
rows = [[(0.20 + r*math.cos(2*math.pi*k/24), y, r*math.sin(2*math.pi*k/24)) for k in range(24)] for y, r in tw]
turb.add(*grid(rows, True, flip=True))
turb.add(*box(0.10, 0.30, 0.0, 0.012, -0.10, 0.10))
meshes["Turbine"] = (turb, "Turbine")

rotor = Mesh()  # hub + 3 blades, rotates about the x axis through (0, CY, 0)
spin = [(0.0, 0.0), (0.02, 0.028), (0.06, 0.048), (0.10, 0.052), (0.13, 0.050), (0.135, 0.0)]
pts, tris = revolve(spin, 40)
rotor.add([(x - 0.13 + 0.02 - 0.0, y, z) for x, y, z in pts], tris)   # nose upstream of x=0 plane
rotor_blade = Mesh()
SECT = [(0.0, 0.0), (0.10, 0.50), (0.30, 0.95), (0.55, 1.0), (0.80, 0.65), (1.0, 0.0)]
def lens(n=9):
    up = [(0.5 - 0.5*math.cos(math.pi*k/n), 0.12*0.5*math.sin(math.pi*k/n)*1.6*(1 - 0.35*k/n)) for k in range(n + 1)]
    lo = [(c, -0.35*t) for c, t in up[-2:0:-1]]
    return [(c - 0.3, t) for c, t in up + lo]   # chord centred near 30 % chord
SEC = lens()
R0, R1 = 0.045, D/2
NS = 14
for b in range(3):
    ph = 2*math.pi*b/3
    rows = []
    for s in range(NS + 1):
        f = s/NS; r = R0 + (R1 - R0)*f
        chord = 0.052*(1 - 0.62*f) if f > 0.12 else 0.040 + 0.012*f/0.12
        tw_ = math.radians(24*(1 - f)**1.3 + 2)
        ring = []
        for c, t in SEC:
            cc, tt = c*chord, t*chord
            zc = cc*math.cos(tw_) - tt*math.sin(tw_)
            xc = cc*math.sin(tw_) + tt*math.cos(tw_)
            y, z = r, zc
            ring.append((xc, y*math.cos(ph) - z*math.sin(ph), y*math.sin(ph) + z*math.cos(ph)))
        rows.append(ring)
    # tip cap: shrink last ring to centroid
    cx = [sum(p[i] for p in rows[-1])/len(rows[-1]) for i in range(3)]
    rows.append([tuple(cx) for _ in rows[-1]])
    rotor.add(*grid(rows, True, flip=True))
rotor.p = [(x, CY + y, z) for x, y, z in rotor.p]
# rotor node origin must be the hub centre, so shift geometry back
rotor.p = [(x, y - CY, z) for x, y, z in rotor.p]
rotor_mesh = rotor

# flow arrows: one mesh shared by every arrow node
arrow = Mesh()
shaft = [(0.0, 0.0), (0.0, 0.007), (ARROW_L*0.70, 0.007), (ARROW_L*0.70, 0.02), (ARROW_L, 0.0)]
arrow.add(*revolve(shaft, 10))

# ---------------- glTF assembly ----------------
bin_ = bytearray()
gl = {"asset": {"version": "2.0", "generator": "tools/build_rotor_vdtt.py (schematic)"},
      "scene": 0, "scenes": [{"nodes": []}], "nodes": [], "meshes": [], "materials": [],
      "accessors": [], "bufferViews": [], "buffers": [{"byteLength": 0}], "animations": []}

def bview(data, target=None):
    while len(bin_) % 4: bin_.append(0)
    bv = {"buffer": 0, "byteOffset": len(bin_), "byteLength": len(data)}
    if target: bv["target"] = target
    bin_.extend(data); gl["bufferViews"].append(bv); return len(gl["bufferViews"]) - 1

def acc(vals, typ, comp=5126, target=None, mm=False):
    n = {"SCALAR": 1, "VEC3": 3, "VEC4": 4}[typ]
    flat = [c for v in vals for c in (v if n > 1 else [v])]
    fmt = {5126: "f", 5125: "I"}[comp]
    a = {"bufferView": bview(struct.pack("<%d%s" % (len(flat), fmt), *flat), target), "componentType": comp, "count": len(vals), "type": typ}
    if mm:
        cols = [[v[i] for v in vals] for i in range(n)] if n > 1 else [vals]
        a["min"] = [min(c) for c in cols]; a["max"] = [max(c) for c in cols]
    gl["accessors"].append(a); return len(gl["accessors"]) - 1

def mat(name, rgba, metal=0.0, rough=0.6, emissive=None, blend=False, double=False):
    m = {"name": name, "pbrMetallicRoughness": {"baseColorFactor": rgba, "metallicFactor": metal, "roughnessFactor": rough}}
    if emissive: m["emissiveFactor"] = emissive
    if blend: m["alphaMode"] = "BLEND"
    if double: m["doubleSided"] = True
    gl["materials"].append(m); return len(gl["materials"]) - 1

M = {
    "Ground": mat("Ground", [0.035, 0.04, 0.038, 1], 0.0, 1.0),
    "Duct": mat("Duct", [0.42, 0.50, 0.52, 0.16], 0.1, 0.5, blend=True, double=True),
    "DuctSteel": mat("DuctSteel", [0.30, 0.34, 0.36, 1], 0.8, 0.4),
    "Turbine": mat("Turbine", [0.72, 0.74, 0.74, 1], 0.35, 0.45),
    "Blade": mat("Blade", [0.88, 0.89, 0.88, 1], 0.2, 0.4, double=True),
    "Flow": mat("Flow", [0.79, 0.66, 0.42, 0.55], 0.0, 0.8, emissive=[0.25, 0.20, 0.10], blend=True),
}

def add_mesh(name, mesh, material):
    nrm = mesh.normals()
    pa = acc(mesh.p, "VEC3", target=34962, mm=True); na = acc(nrm, "VEC3", target=34962)
    ia = acc([c for t in mesh.i for c in t], "SCALAR", 5125, 34963)
    gl["meshes"].append({"name": name, "primitives": [{"attributes": {"POSITION": pa, "NORMAL": na}, "indices": ia, "material": M[material]}]})
    return len(gl["meshes"]) - 1

def add_node(name, mesh=None, t=None, children=None, root=True):
    n = {"name": name}
    if mesh is not None: n["mesh"] = mesh
    if t: n["translation"] = list(t)
    if children: n["children"] = children
    gl["nodes"].append(n); i = len(gl["nodes"]) - 1
    if root: gl["scenes"][0]["nodes"].append(i)
    return i

for name, (m, mt) in meshes.items():
    add_node(name, add_mesh(name, m, mt))
add_node("Rotor", add_mesh("Rotor", rotor_mesh, "Blade"), t=(0, CY, 0))
# hub (spinner) uses Turbine colour: split by drawing spinner as part of Turbine mesh would not spin, so keep it light via Blade material.
rotor_node = len(gl["nodes"]) - 1

arrow_mesh = add_mesh("Arrow", arrow, "Flow")
ROWS = [(CY + 0.46, 0.0), (CY - 0.46, 0.0), (CY, 0.50), (CY, -0.50), (CY + 0.33, 0.33), (CY - 0.33, -0.33)]
XMIN, NA = -1.15, 5          # arrows at XMIN + k*S, k = 0..NA ; NA+1 per row
XMAX = XMIN + NA*ARROW_S
def env(x):
    f = min(max((x - XMIN)/ARROW_S, 0), 1) * min(max((XMAX - x)/ARROW_S, 0), 1)
    return f*f*(3 - 2*f)
arrows = []
for ri, (y, z) in enumerate(ROWS):
    for k in range(-1, NA + 3):
        x0 = XMIN + (k + (ri % 2)*0.5)*ARROW_S   # alternate rows staggered; extra slots keep the loop seamless
        n = add_node("Flow_%d_%d" % (ri, k), arrow_mesh, t=(x0, y, z))
        gl["nodes"][n]["_x0"] = x0
        arrows.append(n)

# ---------------- animation ----------------
times = [LOOP*i/NKEY for i in range(NKEY + 1)]
t_acc = acc(times, "SCALAR", mm=True)
samplers, channels = [], []
def chan(node, path, vals, typ):
    samplers.append({"input": t_acc, "output": acc(vals, typ), "interpolation": "LINEAR"})
    channels.append({"sampler": len(samplers) - 1, "target": {"node": node, "path": path}})
rot = []
for i in range(NKEY + 1):
    a = 2*math.pi*i/NKEY          # +x rotation: clockwise seen from upstream
    rot.append((math.sin(a/2), 0.0, 0.0, math.cos(a/2)))
chan(rotor_node, "rotation", rot, "VEC4")
for n in arrows:
    x0 = gl["nodes"][n].pop("_x0")
    xs = [x0 + ARROW_S*i/NKEY for i in range(NKEY + 1)]
    chan(n, "translation", [(x, gl["nodes"][n]["translation"][1], gl["nodes"][n]["translation"][2]) for x in xs], "VEC3")
    chan(n, "scale", [(env(x),)*3 for x in xs], "VEC3")
gl["animations"].append({"name": "Spin", "samplers": samplers, "channels": channels})

# ---------------- write ----------------
gl["buffers"][0]["byteLength"] = len(bin_)
while len(bin_) % 4: bin_.append(0)
gl["buffers"][0]["byteLength"] = len(bin_)
js = json.dumps(gl, separators=(",", ":")).encode()
js += b" " * (-len(js) % 4)
with open(out, "wb") as f:
    f.write(struct.pack("<4sII", b"glTF", 2, 12 + 8 + len(js) + 8 + len(bin_)))
    f.write(struct.pack("<I4s", len(js), b"JSON")); f.write(js)
    f.write(struct.pack("<I4s", len(bin_), b"BIN\0")); f.write(bin_)
print("wrote", out, 12 + 16 + len(js) + len(bin_), "bytes")
