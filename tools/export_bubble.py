import bpy, bmesh, sys, random

args = sys.argv[sys.argv.index("--") + 1:]
out = args[0]
STATIC_BUBBLES = "--animated" not in args  # animated build adds bubbles in tools/animate_glb.py
scene = bpy.context.scene
SKIP_COLS = {"Wind Turbine", "GrassClumps"}  # duplicate turbine, grass instances
SKIP_OBJS = {"Plane.001", "Cylinder.005", "Cylinder.006", "Cylinder.001"}  # duplicate ground, LED light cones

# 1. Drop grass scatter modifiers from the terrain
t = bpy.data.objects["Terrain"]
for m in list(t.modifiers):
    if m.type == 'NODES':
        t.modifiers.remove(m)

# 2. Bake the live bubble particles into one low-poly mesh (static build only)
if STATIC_BUBBLES:
    src = bpy.data.objects["Cylinder"]
    dg = bpy.context.evaluated_depsgraph_get()
    ps = src.evaluated_get(dg).particle_systems[0]
    r = 0.12  # enlarged from 2.5 cm so bubbles read at orbit distance
    bm = bmesh.new()
    proto = bmesh.new()
    bmesh.ops.create_icosphere(proto, subdivisions=1, radius=r)
    pverts = [v.co.copy() for v in proto.verts]
    pfaces = [[v.index for v in f.verts] for f in proto.faces]
    alive = [p.location.copy() for p in ps.particles if p.alive_state == 'ALIVE']
    random.seed(1)
    if len(alive) > 3000:
        alive = random.sample(alive, 3000)
    for loc in alive:
        vs = [bm.verts.new(loc + c) for c in pverts]
        for f in pfaces:
            bm.faces.new([vs[i] for i in f])
    me = bpy.data.meshes.new("Bubbles")
    bm.to_mesh(me)
    mat = bpy.data.materials.new("BubbleGlow")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (1, 1, 1, 1)
    bsdf.inputs["Emission Color"].default_value = (1, 1, 1, 1)
    bsdf.inputs["Emission Strength"].default_value = 1.0
    me.materials.append(mat)
    bub = bpy.data.objects.new("Bubbles", me)
    scene.collection.objects.link(bub)
    print("bubbles", len(alive))

# Translucent measurement volume
fm = bpy.data.objects["FOV3"].material_slots[0].material
fm.use_nodes = True
for nd in fm.node_tree.nodes:
    if nd.type == 'BSDF_PRINCIPLED':
        nd.inputs["Alpha"].default_value = 0.3
fm.surface_render_method = 'BLENDED'

# Lighter grass-green terrain (the grass instances are gone)
tm = bpy.data.objects["Terrain"].material_slots[0].material
tm.use_nodes = True
for nd in tm.node_tree.nodes:
    if nd.type == 'BSDF_PRINCIPLED':
        nd.inputs["Base Color"].default_value = (0.16, 0.3, 0.12, 1)
        for l in list(nd.inputs["Base Color"].links): tm.node_tree.links.remove(l)

# 3. Select what to export
bpy.ops.object.select_all(action='DESELECT')
n = 0
for o in scene.objects:
    cols = {c.name for c in o.users_collection}
    if cols & SKIP_COLS or o.name in SKIP_OBJS or o.hide_render:
        continue
    if o.particle_systems:  # emitter cylinder: keep, but the particles are baked above
        for m in o.modifiers:
            if m.type == 'PARTICLE_SYSTEM':
                m.show_render = m.show_viewport = False
    if o.type in {'MESH', 'CURVE', 'EMPTY', 'FONT'}:
        o.select_set(True)
        n += 1
print("selected", n)

bpy.ops.export_scene.gltf(
    filepath=out, export_format='GLB', use_selection=True, export_apply=True,
    export_animations=False, export_cameras=False, export_lights=False,
    export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7,
    export_yup=True,
)
print("EXPORTED", out)
