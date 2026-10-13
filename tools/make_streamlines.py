"""Generate the faint streamline background (flow over a Gaussian bump with a gentle wake).

    python3 tools/make_streamlines.py
writes assets/img/streamlines-light.svg and assets/img/streamlines-dark.svg
"""
import math, os

W, H = 1600, 1000
here = os.path.dirname(os.path.abspath(__file__))
out_dir = os.path.join(here, "..", "assets", "img")

def line(y0, k):
    pts = []
    for i in range(0, 161):
        x = W * i / 160
        # bump displacement decays with height; wake undulation grows downstream
        bump = 210 * math.exp(-((x - 620) / 230) ** 2) * math.exp(-y0 / 520)
        wake = 18 * math.sin(x / 95 + k * 0.7) * max(0, (x - 760) / 840) * math.exp(-abs(y0 - 300) / 380)
        pts.append((x, H - (y0 + bump + wake)))
    d = "M" + " L".join(f"{x:.1f},{y:.1f}" for x, y in pts)
    return d

paths = [line(y0, k) for k, y0 in enumerate(range(20, 1000, 34))]
for name, color, op in (("light", "#1b1f1d", 0.10), ("dark", "#f2f0ea", 0.06)):
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" preserveAspectRatio="xMidYMid slice">'
           f'<g fill="none" stroke="{color}" stroke-opacity="{op}" stroke-width="1" vector-effect="non-scaling-stroke">'
           + "".join(f'<path vector-effect="non-scaling-stroke" d="{d}"/>' for d in paths) + "</g></svg>")
    open(os.path.join(out_dir, f"streamlines-{name}.svg"), "w").write(svg)
print("ok", len(paths), "lines")
