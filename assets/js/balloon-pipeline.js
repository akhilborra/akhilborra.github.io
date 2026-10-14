// Schematic of the balloon measurement chain: release -> drift & measure -> telemetry -> profiles & stability.
// Synthetic, illustrative motion only (no measured values are shown).
(() => {
  const root = document.getElementById("bp");
  if (!root) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const C = {
    sky0: "#141917", sky1: "#111413", ground: "#1f2622", ridge: "#28302b", line: "rgba(236,235,229,.22)",
    grid: "rgba(236,235,229,.07)", text: "#a9aeaa", dim: "rgba(236,235,229,.38)", ink: "#ecebe5",
    brass: "#c9a86b", red: "#c4544a", A: "#ED7D31", B: "#5B9BD5", Cc: "#70AD47", wake: "rgba(236,235,229,.05)",
  };
  const FONT = "600 10.5px Inter, system-ui, sans-serif";
  const label = (ctx, s, x, y, col = C.text, align = "left") => { ctx.font = FONT; ctx.fillStyle = col; ctx.textAlign = align; ctx.fillText(s.toUpperCase(), x, y); };
  const dot = (ctx, x, y, r, col) => { ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fillStyle = col; ctx.fill(); };

  function setup(cv) {
    const ctx = cv.getContext("2d");
    const fit = () => { const dpr = Math.min(devicePixelRatio || 1, 2); cv.width = cv.clientWidth * dpr; cv.height = cv.clientHeight * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); cv._w = cv.clientWidth; cv._h = cv.clientHeight; };
    fit(); new ResizeObserver(() => { fit(); cv._redraw && cv._redraw(); }).observe(cv); return ctx;
  }
  function backdrop(ctx, w, h, gy) {
    const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, C.sky0); g.addColorStop(1, C.sky1);
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = C.ridge; ctx.beginPath(); ctx.moveTo(0, gy);
    for (let x = 0; x <= w; x += 8) ctx.lineTo(x, gy - 10 - 8 * Math.sin(x / 70) - 5 * Math.sin(x / 23));
    ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.fill();
    ctx.fillStyle = C.ground; ctx.fillRect(0, gy, w, h - gy);
  }
  function turbine(ctx, x, gy, H, t, s = 1) {
    ctx.strokeStyle = "rgba(236,235,229,.75)"; ctx.lineWidth = 2 * s;
    ctx.beginPath(); ctx.moveTo(x, gy); ctx.lineTo(x, gy - H); ctx.stroke();
    ctx.lineWidth = 1.6 * s;
    for (let k = 0; k < 3; k++) { const a = t * 2.2 + k * 2.094; ctx.beginPath(); ctx.moveTo(x, gy - H); ctx.lineTo(x + Math.cos(a) * H * 0.42, gy - H + Math.sin(a) * H * 0.42); ctx.stroke(); }
    dot(ctx, x, gy - H, 2.2 * s, "#ecebe5");
  }
  // One tracer: a red balloon with its own radiosonde hanging below it on a short string. (x, y) is the balloon centre.
  function balloon(ctx, x, y, s = 1) {
    const r = 6 * s;
    ctx.strokeStyle = C.dim; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y + r); ctx.lineTo(x, y + r + 7 * s); ctx.stroke();
    ctx.fillStyle = "#ecebe5"; ctx.fillRect(x - 2.5 * s, y + r + 7 * s, 5 * s, 4 * s);
    const g = ctx.createRadialGradient(x - r * .35, y - r * .4, 0.5, x, y, r);
    g.addColorStop(0, "#ffd2cc"); g.addColorStop(.3, "#d9453a"); g.addColorStop(1, "#9e2b23");
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fillStyle = g; ctx.fill();
  }
  // Launch hub (part of the release payload, not the tracer): a white half-dome with four horizontal
  // carbon-fibre rods, seen slightly from the side. Returns the rod-tip positions, back to front.
  function hubTips(x, y, t, s = 1) {
    const Lr = 24 * s, rot = 0.39 + 0.08 * Math.sin(t * 0.5);
    return [0, 1, 2, 3].map(k => { const a = rot + k * Math.PI / 2; return { x: x + Math.cos(a) * Lr, y: y + Math.sin(a) * Lr * 0.3, z: Math.sin(a) }; }).sort((p, q) => p.z - q.z);
  }
  function hub(ctx, x, y, tips, heat, s = 1) {
    const R = 7 * s;
    ctx.strokeStyle = "#3a3f3b"; ctx.lineWidth = 1.8 * s; ctx.lineCap = "round";
    tips.forEach(p => { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(p.x, p.y); ctx.stroke(); });
    ctx.strokeStyle = "rgba(236,235,229,.28)"; ctx.lineWidth = 0.7 * s;
    tips.forEach(p => { ctx.beginPath(); ctx.moveTo(x, y - 0.6 * s); ctx.lineTo(p.x, p.y - 0.6 * s); ctx.stroke(); });
    ctx.lineCap = "butt";
    // dome: flat base at y, rounded top
    ctx.beginPath(); ctx.arc(x, y, R, Math.PI, 0); ctx.closePath(); ctx.fillStyle = "#e4e3dd"; ctx.fill();
    ctx.strokeStyle = "#a9aeaa"; ctx.lineWidth = 1; ctx.stroke();
    // burn wires inside the dome, glowing warm orange while heated
    if (heat > 0) {
      const G = 4 + 10 * heat, g = ctx.createRadialGradient(x, y - R * 0.4, 0, x, y - R * 0.4, G);
      g.addColorStop(0, `rgba(255,190,110,${0.95 * heat})`); g.addColorStop(0.45, `rgba(237,125,49,${0.5 * heat})`); g.addColorStop(1, "rgba(237,125,49,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y - R * 0.4, G, 0, 7); ctx.fill();
    }
    ctx.strokeStyle = heat > 0 ? `rgba(255,${Math.round(150 + 60 * heat)},90,${0.6 + 0.4 * heat})` : "rgba(201,168,107,.8)";
    ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(x - 3 * s, y - R * 0.4); ctx.lineTo(x + 3 * s, y - R * 0.4); ctx.stroke();
  }
  function drone(ctx, x, y, t) {
    ctx.strokeStyle = "#d9d8d2"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x - 18, y); ctx.lineTo(x + 18, y); ctx.stroke();
    ctx.fillStyle = "#d9d8d2"; ctx.fillRect(x - 6, y - 3, 12, 6);
    for (const dx of [-18, 18]) { const s = Math.abs(Math.sin(t * 40 + dx)) * 9 + 3; ctx.beginPath(); ctx.moveTo(x + dx - s, y - 4); ctx.lineTo(x + dx + s, y - 4); ctx.stroke(); }
  }

  const steps = {
    // 01 heated-wire release: the drone carries the launch hub (half-dome + four carbon-fibre rods) on four
    // strings; a balloon with its own radiosonde hangs from each rod tip, its string running through the rod
    // into the dome. At release height the wires inside the dome burn all four strings at once and the four
    // balloons drift off downwind as individual tracers; the hub stays under the drone.
    release(ctx, w, h, t) {
      const gy = h * 0.82; backdrop(ctx, w, h, gy);
      turbine(ctx, w * 0.70, gy, h * 0.42, t); turbine(ctx, w * 0.86, gy, h * 0.42, t + 1);
      const P = 8, ph = (t % P) / P;
      const ease = f => (f < 0.5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2);
      const x0 = w * 0.16, yRel = gy - h * 0.62, yLow = gy - 96, L = 26, hang = 8;
      const sway = 3 * Math.sin(t * 1.3);
      // drone altitude: climb, hover for heating/release, descend; fade in/out so the cycle loops cleanly
      let dy = ph < 0.3 ? yLow + (yRel - yLow) * ease(ph / 0.3) : ph < 0.7 ? yRel : yRel + (yLow - yRel) * ease(Math.min(1, (ph - 0.7) / 0.25));
      dy += sway;
      const droneA = ph < 0.06 ? ph / 0.06 : ph > 0.9 ? Math.max(0, (1 - ph) / 0.1) : 1;
      const TC = 0.48, cut = ph >= TC;
      const heat = ph < 0.3 ? 0 : ph < TC ? (ph - 0.3) / (TC - 0.3) : Math.max(0, 1 - (ph - TC) / 0.14);
      const hx = x0 + 1.2 * Math.sin(t * 1.1), hy = dy + 6 + L;
      const tips = hubTips(hx, hy, cut ? (TC * P) : t);
      // release-height marker
      ctx.strokeStyle = "rgba(201,168,107,.45)"; ctx.lineWidth = 1; ctx.setLineDash([2, 4]);
      ctx.beginPath(); ctx.moveTo(x0 + 34, yRel + 6); ctx.lineTo(w * 0.6, yRel + 6); ctx.stroke(); ctx.setLineDash([]);
      label(ctx, "Release height", x0 + 40, yRel, C.brass);
      ctx.globalAlpha = droneA;
      // four thick strings from the drone down to the dome
      ctx.strokeStyle = "rgba(236,235,229,.6)"; ctx.lineWidth = 1.4; ctx.beginPath();
      [-9, -3, 3, 9].forEach(a => { ctx.moveTo(x0 + a * 0.8, dy + 5); ctx.lineTo(hx + a * 0.35, hy - 6.5); }); ctx.stroke();
      ctx.globalAlpha = 1;
      if (!cut) {
        // balloons hang from the rod tips, each with its radiosonde below
        ctx.globalAlpha = droneA;
        const back = tips.filter(p => p.z < 0), front = tips.filter(p => p.z >= 0);
        const hangOne = p => { const by = p.y + hang + 6; ctx.strokeStyle = C.dim; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x, by - 6); ctx.stroke(); balloon(ctx, p.x, by); };
        back.forEach(hangOne);
        hub(ctx, hx, hy, tips, heat);
        front.forEach(hangOne);
        ctx.globalAlpha = 1;
      } else {
        ctx.globalAlpha = droneA; hub(ctx, hx, hy, tips, heat); ctx.globalAlpha = 1;
        // strings are gone; four individual tracers drift downwind and spread apart
        const f = Math.min(1, (ph - TC) / 0.5), fa = f > 0.8 ? Math.max(0, (1 - f) / 0.2) : 1;
        const relY = yRel + 6 + L, base = hubTips(x0, relY, TC * P);
        if (fa > 0) {
          ctx.globalAlpha = fa;
          base.forEach((p, i) => {
            const k = [2, 0, 3, 1][i];
            const bx = p.x + Math.pow(f, 1.15) * w * (0.78 + 0.08 * k), by = p.y + hang + 6 + (k - 1.5) * f * h * 0.1 + 4 * f * Math.sin(f * 9 + k * 1.9);
            balloon(ctx, bx, by);
          });
          ctx.globalAlpha = 1;
        }
        // sparks from the dome as the strings part
        if (ph < TC + 0.08) {
          const s = (ph - TC) / 0.08;
          for (let k = 0; k < 8; k++) { const an = -0.3 - k * 0.36; dot(ctx, hx + Math.cos(an) * s * 14, hy - 3 + Math.sin(an) * s * 9 + s * s * 8, 1.3, `rgba(255,190,110,${1 - s})`); }
        }
      }
      // drone
      ctx.globalAlpha = droneA;
      drone(ctx, x0, dy, t);
      ctx.fillStyle = "#2b322d"; ctx.strokeStyle = "#d9d8d2"; ctx.lineWidth = 1.2;
      ctx.fillRect(x0 - 7, dy + 2, 14, 4); ctx.strokeRect(x0 - 7, dy + 2, 14, 4);
      ctx.globalAlpha = 1;
      const stage = ph < 0.3 ? "Climb to release height" : ph < TC ? "Heating burn wires" : ph < 0.62 ? "Strings part · release" : ph < 0.88 ? "Drift downwind" : "Drone returns";
      label(ctx, stage, 14, 22, C.brass);
      label(ctx, "Wind →", w - 14, 22, C.dim, "right");
    },

    // 02 one balloon tracer follows the flow through a turbine wake while the radiosonde samples
    drift(ctx, w, h, t) {
      const gy = h * 0.84; backdrop(ctx, w, h, gy);
      const tx = w * 0.36, H = h * 0.38, hub = gy - H;
      // wake: expanding, slightly darker region downstream of the rotor
      ctx.fillStyle = C.wake; ctx.beginPath(); ctx.moveTo(tx, hub - H * 0.42); ctx.lineTo(w, hub - H * 0.75); ctx.lineTo(w, hub + H * 0.75); ctx.lineTo(tx, hub + H * 0.42); ctx.fill();
      for (let k = 0; k < 7; k++) { const x = tx + 30 + ((t * 40 + k * 70) % (w - tx)); const r = 6 + (x - tx) / 40; ctx.strokeStyle = "rgba(236,235,229,.08)"; ctx.beginPath(); ctx.arc(x, hub + Math.sin(k * 2.1) * H * 0.3, r, t * 2 + k, t * 2 + k + 4); ctx.stroke(); }
      turbine(ctx, tx, gy, H, t);
      label(ctx, "Turbine wake", w - 14, hub - H * 0.55, C.dim, "right");
      // path: smooth upstream, more meandering inside the wake
      const P = 8, ph = (t % P) / P, pts = [];
      for (let i = 0; i <= 120; i++) { const f = i / 120, x = w * 0.04 + f * w * 0.92, inW = Math.max(0, (x - tx) / (w - tx));
        pts.push([x, hub - H * 0.18 + 4 * Math.sin(f * 9) + inW * 22 * Math.sin(f * 31) - f * 20]); }
      ctx.strokeStyle = C.B + "66"; ctx.lineWidth = 1.5; ctx.beginPath(); pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke();
      const j = Math.floor(ph * 120), [bx, by] = pts[j];
      ctx.strokeStyle = C.B; ctx.lineWidth = 2; ctx.beginPath(); pts.slice(0, j + 1).forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke();
      // sampling pings once per "second"
      for (let i = 0; i <= j; i += 8) dot(ctx, pts[i][0], pts[i][1], 2, C.brass);
      const ring = (t * 1.5) % 1; ctx.strokeStyle = `rgba(201,168,107,${1 - ring})`; ctx.beginPath(); ctx.arc(bx, by + 4, 12 + ring * 18, 0, 7); ctx.stroke();
      balloon(ctx, bx, by);
      label(ctx, w < 480 ? "Samples: GPS · p · T · humidity" : "Samples: GPS position · pressure · temperature · humidity", 14, 22, C.brass);
    },

    // 03 telemetry packets travel to a ground receiver
    telemetry(ctx, w, h, t) {
      const gy = h * 0.84; backdrop(ctx, w, h, gy);
      const bx = w * 0.30 + 14 * Math.sin(t * 0.6), by = h * 0.15 + 5 * Math.sin(t * 0.9);
      const rx = w * 0.80, ry = gy - 6;
      ctx.strokeStyle = "rgba(201,168,107,.25)"; ctx.setLineDash([3, 5]); ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(rx, ry - 34); ctx.stroke(); ctx.setLineDash([]);
      for (let k = 0; k < 3; k++) { const r = ((t * 0.8 + k / 3) % 1); ctx.strokeStyle = `rgba(201,168,107,${0.6 * (1 - r)})`; ctx.beginPath(); ctx.arc(bx, by, 10 + r * 40, -0.6, 0.9); ctx.stroke(); }
      for (let k = 0; k < 4; k++) { const f = ((t * 0.45 + k / 4) % 1); dot(ctx, bx + (rx - bx) * f, by + (ry - 34 - by) * f, 2.6, C.brass); }
      balloon(ctx, bx, by);
      // receiver: mast with antenna + laptop
      ctx.strokeStyle = "#d9d8d2"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(rx, ry); ctx.lineTo(rx, ry - 34); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(rx - 10, ry - 34); ctx.lineTo(rx + 10, ry - 34); ctx.moveTo(rx - 6, ry - 28); ctx.lineTo(rx + 6, ry - 28); ctx.stroke();
      ctx.fillStyle = "#d9d8d2"; ctx.fillRect(rx + 16, ry - 10, 22, 12); ctx.fillRect(rx + 12, ry + 2, 30, 2);
      label(ctx, "Ground receiver", rx, ry + 18, C.text, "center");
      // scrolling log
      const lx = 14, ly = h * 0.30, lines = 5;
      label(ctx, "Telemetry log", lx, ly - 10, C.dim);
      for (let i = 0; i < lines; i++) {
        const n = Math.floor(t * 1.2) - i, a = 1 - i / lines;
        ctx.font = "500 10.5px ui-monospace, Menlo, monospace"; ctx.fillStyle = `rgba(236,235,229,${0.75 * a})`; ctx.textAlign = "left";
        ctx.fillText(`t+${String(Math.max(n, 0)).padStart(4, "0")}s  lat/lon · p · T · RH`, lx, ly + 8 + i * 15);
      }
    },

    // 04 from Lagrangian track to boundary-layer information
    profile(ctx, w, h, t) {
      ctx.fillStyle = C.sky1; ctx.fillRect(0, 0, w, h);
      const narrow = w < 480;
      // left: track in x-z with velocity arrows from GPS differencing
      const L = { x: 14, y: 30, w: narrow ? w - 28 : w * 0.5, h: narrow ? h * 0.36 : h - 60 };
      ctx.strokeStyle = C.grid; ctx.strokeRect(L.x, L.y, L.w, L.h);
      const tr = []; for (let i = 0; i <= 80; i++) { const f = i / 80; tr.push([L.x + 8 + f * (L.w - 16), L.y + L.h * (0.75 - 0.5 * f) + 8 * Math.sin(f * 12)]); }
      ctx.strokeStyle = C.Cc; ctx.lineWidth = 1.8; ctx.beginPath(); tr.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke();
      const k = Math.floor(((t * 0.25) % 1) * 70) + 2;
      for (let i = 4; i < 78; i += 10) {
        const [x0, y0] = tr[i], [x1, y1] = tr[i + 2], dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy), s = 16 / l;
        const on = Math.abs(i - k) < 6; ctx.strokeStyle = on ? C.brass : "rgba(201,168,107,.7)"; ctx.lineWidth = on ? 2 : 1.3;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + dx * s, y0 + dy * s); ctx.stroke();
        const ax = x0 + dx * s, ay = y0 + dy * s, an = Math.atan2(dy, dx);
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax - 5 * Math.cos(an - .5), ay - 5 * Math.sin(an - .5)); ctx.lineTo(ax - 5 * Math.cos(an + .5), ay - 5 * Math.sin(an + .5)); ctx.fillStyle = ctx.strokeStyle; ctx.fill();
      }
      dot(ctx, tr[k][0], tr[k][1], 4, C.Cc);
      label(ctx, "Track → velocity (Δx / Δt)", L.x, 20, C.brass);
      // right: profiles of wind speed and potential temperature, stability from dθ/dz
      const R = narrow ? { x: 52, y: L.y + L.h + 26, w: w - 66, h: h - (L.y + L.h + 26) - 12 } : { x: w * 0.5 + 54, y: 30, w: w * 0.5 - 70, h: h - 60 };
      ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(R.x, R.y); ctx.lineTo(R.x, R.y + R.h); ctx.lineTo(R.x + R.w, R.y + R.h); ctx.stroke();
      const prog = reduce ? 1 : Math.min(1, ((t * 0.25) % 1) * 1.3);
      const n = Math.floor(prog * 40);
      ctx.strokeStyle = C.ink; ctx.lineWidth = 1.8; ctx.beginPath();
      for (let i = 0; i <= n; i++) { const z = i / 40, u = 0.25 + 0.6 * Math.pow(z, 0.28); const x = R.x + u * R.w, y = R.y + R.h - z * R.h; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke();
      ctx.strokeStyle = C.red; ctx.beginPath();
      for (let i = 0; i <= n; i++) { const z = i / 40, th = 0.35 + 0.08 * z + (z > 0.45 ? 0.35 * (z - 0.45) : 0); const x = R.x + th * R.w, y = R.y + R.h - z * R.h; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke();
      label(ctx, "Height", R.x - 6, R.y + 4, C.dim, "right");
      label(ctx, "Wind speed U", R.x + R.w * 0.62, R.y + 12, C.ink);
      label(ctx, "Potential temp. θ", R.x + R.w * 0.62, R.y + 26, C.red);
      if (prog > 0.7) {
        ctx.fillStyle = "rgba(201,168,107,.12)"; const yz = R.y + R.h * (1 - 0.45); ctx.fillRect(R.x + 1, R.y, R.w - 1, yz - R.y);
        label(ctx, "dθ/dz > 0 → stable layer", R.x + 8, yz - 8, C.brass);
      }
    },
  };

  const items = [...root.querySelectorAll("canvas[data-step]")].map(cv => ({ cv, ctx: setup(cv), fn: steps[cv.dataset.step] }));
  let clock = reduce ? 4.2 : 0;
  const draw = (it, t) => it.fn(it.ctx, it.cv._w, it.cv._h, t);
  items.forEach(it => { it.cv._redraw = () => draw(it, clock); });
  if (reduce) { const still = () => items.forEach(it => draw(it, 4.2)); still(); addEventListener("resize", still); return; }
  const live = new Set();
  const io = new IntersectionObserver(es => es.forEach(e => { const it = items.find(i => i.cv === e.target); e.isIntersecting ? live.add(it) : live.delete(it); }));
  items.forEach(it => { io.observe(it.cv); draw(it, 0); });
  const t0 = performance.now();
  (function loop(now) { const t = Math.max(0, (now - t0) / 1000); clock = t; live.forEach(it => draw(it, t)); requestAnimationFrame(loop); })(t0);
})();
