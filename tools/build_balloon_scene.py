"""Build the real-data 3D scene for the balloon project.

    python3 tools/build_balloon_scene.py <campaign_dir> <dem_tile_dir>

campaign_dir  SMARTIES/Field Campaigns/Winsent_October_25 (sonde CSVs + cached_data/)
dem_tile_dir  Terrarium elevation tiles z12 (AWS Open Data "Terrain Tiles"), named 12_x_y.png

Writes
  assets/models/balloon-real.glb   terrain block, 36 turbines (spinning), 7 sonde tracks, animated balloons
  assets/data/balloon-tracks.json  per-sonde time series for the interactive explorer

Data handling mirrors radiosonde_analysis: rows before the manual trim index are dropped,
outlier indices (relative to the trimmed data) are removed, and only sondes with
plot=true in plot_config.json are used. Launches 1/5/6 are the paper's Launches A/B/C.
"""
import glob, json, math, os, struct, sys
import numpy as np
import pandas as pd
from PIL import Image

camp, tiles = sys.argv[1], sys.argv[2]
here = os.path.dirname(os.path.abspath(__file__))
site = os.path.join(here, "..")

VE = 3.0                 # vertical exaggeration (applied to terrain, tracks and turbine size)
BALLOON_R = 230.0        # drawn balloon radius (m); enlarged so balloons read at 30 km scale
Z_REF = 380.0            # m MSL mapped to model z = 0 (just below the lowest terrain)
BASE = -260.0            # bottom of the terrain block (model metres, after exaggeration)
GRID = 110.0             # terrain sample spacing (m)
SPEEDUP = 60.0           # playback: 1 s on screen = 1 min of flight
LAUNCHES = {"1": ("A", "#ED7D31"), "5": ("B", "#5B9BD5"), "6": ("C", "#70AD47")}

# ---------------------------------------------------------------- sondes
trim = json.load(open(os.path.join(camp, "cached_data/trim_points.json")))
outl = json.load(open(os.path.join(camp, "cached_data/outlier_flags.json")))
plot = {s["id"]: (L, s["plot"]) for L, v in json.load(open(os.path.join(camp, "cached_data/plot_config.json")))["sondes"].items() for s in v}

sondes = []
for f in sorted(glob.glob(os.path.join(camp, "Data/Cleaned up/Launch */*.csv"))):
    sid = [p for p in os.path.basename(f).replace(".csv", "").replace(".", "_").split("_") if len(p) == 5 and p.isdigit()][-1]
    if sid not in plot or not plot[sid][1] or plot[sid][0] not in LAUNCHES:
        continue
    d = pd.read_csv(f)
    d.columns = d.columns.str.strip()
    d["UTC time"] = pd.to_datetime(d["UTC time"].astype(str).str.strip(), errors="coerce")
    for c in ["Latitude", "Longitude", "Altitude (m MSL)", "Pressure (Pascal)", "Temperature (C)", "Relative humidity (%)"]:
        d[c] = pd.to_numeric(d[c], errors="coerce")
    k = trim.get(sid, 0)
    if k:
        d = d.loc[k:].reset_index(drop=True)
    bad = [i for i in outl.get(sid, []) if i < len(d)]
    d = d.drop(index=bad).dropna(subset=["UTC time", "Latitude", "Longitude", "Altitude (m MSL)"]).reset_index(drop=True)
    L = plot[sid][0]
    sondes.append({"id": sid, "launch": LAUNCHES[L][0], "color": LAUNCHES[L][1], "df": d})
print("sondes:", [(s["id"], s["launch"], len(s["df"])) for s in sondes])

lat0, lon0 = 48.665243, 9.837362          # release point at the WINSENT test site
kx, ky = 111320.0 * math.cos(math.radians(lat0)), 110540.0
enu = lambda lat, lon: ((lon - lon0) * kx, (lat - lat0) * ky)

# ---------------------------------------------------------------- terrain (Terrarium z12)
Z = 12
def tile_xy(lat, lon):
    r = math.radians(lat)
    return (lon + 180) / 360 * 2 ** Z, (1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * 2 ** Z
names = glob.glob(os.path.join(tiles, "12_*_*.png"))
xs = sorted({int(os.path.basename(n).split("_")[1]) for n in names})
ys = sorted({int(os.path.basename(n).split("_")[2][:-4]) for n in names})
mosaic = np.zeros((256 * len(ys), 256 * len(xs)))
for n in names:
    _, x, y = os.path.basename(n)[:-4].split("_")
    a = np.asarray(Image.open(n).convert("RGB")).astype(float)
    i, j = ys.index(int(y)), xs.index(int(x))
    mosaic[i * 256:(i + 1) * 256, j * 256:(j + 1) * 256] = a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768

def elev(lat, lon):
    tx, ty = tile_xy(lat, lon)
    px, py = (tx - xs[0]) * 256 - 0.5, (ty - ys[0]) * 256 - 0.5
    x0, y0 = int(np.floor(px)), int(np.floor(py)); fx, fy = px - x0, py - y0
    m = mosaic
    return (m[y0, x0] * (1 - fx) * (1 - fy) + m[y0, x0 + 1] * fx * (1 - fy) +
            m[y0 + 1, x0] * (1 - fx) * fy + m[y0 + 1, x0 + 1] * fx * fy)

allx, ally = [], []
for s in sondes:
    e, n = enu(s["df"]["Latitude"].values, s["df"]["Longitude"].values)
    s["x"], s["y"] = e, n
    allx += list(e); ally += list(n)
X0, X1 = min(allx) - 2500, max(allx) + 2000
Y0, Y1 = min(ally) - 3000, max(ally) + 3000
nx, ny = int((X1 - X0) / GRID) + 1, int((Y1 - Y0) / GRID) + 1
gx, gy = np.linspace(X0, X1, nx), np.linspace(Y0, Y1, ny)
H = np.array([[elev(lat0 + y / ky, lon0 + x / kx) for x in gx] for y in gy])
print("terrain grid", nx, "x", ny, "elev", H.min().round(), H.max().round())

def ground(x, y):
    fx, fy = (x - X0) / GRID, (y - Y0) / GRID
    i, j = min(max(int(fy), 0), ny - 2), min(max(int(fx), 0), nx - 2)
    ax, ay = fx - j, fy - i
    return (H[i, j] * (1 - ax) * (1 - ay) + H[i, j + 1] * ax * (1 - ay) + H[i + 1, j] * (1 - ax) * ay + H[i + 1, j + 1] * ax * ay)

zmod = lambda h: (h - Z_REF) * VE
to_gl = lambda x, y, z: [x, z, -y]          # ENU (east, north, up) -> glTF (x, y-up, z toward viewer = south)

# ---------------------------------------------------------------- glTF writer
gl = {"asset": {"version": "2.0", "generator": "build_balloon_scene.py"}, "scene": 0, "scenes": [{"nodes": []}],
      "nodes": [], "meshes": [], "materials": [], "accessors": [], "bufferViews": [], "buffers": [{}],
      "extensionsUsed": ["KHR_materials_unlit"]}
buf = bytearray()
roots = gl["scenes"][0]["nodes"]

def add(data, target=None):
    while len(buf) % 4: buf.append(0)
    gl["bufferViews"].append({"buffer": 0, "byteOffset": len(buf), "byteLength": len(data), **({"target": target} if target else {})})
    buf.extend(data)
    return len(gl["bufferViews"]) - 1

def acc(arr, typ, comp=5126, minmax=False, target=None):
    a = np.asarray(arr, dtype={5126: "<f4", 5125: "<u4", 5123: "<u2"}[comp])
    n = {"SCALAR": 1, "VEC3": 3, "VEC4": 4}[typ]
    a2 = a.reshape(-1, n)
    d = {"bufferView": add(a.tobytes(), target), "componentType": comp, "count": len(a2), "type": typ}
    if minmax:
        d["min"], d["max"] = a2.min(0).tolist(), a2.max(0).tolist()
    gl["accessors"].append(d)
    return len(gl["accessors"]) - 1

def material(name, color, emissive=None, unlit=False, rough=0.9, double=False, alpha=None):
    m = {"name": name, "pbrMetallicRoughness": {"baseColorFactor": list(color) + [1 if alpha is None else alpha], "metallicFactor": 0, "roughnessFactor": rough}}
    if emissive: m["emissiveFactor"] = list(emissive)
    if unlit: m["extensions"] = {"KHR_materials_unlit": {}}
    if double: m["doubleSided"] = True
    if alpha is not None: m["alphaMode"] = "BLEND"
    gl["materials"].append(m)
    return len(gl["materials"]) - 1

def mesh(name, pos, idx, mat, normals=None, colors=None):
    attrs = {"POSITION": acc(pos, "VEC3", minmax=True, target=34962)}
    if normals is not None: attrs["NORMAL"] = acc(normals, "VEC3", target=34962)
    if colors is not None: attrs["COLOR_0"] = acc(colors, "VEC3", target=34962)
    big = np.asarray(pos).reshape(-1, 3).shape[0] > 65535
    gl["meshes"].append({"name": name, "primitives": [{"attributes": attrs, "material": mat,
                         "indices": acc(idx, "SCALAR", comp=5125 if big else 5123, target=34963)}]})
    return len(gl["meshes"]) - 1

def node(name, **kw):
    gl["nodes"].append({"name": name, **kw})
    return len(gl["nodes"]) - 1

hex2rgb = lambda h: [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]
srgb2lin = lambda c: [((v + 0.055) / 1.055) ** 2.4 if v > 0.04045 else v / 12.92 for v in c]

# ---- terrain surface: hillshade baked into vertex colours
dzdx = np.gradient(H * VE, GRID, axis=1); dzdy = np.gradient(H * VE, GRID, axis=0)
nrm = np.dstack([-dzdx, -dzdy, np.ones_like(H)]); nrm /= np.linalg.norm(nrm, axis=2, keepdims=True)
sun = np.array([-0.55, 0.45, 0.70]); sun /= np.linalg.norm(sun)
shade = np.clip((nrm * sun).sum(2), 0, 1)
t = (H - H.min()) / (H.max() - H.min())
low, high = np.array(hex2rgb("#263029")), np.array(hex2rgb("#59634f"))
col = (low[None, None] * (1 - t[..., None]) + high[None, None] * t[..., None]) * (0.48 + 0.72 * shade[..., None])
col = np.clip(col, 0, 1)
P, N, C = [], [], []
for i in range(ny):
    for j in range(nx):
        P.append(to_gl(gx[j], gy[i], zmod(H[i, j]))); n = nrm[i, j]; N.append([n[0], n[2], -n[1]]); C.append(srgb2lin(col[i, j]))
I = []
for i in range(ny - 1):
    for j in range(nx - 1):
        a, b, c, d = i * nx + j, i * nx + j + 1, (i + 1) * nx + j, (i + 1) * nx + j + 1
        I += [a, b, c, b, d, c]
terrain_mat = material("Terrain", [1, 1, 1], rough=1, double=True)
roots.append(node("Terrain", mesh=mesh("Terrain", P, I, terrain_mat, N, C)))

# ---- block skirt: vertical walls down to BASE so the terrain reads as a cut-out relief model
SP, SI, SN = [], [], []
def wall(pts, outward):
    base = len(SP)
    for (x, y, h) in pts:
        SP.append(to_gl(x, y, zmod(h))); SP.append(to_gl(x, y, BASE))
        SN.extend([to_gl(*outward), to_gl(*outward)])
    for k in range(len(pts) - 1):
        a, b = base + 2 * k, base + 2 * k + 2
        SI.extend([a, a + 1, b, b, a + 1, b + 1])
wall([(gx[j], gy[0], H[0, j]) for j in range(nx)], (0, -1, 0))
wall([(gx[j], gy[-1], H[-1, j]) for j in range(nx)][::-1], (0, 1, 0))
wall([(gx[0], gy[i], H[i, 0]) for i in range(ny)][::-1], (-1, 0, 0))
wall([(gx[-1], gy[i], H[i, -1]) for i in range(ny)], (1, 0, 0))
roots.append(node("Skirt", mesh=mesh("Skirt", SP, SI, material("Skirt", srgb2lin(hex2rgb("#141816")), rough=1, double=True), SN)))

# ---------------------------------------------------------------- turbines
tur = pd.read_csv(os.path.join(camp, "cached_data/wind_turbines.csv"))
def cyl(r0, r1, h, seg=10):
    P, I = [], []
    for k in range(seg):
        th = 2 * math.pi * k / seg
        P += [[r0 * math.cos(th), 0, r0 * math.sin(th)], [r1 * math.cos(th), h, r1 * math.sin(th)]]
    for k in range(seg):
        a, b = 2 * k, 2 * ((k + 1) % seg)
        I += [a, b, a + 1, b, b + 1, a + 1]
    return P, I
def blade(L, w):          # flat tapered blade along +y in the rotor plane (y-z), root at hub
    P = [[0, 0, -w / 2], [0, 0, w / 2], [0, L, w * 0.12], [0, L, -w * 0.12], [0, L * 0.25, w * 0.55], [0, L * 0.25, -w * 0.55]]
    I = [0, 1, 4, 0, 4, 5, 5, 4, 2, 5, 2, 3]
    return P, I

white = material("Turbine", srgb2lin([0.92, 0.92, 0.90]), emissive=[0.35, 0.35, 0.34], rough=0.6, double=True)
tp, ti = cyl(0.5, 0.32, 1.0)
tower_mesh = mesh("Tower", tp, ti, white)
bp, bi = blade(1.0, 0.075)
blade_mesh = mesh("Blade", bp, bi, white)
nac_mesh = mesh("Nacelle", [[-.02, -.03, -.03], [.09, -.03, -.03], [.09, .03, -.03], [-.02, .03, -.03], [-.02, -.03, .03], [.09, -.03, .03], [.09, .03, .03], [-.02, .03, .03]],
                [0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0], white)
rotors, turb_out = [], []
for _, r in tur.iterrows():
    x, y = enu(r["lat"], r["lon"])
    if not (X0 < x < X1 and Y0 < y < Y1):
        continue
    hub, D = float(r["height"]) * VE, float(r["rotor_diameter"]) * VE
    g = zmod(ground(x, y))
    t_node = node("Tower " + str(r["name"]), mesh=tower_mesh, translation=to_gl(x, y, g), scale=[D * 0.03, hub, D * 0.03])
    roots.append(t_node)
    # nacelle + rotor face west (into the prevailing westerly wind); rotor spins about the glTF x axis
    roots.append(node("Nacelle", mesh=nac_mesh, translation=to_gl(x, y, g + hub), scale=[D, D, D]))
    blades = [node("blade", mesh=blade_mesh, rotation=[math.sin(k * math.pi / 3), 0, 0, math.cos(k * math.pi / 3)], scale=[1, D / 2, D / 2]) for k in range(3)]
    rotor = node("Rotor " + str(r["name"]), translation=to_gl(x - D * 0.03, y, g + hub), children=blades)
    roots.append(rotor); rotors.append(rotor)
    turb_out.append({"name": str(r["name"]), "x": round(x), "y": round(y), "ground": round(ground(x, y)), "hub": float(r["height"]), "D": float(r["rotor_diameter"])})
print("turbines in scene:", len(turb_out))

# ---------------------------------------------------------------- tracks + balloons
launch_t0 = {}
for s in sondes:
    t0 = s["df"]["UTC time"].min()
    launch_t0[s["launch"]] = min(launch_t0.get(s["launch"], t0), t0)
loop = 0.0
for s in sondes:
    d = s["df"]
    s["t"] = (d["UTC time"] - launch_t0[s["launch"]]).dt.total_seconds().values
    s["h"] = d["Altitude (m MSL)"].values.astype(float)
    s["g"] = np.array([ground(x, y) for x, y in zip(s["x"], s["y"])])
    loop = max(loop, s["t"][-1] / SPEEDUP)
loop = math.ceil(loop + 2.0)
print("loop length", loop, "s")

def tube(pts, r, seg=6):
    P, I = [], []
    pts = np.asarray(pts)
    for k in range(len(pts)):
        a, b = pts[max(k - 1, 0)], pts[min(k + 1, len(pts) - 1)]
        t = b - a; t /= (np.linalg.norm(t) + 1e-9)
        u = np.cross(t, [0, 1, 0]); u = u / (np.linalg.norm(u) + 1e-9) if np.linalg.norm(u) > 1e-6 else np.array([1, 0, 0])
        v = np.cross(t, u)
        for q in range(seg):
            th = 2 * math.pi * q / seg
            P.append((pts[k] + r * (math.cos(th) * u + math.sin(th) * v)).tolist())
    for k in range(len(pts) - 1):
        for q in range(seg):
            a, b = k * seg + q, k * seg + (q + 1) % seg
            I += [a, b, a + seg, b, b + seg, a + seg]
    return P, I

samplers, channels = [], []
ico_t = (1 + 5 ** .5) / 2
ico = [(-1, ico_t, 0), (1, ico_t, 0), (-1, -ico_t, 0), (1, -ico_t, 0), (0, -1, ico_t), (0, 1, ico_t), (0, -1, -ico_t), (0, 1, -ico_t), (ico_t, 0, -1), (ico_t, 0, 1), (-ico_t, 0, -1), (-ico_t, 0, 1)]
ico = [[c / math.sqrt(sum(v * v for v in p)) for c in p] for p in ico]
ico_f = [0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8, 3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1]
launch_mats = {}
for s in sondes:
    if s["launch"] not in launch_mats:
        c = srgb2lin(hex2rgb(s["color"]))
        launch_mats[s["launch"]] = (material("Track " + s["launch"], c, emissive=[v * 0.55 for v in c], rough=0.5),
                                    material("Balloon " + s["launch"], [min(1, v * 1.25) for v in c], unlit=True))
    track_pts = [to_gl(x, y, zmod(h)) for x, y, h in zip(s["x"], s["y"], s["h"])]
    tp_, ti_ = tube(track_pts, 26.0)
    roots.append(node("Track " + s["id"], mesh=mesh("Track " + s["id"], tp_, ti_, launch_mats[s["launch"]][0])))
    bm = mesh("Balloon " + s["id"], [[c * BALLOON_R for c in p] for p in ico], ico_f, launch_mats[s["launch"]][1], normals=ico)
    bn = node("Balloon " + s["id"], mesh=bm, translation=track_pts[0])
    roots.append(bn)
    # translation: follow the real track with time compressed by SPEEDUP; hold at the end
    tt = list(s["t"] / SPEEDUP) + [loop]
    pp = track_pts + [track_pts[-1]]
    samplers.append({"input": acc(tt, "SCALAR", minmax=True), "output": acc(pp, "VEC3"), "interpolation": "LINEAR"})
    channels.append({"sampler": len(samplers) - 1, "target": {"node": bn, "path": "translation"}})
    # scale: visible during flight, hidden after the last fix
    st = [0.0, s["t"][-1] / SPEEDUP, s["t"][-1] / SPEEDUP + 0.01, loop]
    samplers.append({"input": acc(st, "SCALAR", minmax=True), "output": acc([[1, 1, 1], [1, 1, 1], [0, 0, 0], [0, 0, 0]], "VEC3"), "interpolation": "LINEAR"})
    channels.append({"sampler": len(samplers) - 1, "target": {"node": bn, "path": "scale"}})

# rotors: whole turns per loop so the loop is seamless (~1 turn per 3 s on screen)
revs = max(1, round(loop / 3.0))
kpr = 6
times = [loop * k / (revs * kpr) for k in range(revs * kpr + 1)]
quats = [[math.sin(-math.pi * revs * k / (revs * kpr)), 0, 0, math.cos(-math.pi * revs * k / (revs * kpr))] for k in range(revs * kpr + 1)]
tin, qout = acc(times, "SCALAR", minmax=True), acc(quats, "VEC4")
for r in rotors:
    samplers.append({"input": tin, "output": qout, "interpolation": "LINEAR"})
    channels.append({"sampler": len(samplers) - 1, "target": {"node": r, "path": "rotation"}})
gl["animations"] = [{"name": "Flight", "samplers": samplers, "channels": channels}]

# ---------------------------------------------------------------- write GLB
while len(buf) % 4: buf.append(0)
gl["buffers"][0]["byteLength"] = len(buf)
js = json.dumps(gl, separators=(",", ":")).encode(); js += b" " * ((4 - len(js) % 4) % 4)
out = os.path.join(site, "assets/models/balloon-real.glb")
with open(out, "wb") as f:
    f.write(struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(buf)))
    f.write(struct.pack("<II", len(js), 0x4E4F534A)); f.write(js)
    f.write(struct.pack("<II", len(buf), 0x004E4942)); f.write(buf)
print("wrote", out, "%.1f MB" % ((len(js) + len(buf)) / 1e6))

# ---------------------------------------------------------------- explorer data
def r1(a, n=1): return [None if (v is None or (isinstance(v, float) and math.isnan(v))) else round(float(v), n) for v in a]
data = {
    "speedup": SPEEDUP, "loop": loop, "ve": VE, "zref": Z_REF,
    "extent": {"x0": round(X0), "x1": round(X1), "y0": round(Y0), "y1": round(Y1)},
    "launches": {v[0]: {"color": v[1], "utc": str(launch_t0[v[0]])} for v in LAUNCHES.values() if v[0] in launch_t0},
    "sondes": [{"id": s["id"], "launch": s["launch"], "color": s["color"],
                "t": r1(s["t"], 0), "x": r1(s["x"], 0), "y": r1(s["y"], 0), "msl": r1(s["h"], 0), "ground": r1(s["g"], 0),
                "p": r1(s["df"]["Pressure (Pascal)"].values / 100, 1), "T": r1(s["df"]["Temperature (C)"].values, 1),
                "rh": r1(s["df"]["Relative humidity (%)"].values, 0)} for s in sondes],
    "turbines": turb_out,
    "profile": {"x": r1(gx[::3], 0), "ground": r1([max(H[:, j]) for j in range(0, nx, 3)], 0)},
}
os.makedirs(os.path.join(site, "assets/data"), exist_ok=True)
json.dump(data, open(os.path.join(site, "assets/data/balloon-tracks.json"), "w"), separators=(",", ":"))
print("wrote assets/data/balloon-tracks.json")
