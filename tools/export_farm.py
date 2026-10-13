import bpy, sys
out = sys.argv[sys.argv.index("--") + 1]
sc = bpy.context.scene
bpy.ops.mesh.primitive_plane_add(size=1, location=(-65.5, 30.1, 0))  # blender y = -gltf z
g = bpy.context.object; g.name = "Ground"; g.scale = (175, 225, 1)
m = bpy.data.materials.new("Ground"); m.use_nodes = True
m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.16, 0.3, 0.12, 1)
m.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 1
g.data.materials.append(m)
# Red balloons, enlarged 2.5x around their own centers so they read at farm scale
for mat in bpy.data.materials:
    if mat.name.startswith("BalloonMaterial") and mat.use_nodes:
        for nd in mat.node_tree.nodes:
            if nd.type == 'BSDF_PRINCIPLED':
                for l in list(nd.inputs["Base Color"].links): mat.node_tree.links.remove(l)
                nd.inputs["Base Color"].default_value = (0.75, 0.04, 0.04, 1)
                nd.inputs["Roughness"].default_value = 0.4
parts = [o for o in sc.objects if o.name.split(".")[0] in ("balon", "bascet", "Cylinder")]
for b in [o for o in parts if o.name.split(".")[0] == "balon"]:
    c = b.matrix_world.translation.copy()
    for o in parts:
        if (o.location - c).length < 1.5:
            o.location = c + (o.location - c) * 2.5
            o.scale = tuple(v * 2.5 for v in o.scale)
bpy.ops.object.select_all(action='DESELECT')
for o in sc.objects:
    if o.type in {'MESH','CURVE','EMPTY'} and not o.hide_render: o.select_set(True)
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_apply=True,
    export_animations=False, export_cameras=False, export_lights=False,
    export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7, export_yup=True)
print("EXPORTED")
