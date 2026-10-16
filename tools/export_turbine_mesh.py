"""Export the wind turbine from the animated setup model (assets/models/lpt-setup.glb, built from
the Blender scene) as a small triangle mesh for the measured-trajectory player (lpt-tracks.js).

    /Applications/Blender.app/Contents/MacOS/Blender -b --python tools/export_turbine_mesh.py -- \
        assets/models/lpt-setup.glb assets/data/turbine-mesh.json

Parts: Tower.001, Nacelle.001, Shaft.001, Blade 1-3.001, in world coordinates of the Blender scene,
rotated 180 deg about z into the track frame (Blender: wind along -x, rotor at +x; tracks: wind
along +x, rotor faces -x) and given relative to the tower base. Real scale (hub 18 m, R ~ 6.45 m).
Output: {"parts": [{"name", "v": [x,y,z,...] (m), "t": [i,j,k,...]}]}
"""
import bpy, bmesh, json, sys

PARTS = ["Tower.001", "Nacelle.001", "Shaft.001", "Blade 1.001", "Blade 2.001", "Blade 3.001"]


def main(src, out):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src)
    dg = bpy.context.evaluated_depsgraph_get()
    parts = []
    for name in PARTS:
        o = bpy.data.objects[name].evaluated_get(dg)
        bm = bmesh.new(); bm.from_mesh(o.to_mesh()); bmesh.ops.triangulate(bm, faces=bm.faces[:])
        bm.transform(o.matrix_world)
        v = []
        for p in bm.verts: v += [round(-p.co.x, 3), round(-p.co.y, 3), round(p.co.z, 3)]
        t = [vv.index for f in bm.faces for vv in f.verts]
        parts.append({"name": name.split(".")[0], "v": v, "t": t})
        bm.free()
    with open(out, "w") as f:
        json.dump({"source": "assets/models/lpt-setup.glb (Blender setup scene)", "frame": "track frame, origin at tower base [m]",
                   "parts": parts}, f, separators=(",", ":"))
    print(out, sum(len(p["t"]) // 3 for p in parts), "triangles")


if __name__ == "__main__":
    main(*sys.argv[sys.argv.index("--") + 1:])
