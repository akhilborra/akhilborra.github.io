"""Record real particle trajectories from the bubble simulation for the web animation.

Run:  Blender -b main_APS_static_animation5.blend --python tools/bake_bubbles.py -- out.json [N]

Picks N particles born during one lifetime window starting at the scene's render
start, steps the simulation, and stores each particle's position at every age
(0 .. lifetime-1). The web viewer then loops them with staggered start times, which
gives a steady stream in which each bubble respawns at the generator as it dies.
"""
import bpy, json, random, sys

args = sys.argv[sys.argv.index("--") + 1:]
out, N = args[0], int(args[1]) if len(args) > 1 else 1000
sc = bpy.context.scene
emitter = bpy.data.objects["Cylinder"]
settings = emitter.particle_systems[0].settings
W = int(settings.lifetime)            # loop length = one particle lifetime (frames)
B0 = sc.frame_start                   # births sampled in [B0, B0 + W)


def psys():
    dg = bpy.context.evaluated_depsgraph_get()
    return emitter.evaluated_get(dg).particle_systems[0]

sc.frame_set(B0)
ps = psys()
cand = [i for i, p in enumerate(ps.particles) if B0 <= p.birth_time < B0 + W]
random.seed(7)
pick = sorted(random.sample(cand, min(N, len(cand))))
births = {i: ps.particles[i].birth_time for i in pick}
paths = {i: [None] * W for i in pick}

for f in range(B0, B0 + 2 * W):
    sc.frame_set(f)
    parts = psys().particles
    for i in pick:
        age = f - int(round(births[i]))
        if 0 <= age < W:
            x, y, z = parts[i].location
            paths[i][age] = (round(x, 3), round(y, 3), round(z, 3))
    if f % 50 == 0:
        print("frame", f, flush=True)

data = {
    "fps": sc.render.fps,
    "lifetime": W,
    "bubbles": [{"birth": births[i] - B0, "path": paths[i]} for i in pick
                if all(p is not None for p in paths[i])],
}
json.dump(data, open(out, "w"))
print("BAKED", len(data["bubbles"]), "bubbles, lifetime", W)
