// Schematic of the LPT processing chain: camera images -> triangulation -> tracks -> vortex.
// Synthetic flow: an upwind rotor sheds a helical tip vortex that is advected downstream at U
// through the measurement volume; bubbles near a core orbit it (Lamb-Oseen swirl) while being
// carried along, and every bubble also wanders incoherently with the atmospheric turbulence.
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
  const GAMMA = 12, RC = 0.8, U = 1.1, XMIN = -3.4, XMAX = 3.4, L = XMAX - XMIN, T = L / U;
  // Turbine placement follows the field geometry (4d-ptv settings: tower base (-7.07, -4.52) m,
  // hub 18 m up, 0.98 m overhang, R = 6.4 m; volume centre (-0.19, -0.14, 11.14) m, ground at
  // -1.62 m): the rotor is 7.9 m upstream of the volume centre, and the volume sits at the
  // lower blade tip, offset to the right of the hub when seen from behind the turbine (+y).
  // Drawn at SC units per metre, with the hub placed so the tip circle passes the volume centre.
  const RR = 4.6, SC = RR / 6.4;
  const GROUND = -12.76 * SC;
  const HDIR = Math.atan2(5.24, -4.38);                       // direction volume centre -> hub (y, z)
  const HY = RR * Math.cos(HDIR), HZ = RR * Math.sin(HDIR);  // hub, relative to the volume centre
  const XR = -7.86 * SC, XT = XR + 0.98 * SC;                // rotor apex, tower axis
  const ASTAR = HDIR - Math.PI;                              // blade angle at which the tip is at the centre
  // NV helix turns cross the volume at a time; a blade passes the volume every T / NV.
  const NV = 2, OMR = NV * (2 * Math.PI / 3) / T, HS = U / OMR;   // rotor speed, helix pitch / 2π
  // a point on the tip circle, arc-length s from the volume centre: [x shift, y, z, normal y, normal z]
  const coreAt = s => {
    const d = s / RR, a = ASTAR + d, ny = Math.cos(a), nz = Math.sin(a);
    return [-HS * d, HY + RR * ny, HZ + RR * nz, ny, nz];
  };
  const omega = r => GAMMA / (2 * Math.PI * r * r) * (1 - Math.exp(-r * r / (RC * RC)));
  let seed = 11;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const parts = [];
  for (let i = 0; i < 44; i++) {            // bubbles near the core: orbit it while advected
    const r = 0.35 + 1.9 * Math.sqrt(rand());
    parts.push({ near: true, core: i % NV, r, th0: rand() * 2 * Math.PI, y: -2.8 + 5.6 * rand() });
  }
  while (parts.length < 66) {               // bubbles far from the core: just advected
    const dx = (rand() - 0.5) * L, dz = (rand() - 0.5) * 5.6;
    if (Math.hypot(dx, dz) > 3) parts.push({ near: false, dx, dz, y: -2.8 + 5.6 * rand() });
  }
  // atmospheric turbulence: each bubble gets its own smooth random wander (a few modes with
  // random frequencies and phases), so it is correlated along a track but not between bubbles
  for (const p of parts) {
    p.turb = Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => ({
      a: (p.near ? 0.1 : 0.22) * (0.4 + rand()), f: 0.12 + 0.5 * rand(), ph: rand() * 2 * Math.PI,
    })));
  }
  const wander = (p, t) => p.turb.map(axis => axis.reduce((s, m) => s + m.a * Math.sin(2 * Math.PI * m.f * t + m.ph), 0));
  const coreX = (t, c = 0) => XMIN + ((U * t + c * L / NV) % L + L) % L;
  function pos(p, t) {
    const [ex, ey, ez] = wander(p, t);
    if (p.near) {   // p.y is the position along the core; orbit in the plane of x and the tip-circle normal
      const th = p.th0 + omega(p.r) * t, [ox, cy, cz, ny, nz] = coreAt(p.y), c = Math.cos(th), sn = Math.sin(th);
      return { x: coreX(t, p.core) + ox + p.r * c + ex, y: cy + p.r * sn * ny + ey, z: cz + p.r * sn * nz + ez,
               wraps: Math.floor((U * t + p.core * L / NV) / L) };
    }
    const x = XMIN + U * t + p.dx, wraps = Math.floor((x - XMIN) / L);
    return { x: x - wraps * L + ex, y: p.y + ey, z: p.dz + ez, wraps };
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
  // upwind turbine upstream of the volume (the volume sits in its wake); its blade tips shed the
  // helix, phased so each turn reaches the volume exactly where the bubbles' cores are
  const bladeAngle = t => ASTAR + OMR * (t + (XMIN - XR) / U);
  // Turbine mesh from the Blender setup model (assets/data/turbine-mesh.json, tower base at the origin,
  // real metres), scaled so its hub sits at the schematic hub and its rotor plane at XR; the blades
  // turn with bladeAngle so the helix leaves their tips. Falls back to the line drawing until loaded.
  let MESH = null;
  const MS = (HZ - GROUND) / 18, MHUB = [-1.32, 0, 18];      // mesh scale; hub centre in mesh coords
  const MBASE = [XR - MHUB[0] * MS, HY, GROUND];
  if (root.dataset.turbine) fetch(root.dataset.turbine).then(r => r.json()).then(m => {
    MESH = [];
    for (const p of m.parts) for (let i = 0; i < p.t.length; i += 3)
      MESH.push({ blade: p.name.startsWith("Blade"), v: [0, 1, 2].map(j => { const a = 3 * p.t[i + j]; return [p.v[a], p.v[a + 1], p.v[a + 2]]; }) });
  }).catch(() => {});
  const SUN = (() => { const v = [0.35, -0.45, 0.82], l = Math.hypot(...v); return v.map(x => x / l); })();
  function drawTurbineMesh(ctx, view, w, h, t, k) {
    const d = bladeAngle(t) - Math.PI / 2, cd = Math.cos(d), sd = Math.sin(d);
    const world = (P, blade) => {
      let y = P[1], z = P[2];
      if (blade) { const dy = y - MHUB[1], dz = z - MHUB[2]; y = MHUB[1] + dy * cd - dz * sd; z = MHUB[2] + dy * sd + dz * cd; }
      return [MBASE[0] + P[0] * MS, MBASE[1] + y * MS, MBASE[2] + z * MS];
    };
    const list = [];
    for (const tr of MESH) {
      const W = tr.v.map(P => world(P, tr.blade));
      const u = sub(W[1], W[0]), v = sub(W[2], W[0]), n = cross(u, v), l = Math.hypot(...n);
      if (!l) continue;
      const nn = [n[0] / l, n[1] / l, n[2] / l];
      let nv = -dot(nn, view.f), ns = dot(nn, SUN);
      if (nv < 0) { if (!tr.blade) continue; nv = -nv; ns = -ns; }
      const q = W.map(P => scr(view, P, w, h, k));
      list.push({ q, z: q[0].z + q[1].z + q[2].z, lum: 0.3 + 0.45 * Math.max(0, ns) + 0.2 * nv });
    }
    list.sort((a, b) => b.z - a.z);
    for (const o of list) {
      const c = Math.round(Math.min(1, o.lum) * 225), col = `rgb(${c},${c},${Math.round(c * 0.975)})`;
      ctx.fillStyle = col; ctx.strokeStyle = col; ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(o.q[0].x, o.q[0].y); ctx.lineTo(o.q[1].x, o.q[1].y); ctx.lineTo(o.q[2].x, o.q[2].y);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
  }
  function drawTurbine(ctx, view, w, h, t, k) {
    if (MESH) return drawTurbineMesh(ctx, view, w, h, t, k);
    ctx.strokeStyle = C.turbine; ctx.lineWidth = 2.2;
    seg(ctx, view, [XT, HY, GROUND], [XT, HY, HZ - 0.3], w, h, k);
    ctx.lineWidth = 3; seg(ctx, view, [XR, HY, HZ], [XT + 0.6, HY, HZ], w, h, k);   // nacelle points downstream
    const a0 = bladeAngle(t);
    ctx.fillStyle = C.turbine;
    for (let b = 0; b < 3; b++) {
      const a = a0 + b * 2 * Math.PI / 3, ca = Math.cos(a), sa = Math.sin(a);
      const pt = (r, off) => [XR, HY + r * ca - off * sa, HZ + r * sa + off * ca];   // upwind rotor
      const poly = [pt(0.3, 0.32), pt(RR, 0.08), pt(RR, -0.04), pt(0.3, -0.18)].map(P => scr(view, P, w, h, k));
      ctx.beginPath(); poly.forEach((q, i) => i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)); ctx.closePath(); ctx.fill();
    }
    const c = scr(view, [XR - 0.05, HY, HZ], w, h, k);
    dotAt(ctx, c.x, c.y, 3, C.cam);
  }
  // the three tip-vortex helices, from the blade tips downstream to the end of the volume
  function drawHelix(ctx, view, w, h, t, k, color, width) {
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineJoin = "round";
    const age = (XMAX + 0.5 - XR) / U;
    for (let b = 0; b < 3; b++) {
      ctx.beginPath();
      for (let s = 0, i = 0; s <= age; s += age / 260, i++) {
        const a = bladeAngle(t - s) + b * 2 * Math.PI / 3;
        const q = scr(view, [XR + U * s, HY + RR * Math.cos(a), HZ + RR * Math.sin(a)], w, h, k);
        i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y);
      }
      ctx.stroke();
    }
  }

  // steps 02 and 03 share one wide view: rotor, helix and the volume in its wake
  // seen from behind the turbine and to its right
  const K_WIDE = 1.75, VIEW_WIDE = orbit(0.62, 0.52, 34, [-2.6, -1.2, -2.4]);

  // fixed legend for the helix, top right
  // (drops to a second line when the panel title leaves no room)
  function vortexKey(ctx, w, title) {
    ctx.font = FONT;
    const tw = ctx.measureText("TIP VORTEX").width, y = 14 + ctx.measureText(title.toUpperCase()).width + 24 + tw + 26 > w - 14 ? 40 : 22;
    ctx.strokeStyle = C.core; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(w - 14 - tw - 26, y - 4); ctx.lineTo(w - 14 - tw - 8, y - 4); ctx.stroke();
    label(ctx, "Tip vortex", w - 14, y, C.core, "right");
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
      const k = K_WIDE, view = VIEW_WIDE;
      drawGround(ctx, view, w, h, k);
      drawHelix(ctx, view, w, h, t, k, C.coreDim, 1.8);
      drawTurbine(ctx, view, w, h, t, k);
      drawBox(ctx, view, w, h, k);
      const cyc = Math.floor(U * t / L), t0 = cyc * T;
      const pool = parts.filter(p => p.near && p.core === 0 && p.r > 0.7 && p.r < 1.8);
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
      const tb = scr(view, MESH ? MBASE : [XT, HY, GROUND], w, h, k);
      label(ctx, "Turbine", tb.x, tb.y + 18, C.dim, "center");
      label(ctx, "4 lines of sight → 1 point, every frame", 14, 22, C.brass);
      vortexKey(ctx, w, "4 lines of sight → 1 point, every frame");
      label(ctx, `x ${P.x.toFixed(2)}  y ${P.y.toFixed(2)}  z ${P.z.toFixed(2)}`, 14, h - 14, C.text);
    },

    // 03 link positions frame to frame into Lagrangian tracks
    track(ctx, w, h, t) {
      ctx.fillStyle = C.panel; ctx.fillRect(0, 0, w, h);
      // same viewing angle as step 02, a bit closer to the volume
      const k = K_WIDE, view = orbit(0.62, 0.52, 22, [-2.2, -1, -0.6]);
      drawGround(ctx, view, w, h, k);
      drawHelix(ctx, view, w, h, t, k, C.coreDim, 1.8);
      drawTurbine(ctx, view, w, h, t, k);
      drawBox(ctx, view, w, h, k);
      const STEPS = 90, DT = 0.05;
      for (const p of parts) {
        let last = null;
        for (let j = STEPS; j >= 0; j--) {
          const P = pos(p, t - j * DT), q = scr(view, P3(P), w, h, k);
          if (last && last.wraps === P.wraps) {
            ctx.strokeStyle = `rgba(242,240,234,${0.06 + 0.6 * (1 - j / STEPS)})`; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(q.x, q.y); ctx.stroke();
          }
          last = { x: q.x, y: q.y, wraps: P.wraps };
        }
        dotAt(ctx, last.x, last.y, 1.6, C.bubble);
      }
      label(ctx, "Lagrangian tracks", 14, 22, C.bubble);
      vortexKey(ctx, w, "Lagrangian tracks");
    },

    // 04 the same instant in two views: 3D (lab frame) and along the vortex axis (moving with the core)
    vortex(ctx, w, h, t) {
      ctx.fillStyle = C.panel; ctx.fillRect(0, 0, w, h);
      const CYC = 14, tc = ((t % CYC) + CYC) % CYC;
      const UV = 7 / CYC, xv = -3.5 + UV * tc;                 // vortex crosses the volume once per cycle
      const fade = Math.min(1, tc / 0.6, (CYC - tc) / 0.6);
      const stacked = w < 560;
      const A = stacked ? { x: 0, y: 0, w, h: h / 2 } : { x: 0, y: 0, w: w / 2, h };
      const B = stacked ? { x: 0, y: h / 2, w, h: h / 2 } : { x: w / 2, y: 0, w: w / 2, h };
      const bubbles = [
        { r: 0.95, th0: 0.4, y: -0.7, col: C.brass, dot: C.brass },
        { r: 1.6, th0: 2.6, y: 0.9, col: "rgba(242,240,234,.75)", dot: C.bubble },
      ];
      const at = (p, s, frame) => {   // frame 0: lab, 1: moving with the core
        const th = p.th0 + omega(p.r) * s * 0.55, x = -3.5 + UV * s;
        return [x - frame * (x - xv) + p.r * Math.cos(th), p.y, p.r * Math.sin(th)];
      };
      const panel = (vp, view, frame, k) => {
        ctx.save(); ctx.translate(vp.x, vp.y); ctx.beginPath(); ctx.rect(0, 0, vp.w, vp.h); ctx.clip();
        ctx.globalAlpha = fade;
        if (!frame) drawBox(ctx, view, vp.w, vp.h, k);
        ctx.strokeStyle = "rgba(196,84,74,.18)"; ctx.lineWidth = 12; ctx.lineCap = "round";
        seg(ctx, view, [xv, -3, 0], [xv, 3, 0], vp.w, vp.h, k);
        ctx.strokeStyle = C.core; ctx.lineWidth = 3;
        seg(ctx, view, [xv, -3, 0], [xv, 3, 0], vp.w, vp.h, k); ctx.lineCap = "butt";
        for (const p of bubbles) {
          ctx.strokeStyle = p.col; ctx.lineWidth = 1.6; ctx.beginPath();
          for (let s = Math.max(0, tc - 6), i = 0; s <= tc; s += 0.03, i++) {
            const q = scr(view, at(p, s, frame), vp.w, vp.h, k);
            i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y);
          }
          ctx.stroke();
          const q = scr(view, at(p, tc, frame), vp.w, vp.h, k);
          dotAt(ctx, q.x, q.y, 4, p.dot);
        }
        if (frame) {
          const c = scr(view, [xv, 0, 0], vp.w, vp.h, k);
          ctx.strokeStyle = C.brassDim; ctx.lineWidth = 1; ctx.setLineDash([4, 4]); ctx.beginPath();
          for (let i = 0; i <= 64; i++) {
            const a = 2 * Math.PI * i / 64, q = scr(view, [xv + RC * Math.cos(a), 0, RC * Math.sin(a)], vp.w, vp.h, k);
            i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y);
          }
          ctx.stroke(); ctx.setLineDash([]);
          const e = scr(view, [xv + RC * 0.75, 0, -RC * 0.75], vp.w, vp.h, k);
          sym(ctx, "r", "c", e.x + 6, e.y + 14, C.brass);
          label(ctx, "Core", c.x + 12, c.y - 10, C.core);
        }
        ctx.globalAlpha = 1;
        label(ctx, frame ? "Along the vortex axis" : "3D view", 14, 22, C.text);
        if (!frame) label(ctx, "Flow →", vp.w - 14, vp.h - 14, C.dim, "right");
        else label(ctx, "Moving with the core", vp.w - 14, vp.h - 14, C.dim, "right");
        ctx.restore();
      };
      panel(A, orbit(-Math.PI / 2 + 0.75, 0.42, stacked ? 11.5 : 9, [0, 0, 0]), 0, 1.9);
      panel(B, orbit(-Math.PI / 2, 0, 5.6, [xv, 0, 0]), 1, 1.9);
      ctx.strokeStyle = C.grid; ctx.lineWidth = 1; ctx.beginPath();
      stacked ? (ctx.moveTo(14, h / 2), ctx.lineTo(w - 14, h / 2)) : (ctx.moveTo(w / 2, 14), ctx.lineTo(w / 2, h - 14));
      ctx.stroke();
    },
  };

  // ---------- run only what's on screen ----------
  const live = new Set();
  const canvases = [...root.querySelectorAll("canvas[data-step]")].map(cv => ({ cv, ctx: setup(cv), fn: steps[cv.dataset.step] }));
  const draw = (item, t) => item.fn(item.ctx, item.cv._w, item.cv._h, t);
  if (reduce) {
    const still = () => canvases.forEach(c => draw(c, c.cv.dataset.step === "vortex" ? 7 : 5));
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
    const t = Math.max(0, (now - t0) / 1000);
    live.forEach(c => draw(c, t));
    requestAnimationFrame(loop);
  })(t0);
})();
