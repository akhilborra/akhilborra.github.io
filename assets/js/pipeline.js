// Schematic of the LPT processing chain: camera images -> triangulation -> tracks -> vortex.
// Synthetic particles convect along x while swirling around a Lamb-Oseen vortex on the x axis.
(() => {
  const root = document.getElementById("pipeline");
  if (!root) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const C = {
    bg: "#111413", panel: "#171a18", grid: "rgba(236,235,229,.07)", line: "rgba(236,235,229,.22)",
    text: "#a9aeaa", dim: "rgba(236,235,229,.35)", bubble: "#f2f0ea", brass: "#c9a86b",
    brassDim: "rgba(201,168,107,.35)", core: "#c4544a", cam: "#d9d8d2",
  };
  const FONT = '600 11px Inter, system-ui, sans-serif';

  // ---------- synthetic flow ----------
  const GAMMA = 12, RC = 0.8, U = 1.1, XMIN = -4.5, XMAX = 4.5, L = XMAX - XMIN;
  const omega = r => GAMMA / (2 * Math.PI * r * r) * (1 - Math.exp(-r * r / (RC * RC)));
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const N = 64;
  const parts = Array.from({ length: N }, (_, i) => ({
    x0: XMIN + rand() * L, r: 0.35 + 2.3 * Math.sqrt(rand()), th0: rand() * 2 * Math.PI,
    gap: rand() < 0.45 ? 0.3 + rand() * 0.4 : -1,   // phase of an occlusion for stitching
  }));
  function pos(p, t) {
    const th = p.th0 + omega(p.r) * t;
    let x = p.x0 + U * t;
    const wraps = Math.floor((x - XMIN) / L);
    x -= wraps * L;
    return { x, y: p.r * Math.cos(th), z: p.r * Math.sin(th), wraps };
  }

  // ---------- camera math ----------
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = a => { const l = Math.hypot(...a); return [a[0] / l, a[1] / l, a[2] / l]; };
  function lookAt(eye, target) {
    const f = norm(sub(target, eye));
    const r = norm(cross(f, [0, 0, 1]));
    const u = cross(r, f);
    return { eye, f, r, u };
  }
  function project(cam, P, F) {
    const d = sub(P, cam.eye);
    const zc = dot(d, cam.f);
    return { x: F * dot(d, cam.r) / zc, y: -F * dot(d, cam.u) / zc, z: zc };
  }
  // four cameras on the ground around the volume, looking up into it (like the field setup)
  const CAMS = [[-7, -7, -6], [7, -7, -6], [7, 7, -6], [-7, 7, -6]].map(e => lookAt(e, [0, 0, 0]));
  const P3 = p => [p.x, p.y, p.z];

  // ---------- canvas helpers ----------
  function setup(canvas) {
    const ctx = canvas.getContext("2d");
    const fit = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth, h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      canvas._w = w; canvas._h = h;
    };
    fit();
    new ResizeObserver(fit).observe(canvas);
    return ctx;
  }
  const label = (ctx, s, x, y, color = C.text, align = "left") => {
    ctx.font = FONT; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = "alphabetic";
    ctx.fillText(s.toUpperCase(), x, y);
  };
  // italic math symbol with a subscript, e.g. sym(ctx, "r", "c", x, y)
  const sym = (ctx, base, subs, x, y, color, align = "left") => {
    ctx.fillStyle = color; ctx.textBaseline = "alphabetic";
    ctx.font = 'italic 16px "Instrument Serif", Georgia, serif';
    const wb = ctx.measureText(base).width;
    ctx.font = 'italic 11px "Instrument Serif", Georgia, serif';
    const ws = ctx.measureText(subs).width;
    let x0 = align === "right" ? x - wb - ws : x;
    ctx.font = 'italic 16px "Instrument Serif", Georgia, serif'; ctx.textAlign = "left"; ctx.fillText(base, x0, y);
    ctx.font = 'italic 11px "Instrument Serif", Georgia, serif'; ctx.fillText(subs, x0 + wb + 1, y + 4);
  };
  const dotAt = (ctx, x, y, r, color) => { ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.fillStyle = color; ctx.fill(); };
  // orbiting viewpoint; az = 0 sits between cams 2 and 3 so all four cameras stay in frame
  function viewCam(t, D = 21, tz = -1.8, az0 = -0.25) {
    const az = az0 + (reduce ? 0 : 0.2 * Math.sin(t * 0.15)), el = 0.32;
    return lookAt([D * Math.cos(az) * Math.cos(el), D * Math.sin(az) * Math.cos(el), D * Math.sin(el) + tz], [0, 0, tz]);
  }
  function toScreen(cam, P, w, h, F = 1.9) {
    const q = project(cam, P, F), s = Math.min(w, h) * 0.5;
    return { x: w / 2 + q.x * s, y: h / 2 + q.y * s, z: q.z };
  }
  function drawBox(ctx, cam, w, h) {
    const X = [XMIN, XMAX], Y = [-3, 3], Z = [-3, 3];
    const E = [];
    for (const y of Y) for (const z of Z) E.push([[X[0], y, z], [X[1], y, z]]);
    for (const x of X) for (const z of Z) E.push([[x, Y[0], z], [x, Y[1], z]]);
    for (const x of X) for (const y of Y) E.push([[x, y, Z[0]], [x, y, Z[1]]]);
    ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
    for (const [a, b] of E) {
      const A = toScreen(cam, a, w, h), B = toScreen(cam, b, w, h);
      ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
    }
  }
  function drawCamIcon(ctx, view, cam, w, h, i, active) {
    const s = toScreen(view, cam.eye, w, h);
    const ahead = toScreen(view, [cam.eye[0] + cam.f[0] * 1.6, cam.eye[1] + cam.f[1] * 1.6, cam.eye[2] + cam.f[2] * 1.6], w, h);
    ctx.strokeStyle = active ? C.cam : C.dim; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(ahead.x, ahead.y); ctx.stroke();
    ctx.fillStyle = active ? C.cam : C.dim;
    ctx.fillRect(s.x - 5, s.y - 4, 10, 8);
    label(ctx, "Cam " + (i + 1), s.x, s.y + 18, C.dim, "center");
  }

  // ---------- step renderers ----------
  const steps = {
    // 01 four camera views
    cams(ctx, w, h, t) {
      ctx.fillStyle = C.panel; ctx.fillRect(0, 0, w, h);
      const pad = 10, gw = (w - pad * 3) / 2, gh = (h - pad * 3) / 2;
      CAMS.forEach((cam, i) => {
        const ox = pad + (i % 2) * (gw + pad), oy = pad + Math.floor(i / 2) * (gh + pad);
        ctx.fillStyle = C.bg; ctx.fillRect(ox, oy, gw, gh);
        ctx.save(); ctx.beginPath(); ctx.rect(ox, oy, gw, gh); ctx.clip();
        const s = Math.min(gw, gh) * 0.5;
        for (const p of parts) {
          const P = pos(p, t), q = project(cam, P3(P), 2.2);
          const x = ox + gw / 2 + q.x * s, y = oy + gh / 2 + q.y * s;
          // a helium-filled soap bubble shows up as a pair of glare points
          const g = ctx.createRadialGradient(x, y, 0, x, y, 3.6);
          g.addColorStop(0, "rgba(242,240,234,.95)"); g.addColorStop(1, "rgba(242,240,234,0)");
          ctx.fillStyle = g; ctx.fillRect(x - 4, y - 4, 8, 8);
          dotAt(ctx, x + 2.4, y + 1.3, 0.9, "rgba(242,240,234,.85)");
        }
        ctx.restore();
        label(ctx, "Cam " + (i + 1), ox + 10, oy + 18, C.text);
        label(ctx, "f " + String(Math.floor(t * 900) % 100000).padStart(5, "0"), ox + gw - 10, oy + 18, C.dim, "right");
      });
    },

    // 02 match lines of sight across cameras -> 3D position
    match(ctx, w, h, t) {
      ctx.fillStyle = C.panel; ctx.fillRect(0, 0, w, h);
      const view = viewCam(t);
      drawBox(ctx, view, w, h);
      const pick = parts[Math.floor(t / 1.4) % N];
      const P = pos(pick, t), PP = P3(P);
      const S = toScreen(view, PP, w, h);
      CAMS.forEach((cam, i) => {
        const c = toScreen(view, cam.eye, w, h);
        ctx.strokeStyle = C.brassDim; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(S.x, S.y); ctx.stroke(); ctx.setLineDash([]);
        drawCamIcon(ctx, view, cam, w, h, i, true);
      });
      for (const p of parts) {
        if (p === pick) continue;
        const q = toScreen(view, P3(pos(p, t)), w, h);
        dotAt(ctx, q.x, q.y, 1.8, "rgba(242,240,234,.38)");
      }
      const pulse = 7 + 3 * Math.sin(t * 6);
      ctx.strokeStyle = C.brass; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(S.x, S.y, pulse, 0, 2 * Math.PI); ctx.stroke();
      dotAt(ctx, S.x, S.y, 3.2, C.brass);
      label(ctx, "4 lines of sight → 1 point", 14, 22, C.brass);
      label(ctx, `x ${P.x.toFixed(2)}  y ${P.y.toFixed(2)}  z ${P.z.toFixed(2)}`, w - 14, 22, C.text, "right");
    },

    // 03 link positions in time, stitch across gaps
    track(ctx, w, h, t) {
      ctx.fillStyle = C.panel; ctx.fillRect(0, 0, w, h);
      const view = viewCam(t, 12.5, 0, -0.9);
      drawBox(ctx, view, w, h);
      const STEPS = 40, DT = 0.05, PER = 4;
      for (const p of parts) {
        const pts = [];
        for (let k = STEPS; k >= 0; k--) {
          const tk = t - k * DT, P = pos(p, tk);
          const ph = ((tk / PER) % 1 + 1) % 1;
          const hidden = p.gap > 0 && ph > p.gap && ph < p.gap + 0.11;
          pts.push({ s: toScreen(view, P3(P), w, h), wraps: P.wraps, hidden, a: 1 - k / STEPS });
        }
        let last = null, bridgeFrom = null;
        for (let i = 0; i < pts.length; i++) {
          const q = pts[i];
          if (last && q.wraps !== last.wraps) { last = null; bridgeFrom = null; }
          if (q.hidden) { if (last) bridgeFrom = last; last = null; continue; }
          if (bridgeFrom) {
            ctx.strokeStyle = C.brass; ctx.lineWidth = 2; ctx.setLineDash([3, 3]);
            ctx.beginPath(); ctx.moveTo(bridgeFrom.s.x, bridgeFrom.s.y); ctx.lineTo(q.s.x, q.s.y); ctx.stroke();
            ctx.setLineDash([]); bridgeFrom = null;
          } else if (last) {
            ctx.strokeStyle = `rgba(242,240,234,${0.08 + 0.6 * q.a})`; ctx.lineWidth = 1.2;
            ctx.beginPath(); ctx.moveTo(last.s.x, last.s.y); ctx.lineTo(q.s.x, q.s.y); ctx.stroke();
          }
          last = q;
        }
        const head = pts[pts.length - 1];
        if (!head.hidden) dotAt(ctx, head.s.x, head.s.y, 2, C.bubble);
      }
      label(ctx, "Tracked", 14, 22, C.bubble);
      ctx.strokeStyle = C.brass; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(84, 18); ctx.lineTo(104, 18); ctx.stroke(); ctx.setLineDash([]);
      label(ctx, "Stitched across gaps", 110, 22, C.brass);
    },

    // 04 look down the vortex axis, recover core and swirl profile
    vortex(ctx, w, h, t) {
      ctx.fillStyle = C.panel; ctx.fillRect(0, 0, w, h);
      const narrow = w < 520;
      const aw = narrow ? w : w * 0.5, ah = narrow ? h * 0.55 : h;
      const cx = aw / 2, cy = ah / 2 + 6, s = Math.min(aw, ah) / 6.6;
      // cross-section: tracks seen end-on
      ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx - 3 * s, cy); ctx.lineTo(cx + 3 * s, cy); ctx.moveTo(cx, cy - 3 * s); ctx.lineTo(cx, cy + 3 * s); ctx.stroke();
      for (const p of parts) {
        ctx.strokeStyle = "rgba(242,240,234,.22)"; ctx.lineWidth = 1;
        const span = Math.min(2 * Math.PI, omega(p.r) * 1.6);
        const th = p.th0 + omega(p.r) * t;
        ctx.beginPath(); ctx.arc(cx, cy, p.r * s, th - span, th); ctx.stroke();
        dotAt(ctx, cx + p.r * s * Math.cos(th), cy + p.r * s * Math.sin(th), 1.8, C.bubble);
      }
      ctx.strokeStyle = C.brass; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.arc(cx, cy, RC * s * 1.12, 0, 2 * Math.PI); ctx.stroke(); ctx.setLineDash([]);
      ctx.strokeStyle = C.core; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(cx - 7, cy); ctx.lineTo(cx + 7, cy); ctx.moveTo(cx, cy - 7); ctx.lineTo(cx, cy + 7); ctx.stroke();
      label(ctx, "View along vortex axis", 14, 22, C.text);
      label(ctx, "Core", cx + 10, cy - 10, C.core);
      sym(ctx, "r", "c", cx + RC * s * 0.8 + 6, cy + RC * s * 0.8 + 16, C.brass);

      // swirl velocity profile
      const ox = narrow ? 40 : aw + 34, oy = narrow ? ah + 18 : 46;
      const pw = (narrow ? w : w - aw) - (narrow ? 60 : 64), ph = (narrow ? h - ah : h) - (narrow ? 54 : 94);
      const rmax = 3, vmax = GAMMA / (2 * Math.PI * RC) * 0.75;
      const X = r => ox + (r / rmax) * pw, Y = v => oy + ph - (v / vmax) * ph;
      ctx.strokeStyle = C.line; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ox, oy + ph); ctx.lineTo(ox + pw, oy + ph); ctx.stroke();
      ctx.strokeStyle = C.brass; ctx.lineWidth = 1.8; ctx.beginPath();
      for (let i = 1; i <= 80; i++) { const r = rmax * i / 80, v = omega(r) * r; i === 1 ? ctx.moveTo(X(r), Y(v)) : ctx.lineTo(X(r), Y(v)); }
      ctx.stroke();
      for (const [i, p] of parts.entries()) {
        const jitter = 0.09 * Math.sin(i * 12.9 + t * 1.3);
        dotAt(ctx, X(p.r), Y(omega(p.r) * p.r * (1 + jitter)), 2, "rgba(242,240,234,.8)");
      }
      ctx.strokeStyle = C.brassDim; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(X(RC * 1.12), oy); ctx.lineTo(X(RC * 1.12), oy + ph); ctx.stroke(); ctx.setLineDash([]);
      label(ctx, "Swirl velocity", ox, oy - 12, C.text);
      sym(ctx, "u", "θ", ox + ctx.measureText("SWIRL VELOCITY").width + 8, oy - 12, C.text);
      label(ctx, "Distance from core", ox + pw - 14, oy + ph + 18, C.dim, "right");
      sym(ctx, "r", "", ox + pw, oy + ph + 19, C.dim, "right");
      sym(ctx, "r", "c", X(RC * 1.12) + 6, oy + 14, C.brass);
      label(ctx, "Vortex model fit", ox + pw, oy + 14, C.brass, "right");
      if (!narrow) label(ctx, "→ core position, core radius, circulation", w - 14, h - 12, C.brass, "right");
    },
  };

  // ---------- run only what's on screen ----------
  const live = new Set();
  const canvases = [...root.querySelectorAll("canvas[data-step]")].map(cv => ({ cv, ctx: setup(cv), fn: steps[cv.dataset.step] }));
  const draw = (item, t) => item.fn(item.ctx, item.cv._w, item.cv._h, t);
  if (reduce) {
    const still = () => canvases.forEach(c => draw(c, 2.4));
    still(); window.addEventListener("resize", still);
    return;
  }
  const io = new IntersectionObserver(es => es.forEach(e => {
    const item = canvases.find(c => c.cv === e.target);
    e.isIntersecting ? live.add(item) : live.delete(item);
  }));
  canvases.forEach(c => { io.observe(c.cv); draw(c, 0); });
  const t0 = performance.now();
  (function loop(now) {
    const t = (now - t0) / 1000;
    live.forEach(c => draw(c, t));
    requestAnimationFrame(loop);
  })(t0);
})();
