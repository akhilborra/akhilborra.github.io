// Playback of every measured bubble trajectory from the March 2026 Winterthur campaign.
// Data: assets/data/lpt-tracks.bin, built from the processed tracks by tools/build_lpt_tracks.py
// (all tracks, each decimated to ~40 Hz, positions in metres, colour = measured speed |v|).
// The 18 recordings are overlaid on one clock, each starting at its own first frame, and play
// with fading tails; one recording can be picked instead, and the speed changed (1x = real time).
// The turbine is drawn from the processing settings (4d-ptv settings.json, same camera-plane frame
// as the tracks). Drag to rotate, shift/right-drag or two fingers to pan, wheel or pinch to zoom, double-click to reset;
// until then the view sways slowly about a view from behind.
// Animates only while on screen; prefers-reduced-motion holds a still frame until Play is pressed.
(() => {
  const fig = document.getElementById("lpt-tracks");
  if (!fig) return;
  const canvas = fig.querySelector("canvas");
  const btn = fig.querySelector(".lpt-play");
  const runSel = fig.querySelector(".lpt-run");
  const speedBtns = [...fig.querySelectorAll(".lpt-speed button")];
  const src = fig.dataset.src, meshSrc = fig.dataset.turbine;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const C = {
    panel: "#171a18", grid: "rgba(236,235,229,.09)", text: "#a9aeaa", dim: "rgba(236,235,229,.38)",
    ink: "#ecebe5", brass: "#c9a86b", turbine: "rgba(236,235,229,.55)", ground: "rgba(236,235,229,.05)",
  };
  // turbine in the camera-plane frame of the tracks [m] (4d-ptv settings.json "turbine" block):
  // tower base at ground level, hub 18 m above it, 0.98 m overhang, rotor faces -x, R = 6.4 m
  const TOWER = [-7.069, -4.5159, -1.62], HUB_H = 18, OVERHANG = 0.98, R_ROT = 6.4;
  const FONT = '600 11px Inter, system-ui, sans-serif';
  const TAIL = 0.45;                 // s of history drawn behind each bubble
  const NA = 5, ALPHA = [0.95, 0.62, 0.4, 0.24, 0.11];
  const NC = 8, V0 = 2, V1 = 8;      // speed colour bins, m/s
  // brass -> light ramp: slow = deep brass, fast = near-white
  const STOPS = [[122, 98, 58], [201, 168, 107], [242, 240, 234]];
  const ramp = f => {
    const s = Math.min(Math.max(f, 0), 1) * (STOPS.length - 1), i = Math.min(Math.floor(s), STOPS.length - 2), u = s - i;
    return STOPS[i].map((c, k) => Math.round(c + (STOPS[i + 1][k] - c) * u));
  };
  const BIN_RGB = Array.from({ length: NC }, (_, b) => ramp((b + 0.5) / NC));
  const binOf = v => { const b = Math.floor((v - V0) / (V1 - V0) * NC); return b < 0 ? 0 : b >= NC ? NC - 1 : b; };

  // ---------- canvas ----------
  const ctx = canvas.getContext("2d");
  let W = 0, H = 0;
  const fit = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    requestDraw();
  };
  const label = (s, x, y, color = C.text, align = "left") => {
    ctx.font = FONT; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = "alphabetic";
    if ("letterSpacing" in ctx) ctx.letterSpacing = "1.3px";
    ctx.fillText(s.toUpperCase(), x, y);
  };

  // ---------- data ----------
  let D = null;   // parsed data
  async function load() {
    const res = await fetch(src);
    if (!res.ok) throw new Error(res.status);
    // content-length is only a progress estimate: servers like GitHub Pages gzip the file,
    // so it reports the compressed size while the stream delivers the larger decoded bytes
    const total = +res.headers.get("content-length") || 0;
    let buf;
    if (res.body && total) {
      const reader = res.body.getReader(), chunks = [];
      let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value); got += value.length;
        progress = Math.min(0.99, got / total); requestDraw();
      }
      const out = new Uint8Array(got);
      let off = 0;
      for (const c of chunks) { out.set(c, off); off += c.length; }
      buf = out.buffer;
    } else buf = await res.arrayBuffer();
    parse(buf);
  }
  // turbine mesh exported from the Blender setup model (tools/export_turbine_mesh.py)
  let MESH = null;
  async function loadMesh() {
    if (!meshSrc) return;
    const m = await (await fetch(meshSrc)).json();
    const tris = [];
    for (const p of m.parts) {
      const v = p.v, t = p.t;
      for (let i = 0; i < t.length; i += 3) {
        const a = 3 * t[i], b = 3 * t[i + 1], c = 3 * t[i + 2];
        const A = [v[a], v[a + 1], v[a + 2]], B = [v[b], v[b + 1], v[b + 2]], Cc = [v[c], v[c + 1], v[c + 2]];
        const u = A.map((x, k) => B[k] - x), w = A.map((x, k) => Cc[k] - x);
        let n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
        const l = Math.hypot(...n); if (!l) continue; n = n.map(x => x / l);
        tris.push({ p: [A, B, Cc], n, blade: p.name.startsWith("Blade") });
      }
    }
    MESH = tris;
    requestDraw();
  }
  function parse(buf) {
    const hl = new DataView(buf).getUint32(0, true);
    const h = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, hl)));
    let o = 4 + hl;
    const N = h.tracks, P = h.points;
    const tab = new Uint16Array(buf, o, 2 * N); o += 4 * N;
    const q = new Int16Array(buf, o, 3 * P); o += 6 * P;
    const sp = new Uint8Array(buf, o, P);
    const pos = new Float32Array(3 * P), spd = new Float32Array(P);
    for (let i = 0; i < 3 * P; i++) pos[i] = q[i] * h.q;     // metres, relative to h.origin
    for (let i = 0; i < P; i++) spd[i] = sp[i] * h.speed_q;
    const t0 = new Float32Array(N), t1 = new Float32Array(N), dt = new Float32Array(N), off = new Int32Array(N), n = new Int32Array(N);
    let i = 0, p = 0, dur = 0;
    for (const r of h.runs) {
      dur = Math.max(dur, r.duration);
      r.first = i; r.last = i + r.tracks;
      for (let k = 0; k < r.tracks; k++, i++) {
        t0[i] = tab[2 * i] / r.fps; n[i] = tab[2 * i + 1]; dt[i] = r.dt; off[i] = p;
        t1[i] = t0[i] + (n[i] - 1) * r.dt; p += n[i];
      }
    }
    const lo = h.box[0].map((v, k) => v - h.origin[k]), hi = h.box[1].map((v, k) => v - h.origin[k]);
    const rel = (v, k) => v - h.origin[k];
    const base = TOWER.map(rel), hub = [base[0] - OVERHANG, base[1], base[2] + HUB_H];
    D = { h, N, P, pos, spd, t0, t1, dt, off, n, loop: dur + TAIL, lo, hi,
      ctr: lo.map((v, k) => (v + hi[k]) / 2), runs: h.runs.length, base, hub };
    if (runSel) {
      h.runs.forEach((r, k) => runSel.add(new Option(
        `Recording ${r.dataset} · ${Math.round(r.fps)} Hz · ${r.duration.toFixed(1)} s · ${r.tracks.toLocaleString("en")} tracks`, k)));
      runSel.disabled = false;
    }
  }

  // ---------- camera ----------
  // seen from behind the turbine and a little to its left, like the schematic above
  const AZ0 = -0.98, EL0 = 0.2, DIST = 34, K = 2.2, ZMIN = 0.18, ZMAX = 2.4;
  let az = AZ0, el = EL0, dragAz = 0, dragEl = 0, cam = null;
  let zoom = 0.85, pan = [0, 0, 0], interacted = false;     // zoom: distance factor; pan: world offset [m]
  function setCam(target0) {
    const target = target0.map((v, k) => v + pan[k]), dist = DIST * zoom;
    const ca = Math.cos(az), sa = Math.sin(az), ce = Math.cos(el), se = Math.sin(el);
    const eye = [target[0] + dist * ca * ce, target[1] + dist * sa * ce, target[2] + dist * se];
    let f = [target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]];
    const fl = Math.hypot(...f); f = f.map(v => v / fl);
    let r = [f[1], -f[0], 0]; const rl = Math.hypot(...r); r = r.map(v => v / rl);      // f x z
    const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
    const s = Math.min(W * 1.35, H * 1.25) * 0.5 * K, cx = W / 2, cy = H / 2 - 2;
    cam = { eye, f, r, u, s, cx, cy, dist };
  }
  // project into out[0..1]; returns false if behind the camera
  const out = [0, 0];
  function proj(x, y, z) {
    const dx = x - cam.eye[0], dy = y - cam.eye[1], dz = z - cam.eye[2];
    const zc = dx * cam.f[0] + dy * cam.f[1] + dz * cam.f[2];
    if (zc < 0.5) return false;
    out[0] = cam.cx + cam.s * (dx * cam.r[0] + dy * cam.r[1] + dz * cam.r[2]) / zc;
    out[1] = cam.cy - cam.s * (dx * cam.u[0] + dy * cam.u[1] + dz * cam.u[2]) / zc;
    return true;
  }

  function drawBox() {
    const { lo, hi } = D;
    const V = [0, 1, 2, 3, 4, 5, 6, 7].map(b => [b & 1 ? hi[0] : lo[0], b & 2 ? hi[1] : lo[1], b & 4 ? hi[2] : lo[2]]);
    const E = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
    ctx.strokeStyle = C.grid; ctx.lineWidth = 1; ctx.beginPath();
    for (const [a, b] of E) {
      if (!proj(...V[a])) continue; const ax = out[0], ay = out[1];
      if (!proj(...V[b])) continue; ctx.moveTo(ax, ay); ctx.lineTo(out[0], out[1]);
    }
    ctx.stroke();
    // edge lengths on the three edges through the near-bottom corner
    const L = (a, b, s) => {
      const m = a.map((v, k) => (v + b[k]) / 2);
      if (proj(...m)) label(s, out[0], out[1] + 14, C.dim, "center");
    };
    L(V[0], V[1], `x ${(hi[0] - lo[0]).toFixed(1)} m`);
    L(V[0], V[2], `y ${(hi[1] - lo[1]).toFixed(1)} m`);
    // flow arrow along +x under the box
    const y0 = lo[1], z0 = lo[2] - 0.6, xa = lo[0] + 0.3, xb = hi[0] - 0.3;
    if (proj(xa, y0, z0)) {
      const ax = out[0], ay = out[1];
      if (proj(xb, y0, z0)) {
        const bx = out[0], by = out[1], ang = Math.atan2(by - ay, bx - ax);
        ctx.strokeStyle = C.dim; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
        ctx.moveTo(bx, by); ctx.lineTo(bx - 7 * Math.cos(ang - 0.45), by - 7 * Math.sin(ang - 0.45));
        ctx.moveTo(bx, by); ctx.lineTo(bx - 7 * Math.cos(ang + 0.45), by - 7 * Math.sin(ang + 0.45));
        ctx.stroke();
        label("Wind", bx + 8, by + 4, C.dim);
      }
    }
  }

  // ---------- turbine: tapered tubular tower, nacelle with spinner, twisted tapered blades ----------
  // Shapes are projected silhouettes, shaded across their width to read as solid bodies.
  const TW = { base: 0.42, top: 0.26 };                  // tower radius [m]
  const NAC = { r: 0.36, len: 2.3 }, SPIN = 0.42;        // nacelle radius / length, spinner radius [m]
  // blade planform: [r/R, chord/R, twist rad] (generic small-turbine blade, chord max near 20% span)
  const BLADE = [[0.07, 0.07, 0.38], [0.12, 0.095, 0.34], [0.2, 0.105, 0.26], [0.35, 0.09, 0.17],
                 [0.5, 0.074, 0.11], [0.65, 0.06, 0.07], [0.8, 0.046, 0.04], [0.92, 0.035, 0.02], [1, 0.022, 0.01]];
  const shade = (x0, y0, x1, y1, lit, dark) => {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, dark); g.addColorStop(0.35, lit); g.addColorStop(1, dark); return g;
  };
  function body(a, b, ra, rb, lit, dark) {    // projected cylinder/cone silhouette from a to b
    if (!proj(...a)) return; const A = [out[0], out[1]], za = depth(a);
    if (!proj(...b)) return; const B = [out[0], out[1]], zb = depth(b);
    let nx = -(B[1] - A[1]), ny = B[0] - A[0]; const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
    const wa = ra * cam.s / za, wb = rb * cam.s / zb;
    ctx.fillStyle = shade(A[0] - nx * wa, A[1] - ny * wa, A[0] + nx * wa, A[1] + ny * wa, lit, dark);
    ctx.beginPath();
    ctx.moveTo(A[0] + nx * wa, A[1] + ny * wa); ctx.lineTo(B[0] + nx * wb, B[1] + ny * wb);
    ctx.arc(B[0], B[1], wb, Math.atan2(ny, nx), Math.atan2(ny, nx) + Math.PI, true);
    ctx.lineTo(A[0] - nx * wa, A[1] - ny * wa);
    ctx.arc(A[0], A[1], wa, Math.atan2(-ny, -nx), Math.atan2(-ny, -nx) + Math.PI, true);
    ctx.closePath(); ctx.fill();
  }
  const depth = v => (v[0] - cam.eye[0]) * cam.f[0] + (v[1] - cam.eye[1]) * cam.f[1] + (v[2] - cam.eye[2]) * cam.f[2];
  function blades(hub) {
    for (let b = 0; b < 3; b++) {
      const a = Math.PI / 2 + 0.35 + b * 2 * Math.PI / 3, ca = Math.cos(a), sa = Math.sin(a);
      // radial unit (in the rotor plane), tangential unit (in plane), axial unit (-x, upwind)
      const rad = [0, ca, sa], tan = [0, -sa, ca];
      const lead = [], trail = [];
      for (const [rr, cc, tw] of BLADE) {
        const r = rr * R_ROT, c = cc * R_ROT;
        const ch = [-Math.sin(tw), tan[1] * Math.cos(tw), tan[2] * Math.cos(tw)];   // chord line, twisted out of plane
        const P = (f) => [hub[0] + ch[0] * c * f, hub[1] + rad[1] * r + ch[1] * c * f, hub[2] + rad[2] * r + ch[2] * c * f];
        if (!proj(...P(0.3))) return; lead.push([out[0], out[1]]);
        if (!proj(...P(-0.7))) return; trail.push([out[0], out[1]]);
      }
      const root = lead[0], tip = lead[lead.length - 1];
      ctx.fillStyle = shade(root[0], root[1], tip[0], tip[1], "rgba(236,235,229,.92)", "rgba(170,172,168,.85)");
      ctx.beginPath(); lead.forEach((q, i) => i ? ctx.lineTo(...q) : ctx.moveTo(...q));
      for (let i = trail.length - 1; i >= 0; i--) ctx.lineTo(...trail[i]);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "rgba(15,18,17,.35)"; ctx.lineWidth = 0.7; ctx.stroke();
    }
    // spinner
    if (proj(hub[0] - 0.25, hub[1], hub[2])) {
      const rs = SPIN * cam.s / depth([hub[0] - 0.25, hub[1], hub[2]]);
      const g = ctx.createRadialGradient(out[0] - rs * 0.35, out[1] - rs * 0.35, rs * 0.1, out[0], out[1], rs);
      g.addColorStop(0, "#f2f0ea"); g.addColorStop(1, "#8d918d");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(out[0], out[1], rs, 0, 2 * Math.PI); ctx.fill();
    }
  }
  // flat-shaded mesh: sun from above and to one side plus a weak headlight; two-sided for the thin
  // blades; triangles drawn far to near
  const SUN = (() => { const v = [0.35, -0.45, 0.82], l = Math.hypot(...v); return v.map(x => x / l); })();
  const order = [];
  function drawMesh(base) {
    order.length = 0;
    for (const tr of MESH) {
      const q = [];
      let d = 0, ok = true;
      for (const P of tr.p) {
        const x = base[0] + P[0], y = base[1] + P[1], z = base[2] + P[2];
        if (!proj(x, y, z)) { ok = false; break; }
        q.push(out[0], out[1]); d += depth([x, y, z]);
      }
      if (!ok) continue;
      let ns = tr.n[0] * SUN[0] + tr.n[1] * SUN[1] + tr.n[2] * SUN[2];
      let nv = -(tr.n[0] * cam.f[0] + tr.n[1] * cam.f[1] + tr.n[2] * cam.f[2]);
      if (nv < 0) { if (!tr.blade) continue; ns = -ns; nv = -nv; }      // back faces: only the blades show both sides
      const lum = 0.34 + 0.5 * Math.max(0, ns) + 0.2 * nv;
      order.push({ q, d, lum });
    }
    order.sort((a, b) => b.d - a.d);
    for (const o of order) {
      const c = Math.round(Math.min(1, o.lum) * 232), col = `rgb(${c},${c},${Math.round(c * 0.975)})`;
      ctx.fillStyle = col; ctx.strokeStyle = col; ctx.lineWidth = 0.6;
      ctx.beginPath(); ctx.moveTo(o.q[0], o.q[1]); ctx.lineTo(o.q[2], o.q[3]); ctx.lineTo(o.q[4], o.q[5]); ctx.closePath();
      ctx.fill(); ctx.stroke();
    }
  }

  function drawTurbine() {
    const { base, hub } = D;
    const P = v => proj(v[0], v[1], v[2]) ? [out[0], out[1]] : null;
    // ground grid around the tower and under the volume
    ctx.strokeStyle = C.ground; ctx.lineWidth = 1; ctx.beginPath();
    for (let x = -14; x <= 8; x += 2) { const a = P([x, -12, base[2]]), b = P([x, 10, base[2]]); if (a && b) { ctx.moveTo(...a); ctx.lineTo(...b); } }
    for (let y = -12; y <= 10; y += 2) { const a = P([-14, y, base[2]]), b = P([8, y, base[2]]); if (a && b) { ctx.moveTo(...a); ctx.lineTo(...b); } }
    ctx.stroke();
    const top = [base[0], base[1], hub[2] - NAC.r * 0.9];
    const nacA = [hub[0] + 0.2, hub[1], hub[2]], nacB = [hub[0] + NAC.len, hub[1], hub[2]];
    const tower = () => body(base, top, TW.base, TW.top, "#d4d3cd", "#6f736f");
    const nacelle = () => body(nacA, nacB, NAC.r, NAC.r * 0.8, "#e2e1db", "#7b7f7b");
    if (MESH) drawMesh(base);
    // painter's order: whichever of rotor and tower is nearer the camera goes last
    else if (cam.eye[0] > hub[0]) { blades(hub); nacelle(); tower(); }
    else { tower(); nacelle(); blades(hub); }
    const tb = P(base); if (tb) label("Turbine", tb[0], tb[1] + 18, C.dim, "center");
  }

  function drawLegend() {
    const x = 14, y = H - 18, w = Math.min(120, W * 0.28);
    for (let b = 0; b < NC; b++) {
      const [r, g, bl] = BIN_RGB[b]; ctx.fillStyle = `rgb(${r},${g},${bl})`;
      ctx.fillRect(x + b * w / NC, y, w / NC + 0.5, 4);
    }
    label("Speed |v|", x, y - 8, C.text);
    label(`${V0}`, x, y + 17, C.dim);
    label(`${V1} m/s`, x + w, y + 17, C.dim, "right");
  }

  // ---------- frame ----------
  const paths = Array.from({ length: NC * NA }, () => null);
  const heads = Array.from({ length: NC }, () => null);
  function drawTracks(t) {
    const { pos, spd, t0, t1, dt, off, n } = D;
    const run = sel >= 0 ? D.h.runs[sel] : null, i0 = run ? run.first : 0, i1 = run ? run.last : D.N;
    for (let i = 0; i < paths.length; i++) paths[i] = new Path2D();
    for (let i = 0; i < NC; i++) heads[i] = new Path2D();
    let active = 0;
    for (let i = i0; i < i1; i++) {
      if (t0[i] > t || t1[i] < t - TAIL) continue;
      const ta = Math.max(t0[i], t - TAIL), tb = Math.min(t, t1[i]);
      const ja = Math.floor((ta - t0[i]) / dt[i]), jb = Math.min(Math.ceil((tb - t0[i]) / dt[i]), n[i] - 1);
      if (t <= t1[i]) active++;
      const o = off[i];
      let px = 0, py = 0, have = false, tp = t0[i] + ja * dt[i];
      for (let j = ja; j <= jb; j++) {
        const p = 3 * (o + j);
        let x = pos[p], y = pos[p + 1], z = pos[p + 2], tj = t0[i] + j * dt[i];
        // clip the first/last sample to the tail window by linear interpolation between samples
        if (j === ja && tj < ta && j < jb) {
          const u = (ta - tj) / dt[i]; x += (pos[p + 3] - x) * u; y += (pos[p + 4] - y) * u; z += (pos[p + 5] - z) * u; tj = ta;
        } else if (j === jb && tj > tb && j > ja) {
          const u = (tj - tb) / dt[i]; x += (pos[p - 3] - x) * u; y += (pos[p - 2] - y) * u; z += (pos[p - 1] - z) * u; tj = tb;
        }
        if (!proj(x, y, z)) { have = false; continue; }
        const sx = out[0], sy = out[1];
        if (have) {
          const c = binOf(spd[o + j - 1]);
          let a = Math.floor((t - 0.5 * (tp + tj)) / TAIL * NA); if (a < 0) a = 0; else if (a >= NA) a = NA - 1;
          const path = paths[c * NA + a]; path.moveTo(px, py); path.lineTo(sx, sy);
        }
        px = sx; py = sy; tp = tj; have = true;
      }
      if (have && (t <= t1[i] || n[i] === 1)) heads[binOf(spd[o + jb])].rect(px - 1.1, py - 1.1, 2.2, 2.2);
    }
    ctx.lineCap = "round";
    ctx.lineWidth = 1.15;
    for (let c = 0; c < NC; c++) {
      const [r, g, b] = BIN_RGB[c];
      for (let a = 0; a < NA; a++) {
        ctx.strokeStyle = `rgba(${r},${g},${b},${ALPHA[a]})`;
        ctx.stroke(paths[c * NA + a]);
      }
      ctx.fillStyle = `rgb(${Math.min(r + 20, 255)},${Math.min(g + 20, 255)},${Math.min(b + 20, 255)})`; ctx.fill(heads[c]);
    }
    return active;
  }

  // start 1 s in so tails exist; with reduced motion, hold a still frame until Play is pressed
  let progress = 0, failed = false, playing = !reduce, simT = reduce ? 6 : 1, sel = -1, speed = 1, swayT = 0;
  const loopLen = () => sel >= 0 ? D.h.runs[sel].duration + TAIL : D.loop;
  function draw() {
    ctx.fillStyle = C.panel; ctx.fillRect(0, 0, W, H);
    if (!D) {
      label(failed ? "Could not load the trajectories" : `Loading measured trajectories${progress ? ` · ${Math.round(progress * 100)}%` : ""}`,
        W / 2, H / 2, C.text, "center");
      return;
    }
    az = AZ0 + dragAz + (reduce || interacted ? 0 : 0.3 * Math.sin(2 * Math.PI * swayT / 47));   // slow sway until the viewer takes over
    el = Math.min(1.35, Math.max(-0.2, EL0 + dragEl));
    setCam([(D.ctr[0] + D.hub[0]) / 2, (D.ctr[1] + D.hub[1]) / 2, D.ctr[2] + 1.5]);
    drawTurbine();
    drawBox();
    const L = loopLen(), t = simT % L, run = sel >= 0 ? D.h.runs[sel] : null;
    const active = drawTracks(t);
    label(run ? `Measured · Recording ${run.dataset}` : `Measured · ${D.runs} recordings overlaid`, 14, 24, C.ink);
    label(`${active.toLocaleString("en")} of ${(run ? run.tracks : D.N).toLocaleString("en")} tracks in view`, 14, 41, C.dim);
    label(`t = ${Math.min(t, L - TAIL).toFixed(1)} s`, W - 14, 24, C.brass, "right");
    label(!playing ? "Paused" : speed === 1 ? "Real time" : `${speed}× real time`, W - 14, 41, C.dim, "right");
    drawLegend();
  }
  let queued = false;
  function requestDraw() { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; if (!running) draw(); }); } }

  // ---------- loop: only while visible and playing ----------
  let visible = false, running = false, last = 0;
  function tick(now) {
    if (!(visible && playing && D)) { running = false; return; }
    const d = (now - last) / 1000; last = now;
    const step = Math.min(Math.max(d, 0), 0.1);
    simT = Math.max(0, simT + step * speed); swayT += step;
    draw();
    requestAnimationFrame(tick);
  }
  function kick() {
    if (running || !(visible && playing && D)) return;
    running = true; last = performance.now(); requestAnimationFrame(tick);
  }
  function setPlaying(p) {
    playing = p;
    btn.textContent = p ? "Pause" : "Play";
    btn.setAttribute("aria-pressed", String(!p));
    btn.setAttribute("aria-label", p ? "Pause trajectory playback" : "Play trajectory playback");
    p ? kick() : requestDraw();
  }
  btn.addEventListener("click", () => setPlaying(!playing));
  // speed and recording controls
  speedBtns.forEach(b => b.addEventListener("click", () => {
    speed = +b.dataset.speed;
    speedBtns.forEach(o => o.setAttribute("aria-pressed", String(o === b)));
    requestDraw();
  }));
  if (runSel) runSel.addEventListener("change", () => {
    sel = +runSel.value;
    simT = Math.min(1, loopLen() / 4);     // restart near the beginning, with tails already showing
    requestDraw(); kick();
  });
  setPlaying(playing);

  // ---------- move around: drag rotates; shift/right-drag or two fingers pans; wheel/pinch zooms ----------
  const redraw = () => { if (!running) requestDraw(); };
  const takeOver = () => {
    if (!interacted) { interacted = true; dragAz += reduce ? 0 : 0.3 * Math.sin(2 * Math.PI * swayT / 47); }
  };
  const setZoom = z => { zoom = Math.min(ZMAX, Math.max(ZMIN, z)); redraw(); };
  function panBy(dx, dy) {      // screen pixels -> metres at the target distance
    if (!cam) return; const m = cam.dist / cam.s;
    for (let k = 0; k < 3; k++) pan[k] += (-dx * cam.r[k] + dy * cam.u[k]) * m;
    redraw();
  }
  const pts = new Map();
  let gesture = null;
  canvas.addEventListener("contextmenu", e => e.preventDefault());
  canvas.addEventListener("pointerdown", e => {
    takeOver();
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    canvas.setPointerCapture(e.pointerId);
    if (pts.size === 1) gesture = { mode: e.shiftKey || e.button === 2 ? "pan" : "rotate", x: e.clientX, y: e.clientY };
    else if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      gesture = { mode: "pinch", d: Math.hypot(a.x - b.x, a.y - b.y), z: zoom, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    }
  });
  canvas.addEventListener("pointermove", e => {
    if (!pts.has(e.pointerId) || !gesture) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (gesture.mode === "pinch" && pts.size >= 2) {
      const [a, b] = [...pts.values()], mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      setZoom(gesture.z * gesture.d / Math.max(20, Math.hypot(a.x - b.x, a.y - b.y)));
      panBy(mx - gesture.mx, my - gesture.my); gesture.mx = mx; gesture.my = my;
    } else if (gesture.mode === "pan") {
      panBy(e.clientX - gesture.x, e.clientY - gesture.y); gesture.x = e.clientX; gesture.y = e.clientY;
    } else if (gesture.mode === "rotate") {
      dragAz -= (e.clientX - gesture.x) * 0.008; dragEl += (e.clientY - gesture.y) * 0.006;
      gesture.x = e.clientX; gesture.y = e.clientY; redraw();
    }
  });
  const end = e => {
    pts.delete(e.pointerId);
    if (pts.size === 1) { const [p] = pts.values(); gesture = { mode: "rotate", x: p.x, y: p.y }; }
    else if (!pts.size) gesture = null;
  };
  canvas.addEventListener("pointerup", end); canvas.addEventListener("pointercancel", end);
  canvas.addEventListener("wheel", e => {
    e.preventDefault(); takeOver();
    setZoom(zoom * Math.exp((e.ctrlKey ? 0.01 : 0.0015) * e.deltaY));
  }, { passive: false });
  function resetView() { interacted = false; dragAz = 0; dragEl = 0; zoom = 0.85; pan = [0, 0, 0]; redraw(); }
  canvas.addEventListener("dblclick", resetView);
  fig.querySelectorAll(".lpt-nav button").forEach(b => b.addEventListener("click", () => {
    takeOver();
    const z = b.dataset.zoom;
    z === "in" ? setZoom(zoom / 1.3) : z === "out" ? setZoom(zoom * 1.3) : resetView();
  }));

  new ResizeObserver(fit).observe(canvas);
  let started = false;
  new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting && !started) {
      started = true;
      load().then(() => { requestDraw(); kick(); }).catch(() => { failed = true; requestDraw(); });
      loadMesh().catch(() => {});        // falls back to the drawn turbine
    }
  }), { rootMargin: "600px 0px" }).observe(canvas);
  new IntersectionObserver(es => es.forEach(e => { visible = e.isIntersecting; visible ? kick() : 0; })).observe(canvas);
})();
