// Schematic of the LPT processing chain: camera images -> triangulation -> tracks -> vortex.
// Synthetic flow: an idealized tip-vortex line (along y) shed by an upstream rotor is advected
// downstream at U; bubbles near it orbit the core (Lamb-Oseen swirl) while being carried along.
(() => {
  const root = document.getElementById("pipeline");
  if (!root) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const C = {
    bg: "#111413", panel: "#171a18", grid: "rgba(236,235,229,.07)", ground: "rgba(236,235,229,.05)",
    text: "#a9aeaa", dim: "rgba(236,235,229,.35)", bubble: "#f2f0ea", brass: "#c9a86b",
    brassDim: "rgba(201,168,107,.38)", core: "#c4544a", coreDim: "rgba(196,84,74,.45)",
    cam: "#d9d8d2", turbine: "rgba(236,235,229,.62)",
  };
  const FONT = '600 11px Inter, system-ui, sans-serif';

  // ---------- synthetic flow ----------
  const GAMMA = 12, RC = 0.8, U = 1.1, XMIN = -4.5, XMAX = 4.5, L = XMAX - XMIN, T = L / U;
  const GROUND = -6;
  const omega = r => GAMMA / (2 * Math.PI * r * r) * (1 - Math.exp(-r * r / (RC * RC)));
  let seed = 11;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const parts = [];
  for (let i = 0; i < 44; i++) {            // bubbles near the core: orbit it while advected
    const r = 0.35 + 2.6 * Math.sqrt(rand());
    parts.push({ near: true, r, th0: rand() * 2 * Math.PI, y: -2.8 + 5.6 * rand() });
  }
  while (parts.length < 66) {               // bubbles far from the core: just advected
    const dx = (rand() - 0.5) * L, dz = (rand() - 0.5) * 5.6;
    if (Math.hypot(dx, dz) > 3) parts.push({ near: false, dx, dz, y: -2.8 + 5.6 * rand() });
  }
  const coreX = t => XMIN + ((U * t) % L + L) % L;
  function pos(p, t) {
    if (p.near) {
      const th = p.th0 + omega(p.r) * t;
      return { x: coreX(t) + p.r * Math.cos(th), y: p.y, z: p.r * Math.sin(th), wraps: Math.floor(U * t / L) };
    }
    const x = XMIN + U * t + p.dx, wraps = Math.floor((x - XMIN) / L);
    return { x: x - wraps * L, y: p.y, z: p.dz, wraps };
  }
  const P3 = p => [p.x, p.y, p.z];

  // ---------- camera math ----------
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = a => { const l = Math.hypot(...a); return [a[0] / l, a[1] / l, a[2] / l]; };
  const lerp = (a, b, f) => a + (b - a) * f;
  const smooth = f => f * f * (3 - 2 * f);
  function lookAt(eye, target) {
    const f = norm(sub(target, eye));
    const r = norm(cross(f, [0, 0, 1]));
    return { eye, f, r, u: cross(r, f) };
  }
  function orbit(az, el, D, tg) {
    return lookAt([tg[0] + D * Math.cos(az) * Math.cos(el), tg[1] + D * Math.sin(az) * Math.cos(el), tg[2] + D * Math.sin(el)], tg);
  }
  function project(cam, P, F) {
    const d = sub(P, cam.eye), zc = dot(d, cam.f);
    return { x: F * dot(d, cam.r) / zc, y: -F * dot(d, cam.u) / zc, z: zc };
  }
  // four cameras on the ground around the volume, looking up into it (like the field setup)
  const CAMS = [[-7, -7, GROUND], [7, -7, GROUND], [7, 7, GROUND], [-7, 7, GROUND]].map(e => lookAt(e, [0, 0, 0]));

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
  const sym = (ctx, base, subs, x, y, color) => {
    ctx.fillStyle = color; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    ctx.font = 'italic 16px "Instrument Serif", Georgia, serif'; ctx.fillText(base, x, y);
    const wb = ctx.measureText(base).width;
    ctx.font = 'italic 11px "Instrument Serif", Georgia, serif'; ctx.fillText(subs, x + wb + 1, y + 4);
  };
  const dotAt = (ctx, x, y, r, color) => { ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.fillStyle = color; ctx.fill(); };
  const scr = (cam, P, w, h, k = 1.9) => {
    const q = project(cam, P, k), s = Math.min(w, h) * 0.5;
    return { x: w / 2 + q.x * s, y: h / 2 + q.y * s, z: q.z };
  };
  function seg(ctx, cam, a, b, w, h, k) {
    const A = scr(cam, a, w, h, k), B = scr(cam, b, w, h, k);
    ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
  }
  function drawBox(ctx, cam, w, h, k) {
    const X = [XMIN, XMAX], Y = [-3, 3], Z = [-3, 3];
    ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
    for (const y of Y) for (const z of Z) seg(ctx, cam, [X[0], y, z], [X[1], y, z], w, h, k);
    for (const x of X) for (const z of Z) seg(ctx, cam, [x, Y[0], z], [x, Y[1], z], w, h, k);
    for (const x of X) for (const y of Y) seg(ctx, cam, [x, y, Z[0]], [x, y, Z[1]], w, h, k);
  }
  function drawGround(ctx, cam, w, h, k) {
    ctx.strokeStyle = C.ground; ctx.lineWidth = 1;
    for (let x = -14; x <= 10; x += 2) seg(ctx, cam, [x, -9, GROUND], [x, 9, GROUND], w, h, k);
    for (let y = -9; y <= 9; y += 2) seg(ctx, cam, [-14, y, GROUND], [10, y, GROUND], w, h, k);
  }
  function drawCam(ctx, view, cam, w, h, i, k) {
    const s = scr(view, cam.eye, w, h, k);
    const a = scr(view, [cam.eye[0] + cam.f[0] * 1.8, cam.eye[1] + cam.f[1] * 1.8, cam.eye[2] + cam.f[2] * 1.8], w, h, k);
    ctx.strokeStyle = C.cam; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(a.x, a.y); ctx.stroke();
    ctx.fillStyle = C.cam; ctx.fillRect(s.x - 5, s.y - 4, 10, 8);
    label(ctx, "Cam " + (i + 1), s.x, s.y + 18, C.dim, "center");
  }
  // upstream rotor; one blade passes the bottom (where the vortex line sits) every T,
  // so it sheds the vortex that is then advected into the volume
  const XT = XMIN - 5, RR = 4.6;
  function drawTurbine(ctx, view, w, h, t, k) {
    ctx.strokeStyle = C.turbine; ctx.lineWidth = 2.2;
    seg(ctx, view, [XT, 0, GROUND], [XT, 0, RR - 0.3], w, h, k);
    ctx.lineWidth = 3; seg(ctx, view, [XT - 1.1, 0, RR], [XT + 0.5, 0, RR], w, h, k);
    const a0 = -Math.PI / 2 + (2 * Math.PI / 3) * ((t + (XMIN - XT) / U) / T);
    ctx.fillStyle = C.turbine;
    for (let b = 0; b < 3; b++) {
      const a = a0 + b * 2 * Math.PI / 3, ca = Math.cos(a), sa = Math.sin(a);
      const pt = (r, off) => [XT + 0.5, r * ca - off * sa, RR + r * sa + off * ca];
      const poly = [pt(0.3, 0.32), pt(RR, 0.08), pt(RR, -0.04), pt(0.3, -0.18)].map(P => scr(view, P, w, h, k));
      ctx.beginPath(); poly.forEach((q, i) => i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)); ctx.closePath(); ctx.fill();
    }
    const c = scr(view, [XT + 0.55, 0, RR], w, h, k);
    dotAt(ctx, c.x, c.y, 3, C.cam);
  }
  function drawVortexLine(ctx, view, w, h, t, k, color, width) {
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = "round";
    const x = coreX(t);
    seg(ctx, view, [x, -3, 0], [x, 3, 0], w, h, k);
    ctx.lineCap = "butt";
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
          const q = project(cam, P3(pos(p, t)), 2.2);
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

    // 02 follow one bubble through the volume; four lines of sight meet at it every frame
    match(ctx, w, h, t) {
      ctx.fillStyle = C.panel; ctx.fillRect(0, 0, w, h);
      const k = 1.75, view = orbit(-Math.PI / 2 + 0.42, 0.24, 25, [-2.6, 0, -0.4]);
      drawGround(ctx, view, w, h, k);
      drawTurbine(ctx, view, w, h, t, k);
      drawBox(ctx, view, w, h, k);
      drawVortexLine(ctx, view, w, h, t, k, C.coreDim, 2);
      const cyc = Math.floor(U * t / L), t0 = cyc * T;
      const pool = parts.filter(p => p.near && p.r > 0.7 && p.r < 1.8);
      const pick = pool[cyc % pool.length];
      for (const p of parts) {
        if (p === pick) continue;
        const q = scr(view, P3(pos(p, t)), w, h, k);
        dotAt(ctx, q.x, q.y, 1.6, "rgba(242,240,234,.32)");
      }
      // trail since the bubble entered with this vortex
      ctx.strokeStyle = C.brass; ctx.lineWidth = 1.6; ctx.beginPath();
      for (let tk = t0, i = 0; tk <= t; tk += 0.04, i++) {
        const q = scr(view, P3(pos(pick, tk)), w, h, k);
        i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y);
      }
      ctx.stroke();
      const P = pos(pick, t), S = scr(view, P3(P), w, h, k);
      CAMS.forEach((cam, i) => {
        const c = scr(view, cam.eye, w, h, k);
        ctx.strokeStyle = C.brassDim; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(S.x, S.y); ctx.stroke(); ctx.setLineDash([]);
        drawCam(ctx, view, cam, w, h, i, k);
      });
      ctx.strokeStyle = C.brass; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(S.x, S.y, 7 + 2.5 * Math.sin(t * 6), 0, 2 * Math.PI); ctx.stroke();
      dotAt(ctx, S.x, S.y, 3.2, C.brass);
      const tb = scr(view, [XT, 0, GROUND], w, h, k);
      label(ctx, "Turbine", tb.x, tb.y + 18, C.dim, "center");
      label(ctx, "4 lines of sight → 1 point, every frame", 14, 22, C.brass);
      label(ctx, `x ${P.x.toFixed(2)}  y ${P.y.toFixed(2)}  z ${P.z.toFixed(2)}`, 14, h - 14, C.text);
    },

    // 03 link positions frame to frame into Lagrangian tracks
    track(ctx, w, h, t) {
      ctx.fillStyle = C.panel; ctx.fillRect(0, 0, w, h);
      const k = 1.9, view = orbit(-Math.PI / 2 + 0.36, 0.22, 13.5, [0, 0, 0]);
      drawBox(ctx, view, w, h, k);
      drawVortexLine(ctx, view, w, h, t, k, C.coreDim, 2);
      const STEPS = 90, DT = 0.05;
      for (const p of parts) {
        let last = null;
        for (let j = STEPS; j >= 0; j--) {
          const P = pos(p, t - j * DT), q = scr(view, P3(P), w, h, k);
          if (last && last.wraps === P.wraps) {
            ctx.strokeStyle = `rgba(242,240,234,${0.06 + 0.6 * (1 - j / STEPS)})`; ctx.lineWidth = 1.2;
            ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(q.x, q.y); ctx.stroke();
          }
          last = { x: q.x, y: q.y, wraps: P.wraps };
        }
        dotAt(ctx, last.x, last.y, 2, C.bubble);
      }
      label(ctx, "Lagrangian tracks", 14, 22, C.bubble);
      const vx = scr(view, [coreX(t), -3, 0], w, h, k);
      label(ctx, "Tip vortex", vx.x + 8, vx.y + 4, C.core);
    },

    // 04 idealized vortex line advected downstream, then the view along its axis
    vortex(ctx, w, h, t) {
      ctx.fillStyle = C.panel; ctx.fillRect(0, 0, w, h);
      const CYC = 14, tc = ((t % CYC) + CYC) % CYC;
      // 0-4.5 s 3D view, 4.5-6.5 s swing round, 6.5-12 s along the axis, 12-14 s swing back
      const b = tc < 4.5 ? 0 : tc < 6.5 ? smooth((tc - 4.5) / 2) : tc < 12 ? 1 : smooth(1 - (tc - 12) / 2);
      const UV = 7 / CYC, xv = -3.5 + UV * tc;                      // vortex crosses the volume once per cycle
      const fade = Math.min(1, tc / 0.6, (CYC - tc) / 0.6);
      const az = lerp(-Math.PI / 2 + 0.75, -Math.PI / 2, b), el = lerp(0.42, 0, b), D = lerp(11, 5.8, b);
      const k = 1.9, view = orbit(az, el, D, [lerp(0, xv, b), 0, 0]);
      const bubbles = [{ r: 0.95, th0: 0.4, y: -0.7 }, { r: 1.6, th0: 2.6, y: 0.9 }];
      const at = (p, s) => {               // position at time s; trail drawn in the core's frame as b -> 1
        const th = p.th0 + omega(p.r) * s * 0.55, x = -3.5 + UV * s;
        return [x - b * (x - xv) + p.r * Math.cos(th), p.y, p.r * Math.sin(th)];
      };
      ctx.globalAlpha = fade * (1 - b); drawBox(ctx, view, w, h, k); ctx.globalAlpha = fade;
      // vortex line: a glowing tube in 3D, a point when seen end-on
      ctx.strokeStyle = "rgba(196,84,74,.18)"; ctx.lineWidth = 12; ctx.lineCap = "round";
      seg(ctx, view, [xv, -3, 0], [xv, 3, 0], w, h, k);
      ctx.strokeStyle = C.core; ctx.lineWidth = 3;
      seg(ctx, view, [xv, -3, 0], [xv, 3, 0], w, h, k); ctx.lineCap = "butt";
      for (const p of bubbles) {
        ctx.strokeStyle = C.brass; ctx.lineWidth = 1.6; ctx.beginPath();
        const s0 = Math.max(0, tc - 6);
        for (let s = s0, i = 0; s <= tc; s += 0.03, i++) {
          const q = scr(view, at(p, s), w, h, k);
          i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y);
        }
        ctx.stroke();
        const q = scr(view, at(p, tc), w, h, k);
        dotAt(ctx, q.x, q.y, 4, C.bubble);
      }
      // end-on annotations
      if (b > 0.02) {
        ctx.globalAlpha = fade * b;
        const c = scr(view, [xv, 0, 0], w, h, k);
        ctx.strokeStyle = C.brass; ctx.lineWidth = 1; ctx.setLineDash([4, 4]); ctx.beginPath();
        for (let i = 0; i <= 64; i++) {
          const a = 2 * Math.PI * i / 64, q = scr(view, [xv + RC * Math.cos(a), 0, RC * Math.sin(a)], w, h, k);
          i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y);
        }
        ctx.stroke(); ctx.setLineDash([]);
        const e = scr(view, [xv + RC * 0.75, 0, -RC * 0.75], w, h, k);
        sym(ctx, "r", "c", e.x + 6, e.y + 14, C.brass);
        label(ctx, "Core", c.x + 12, c.y - 10, C.core);
        label(ctx, "View along vortex axis", 14, 22, C.text);
        ctx.globalAlpha = fade;
      }
      if (b < 0.98) {
        ctx.globalAlpha = fade * (1 - b);
        label(ctx, "Idealized vortex line, advected downstream", 14, 22, C.text);
        label(ctx, "Flow →", w - 14, h - 14, C.dim, "right");
      }
      ctx.globalAlpha = 1;
    },
  };

  // ---------- run only what's on screen ----------
  const live = new Set();
  const canvases = [...root.querySelectorAll("canvas[data-step]")].map(cv => ({ cv, ctx: setup(cv), fn: steps[cv.dataset.step] }));
  const draw = (item, t) => item.fn(item.ctx, item.cv._w, item.cv._h, t);
  if (reduce) {
    const still = () => canvases.forEach(c => draw(c, c.cv.dataset.step === "vortex" ? 9 : 5));
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
