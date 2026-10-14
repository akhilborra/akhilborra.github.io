// Playback of every measured bubble trajectory from the March 2026 Winterthur campaign.
// Data: assets/data/lpt-tracks.bin, built from the processed tracks by tools/build_lpt_tracks.py
// (all tracks, each decimated to ~40 Hz, positions in metres, colour = measured speed |v|).
// The 18 recordings are overlaid on one clock, each starting at its own first frame, and play
// at real time with fading tails. Drag to rotate; the view otherwise sways slowly about a side view.
// Animates only while on screen; prefers-reduced-motion holds a still frame until Play is pressed.
(() => {
  const fig = document.getElementById("lpt-tracks");
  if (!fig) return;
  const canvas = fig.querySelector("canvas");
  const btn = fig.querySelector(".lpt-play");
  const src = fig.dataset.src;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const C = {
    panel: "#171a18", grid: "rgba(236,235,229,.09)", text: "#a9aeaa", dim: "rgba(236,235,229,.38)",
    ink: "#ecebe5", brass: "#c9a86b",
  };
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
    const total = +res.headers.get("content-length") || 0;
    let buf;
    if (res.body && total) {
      const reader = res.body.getReader(), out = new Uint8Array(total);
      let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (got + value.length > out.length) { buf = null; break; }
        out.set(value, got); got += value.length;
        progress = got / total; requestDraw();
      }
      buf = out.buffer.slice(0, got);
    } else buf = await res.arrayBuffer();
    parse(buf);
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
      for (let k = 0; k < r.tracks; k++, i++) {
        t0[i] = tab[2 * i] / r.fps; n[i] = tab[2 * i + 1]; dt[i] = r.dt; off[i] = p;
        t1[i] = t0[i] + (n[i] - 1) * r.dt; p += n[i];
      }
    }
    const lo = h.box[0].map((v, k) => v - h.origin[k]), hi = h.box[1].map((v, k) => v - h.origin[k]);
    D = { h, N, P, pos, spd, t0, t1, dt, off, n, loop: dur + TAIL, lo, hi,
      ctr: lo.map((v, k) => (v + hi[k]) / 2), runs: h.runs.length };
  }

  // ---------- camera ----------
  const AZ0 = -Math.PI / 2 + 0.55, EL0 = 0.3, DIST = 19, K = 2.2;
  let az = AZ0, el = EL0, dragAz = 0, dragEl = 0, cam = null;
  function setCam(target) {
    const ca = Math.cos(az), sa = Math.sin(az), ce = Math.cos(el), se = Math.sin(el);
    const eye = [target[0] + DIST * ca * ce, target[1] + DIST * sa * ce, target[2] + DIST * se];
    let f = [target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]];
    const fl = Math.hypot(...f); f = f.map(v => v / fl);
    let r = [f[1], -f[0], 0]; const rl = Math.hypot(...r); r = r.map(v => v / rl);      // f x z
    const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
    const s = Math.min(W * 1.35, H * 1.25) * 0.5 * K, cx = W / 2, cy = H / 2 - 2;
    cam = { eye, f, r, u, s, cx, cy };
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
    const { pos, spd, t0, t1, dt, off, n, N } = D;
    for (let i = 0; i < paths.length; i++) paths[i] = new Path2D();
    for (let i = 0; i < NC; i++) heads[i] = new Path2D();
    let active = 0;
    for (let i = 0; i < N; i++) {
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
  let progress = 0, failed = false, playing = !reduce, simT = reduce ? 6 : 1;
  function draw() {
    ctx.fillStyle = C.panel; ctx.fillRect(0, 0, W, H);
    if (!D) {
      label(failed ? "Could not load the trajectories" : `Loading measured trajectories${progress ? ` · ${Math.round(progress * 100)}%` : ""}`,
        W / 2, H / 2, C.text, "center");
      return;
    }
    az = AZ0 + dragAz + (reduce ? 0 : 0.5 * Math.sin(2 * Math.PI * simT / 47));   // slow sway about a side view
    el = Math.min(1.35, Math.max(-0.2, EL0 + dragEl));
    setCam(D.ctr);
    drawBox();
    const t = simT % D.loop;
    const active = drawTracks(t);
    label(`Measured · ${D.runs} runs overlaid`, 14, 24, C.ink);
    label(`${active.toLocaleString("en")} of ${D.N.toLocaleString("en")} tracks in view`, 14, 41, C.dim);
    label(`t = ${Math.min(t, D.loop - TAIL).toFixed(1)} s`, W - 14, 24, C.brass, "right");
    label(playing ? "Real time" : "Paused", W - 14, 41, C.dim, "right");
    drawLegend();
  }
  let queued = false;
  function requestDraw() { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; if (!running) draw(); }); } }

  // ---------- loop: only while visible and playing ----------
  let visible = false, running = false, last = 0;
  function tick(now) {
    if (!(visible && playing && D)) { running = false; return; }
    const d = (now - last) / 1000; last = now;
    simT = Math.max(0, simT + Math.min(Math.max(d, 0), 0.1));
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
  setPlaying(playing);

  // ---------- drag to rotate (horizontal drags on touch; vertical stays page scroll) ----------
  let drag = null;
  canvas.addEventListener("pointerdown", e => { drag = { x: e.clientX, y: e.clientY, az: dragAz, el: dragEl }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener("pointermove", e => {
    if (!drag) return;
    dragAz = drag.az - (e.clientX - drag.x) * 0.008;
    dragEl = drag.el + (e.clientY - drag.y) * 0.006;
    if (!running) requestDraw();
  });
  const end = () => { drag = null; };
  canvas.addEventListener("pointerup", end); canvas.addEventListener("pointercancel", end);

  new ResizeObserver(fit).observe(canvas);
  let started = false;
  new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting && !started) {
      started = true;
      load().then(() => { requestDraw(); kick(); }).catch(() => { failed = true; requestDraw(); });
    }
  }), { rootMargin: "600px 0px" }).observe(canvas);
  new IntersectionObserver(es => es.forEach(e => { visible = e.isIntersecting; visible ? kick() : 0; })).observe(canvas);
})();
