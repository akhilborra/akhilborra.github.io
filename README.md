# Research website

Static site (plain HTML/CSS, no build step) for GitHub Pages.

```
index.html              Home: intro, project cards, publications, experience, contact
projects/*.html         One page per project
assets/css/style.css    All styling (light + dark mode)
assets/img/             Figures (resized JPEGs)
assets/models/          3D models (.glb) shown with <model-viewer>
tools/                  Blender scripts that exported the .glb models
```

## Preview locally

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Publish on GitHub Pages

1. Create a GitHub repo named `<your-username>.github.io` (or any name, for a `/<repo>/` URL).
2. From this folder:

   ```bash
   git init && git add . && git commit -m "Initial site"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<your-username>.github.io.git
   git push -u origin main
   ```

3. In the repo, go to **Settings → Pages**, set **Source** to *Deploy from a branch*, and pick `main` / root.

## Editing

- To add a project, copy one of the pages in `projects/`, then add a matching `<a class="card">` block to `index.html`.
- To add a CV, put it at `assets/Borra_CV.pdf` and add `<a class="btn" href="assets/Borra_CV.pdf">CV</a>` to the hero links in `index.html`.

## 3D models

The two interactive models were exported from the Blender scenes with the scripts in `tools/`
(grass instances removed, Draco-compressed). The bubble-setup model is animated: bubble paths are
baked from the scene's particle simulation and looped, and the rotor and tip-vortex helix spin.
To rebuild it after editing the scene:

```bash
B=/Applications/Blender.app/Contents/MacOS/Blender
$B -b "path/to/main_APS_static_animation5.blend" --python tools/export_bubble.py -- static.glb --animated
$B -b "path/to/main_APS_static_animation5.blend" --python tools/bake_bubbles.py -- paths.json 1000
python3 tools/animate_glb.py static.glb paths.json assets/models/lpt-setup.glb
$B -b "path/to/wind_farm.blend" --python tools/export_farm.py -- assets/models/balloon-farm.glb
```

The bake steps through the simulation and takes about 5 minutes. The scripts only modify the scene in
memory; the .blend files are not saved. After changing `style.css`, bump the `?v=` number on the
stylesheet links so browsers fetch the new version.
