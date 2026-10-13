# Research website

Static site (plain HTML/CSS, no build step) for GitHub Pages.

```
index.html              Home: intro, project cards, publications, experience, contact
projects/*.html         One page per project
assets/css/style.css    All styling (light + dark mode)
assets/img/             Figures (resized JPEGs)
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
