// Schematic of the balloon measurement chain: release -> drift through the farm & measure -> telemetry -> tracks to entrainment.
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

  // Shared schematic geometry for steps 02 and 04 (heights in units of hub height H; u = fraction of the way across the farm view).
  const sstep = (a, b, u) => { const x = Math.min(1, Math.max(0, (u - a) / (b - a))); return x * x * (3 - 2 * x); };
  const FARM0 = 0.22, FARM1 = 0.90;
  // top of the wind-farm layer (internal boundary layer): grows downstream through the farm
  const layerTop = u => 1.35 + 0.95 * sstep(FARM0, FARM1, u);
  // two illustrative tracks: A is drawn down into the farm layer and back out; B stays low, then is carried out
  const trackA = u => 2.5 - 1.75 * sstep(0.26, 0.46, u) + 1.35 * sstep(0.70, 0.93, u) + 0.07 * Math.sin(u * 40);
  const trackB = u => 1.05 + 0.08 * Math.sin(u * 23) - 0.15 * sstep(0.3, 0.5, u) + 1.7 * sstep(0.62, 0.88, u);

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

    // 02 balloons follow the air through a whole wind farm: drawn down into the farm layer (entrainment) and carried back out (detrainment)
    drift(ctx, w, h, t) {
      const narrow = w < 480;
      const gy = h * 0.88; backdrop(ctx, w, h, gy);
      const H = h * 0.2, X = u => u * w, Y = z => gy - z * H;
      // wind-farm layer: faint band under the growing top curve
      const N = 60, top = [];
      for (let i = 0; i <= N; i++) { const u = FARM0 + (FARM1 - FARM0) * i / N; top.push([X(u), Y(layerTop(u))]); }
      ctx.beginPath(); ctx.moveTo(X(FARM0), gy); top.forEach(([x, y]) => ctx.lineTo(x, y)); ctx.lineTo(X(FARM1), gy); ctx.closePath();
      ctx.fillStyle = "rgba(201,168,107,.07)"; ctx.fill();
      ctx.strokeStyle = "rgba(201,168,107,.6)"; ctx.lineWidth = 1.2; ctx.setLineDash([5, 4]); ctx.beginPath(); top.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke(); ctx.setLineDash([]);
      // turbines: a back row (smaller, fainter) and a front row, spread over the farm
      const nT = narrow ? 5 : 7;
      ctx.globalAlpha = 0.4;
      for (let k = 0; k < nT; k++) turbine(ctx, X(FARM0 + 0.03 + (FARM1 - FARM0 - 0.02) * (k + 0.5) / nT), gy - 3, H * 0.78, t * 0.8 + k * 1.7, 0.75);
      ctx.globalAlpha = 1;
      for (let k = 0; k < nT; k++) turbine(ctx, X(FARM0 + (FARM1 - FARM0) * k / (nT - 1) * 0.96), gy, H, t + k * 0.9);
      // wind arrows (streamwise flow) far above
      for (let k = 0; k < 3; k++) { const x = ((t * 22 + k * w / 3) % (w + 40)) - 20, y = h * 0.09 + 0 * k; ctx.strokeStyle = "rgba(236,235,229,.14)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x - 18, y + 8); ctx.lineTo(x, y + 8); ctx.moveTo(x - 5, y + 4); ctx.lineTo(x, y + 8); ctx.lineTo(x - 5, y + 12); ctx.stroke(); }
      label(ctx, "Wind →", w - 14, 22, C.dim, "right");
      label(ctx, narrow ? "Dashed: farm layer top" : "Dashed: top of wind-farm layer", 14, 38, "rgba(201,168,107,.75)");
      // tracks
      const P = 14, ph = (t % P) / P, u0 = 0.04, u1 = 0.97, K = 160;
      const run = (fn, col, lag) => {
        const pts = []; for (let i = 0; i <= K; i++) { const u = u0 + (u1 - u0) * i / K; pts.push([X(u), Y(fn(u)), u]); }
        const f = Math.min(1, Math.max(0, (ph - lag) / 0.8)), j = Math.floor(f * K);
        ctx.lineWidth = 1.5; ctx.strokeStyle = col + "55"; ctx.beginPath(); pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke();
        // travelled part: brass while the balloon is inside the farm layer, blue outside
        ctx.lineWidth = 2.4;
        for (let i = 1; i <= j; i++) { const inside = fn(pts[i][2]) < layerTop(pts[i][2]) && pts[i][2] > FARM0; ctx.strokeStyle = inside ? C.brass : col; ctx.beginPath(); ctx.moveTo(pts[i - 1][0], pts[i - 1][1]); ctx.lineTo(pts[i][0], pts[i][1]); ctx.stroke(); }
        for (let i = 0; i <= j; i += 10) dot(ctx, pts[i][0], pts[i][1], 1.8, C.brass);
        if (f > 0 && f < 1) { const [bx, by] = pts[j], ring = (t * 1.5) % 1; ctx.strokeStyle = `rgba(201,168,107,${1 - ring})`; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(bx, by + 4, 10 + ring * 14, 0, 7); ctx.stroke(); balloon(ctx, bx, by, 0.9); }
        return pts;
      };
      const pa = run(trackA, C.B, 0.0);
      run(trackB, C.Cc, 0.0);
      // annotations on track A
      const ia = pa[Math.round((0.36 - u0) / (u1 - u0) * K)], id = pa[Math.round((0.83 - u0) / (u1 - u0) * K)];
      label(ctx, "Entrained", ia[0] + 8, ia[1] - 10, C.text);
      label(ctx, "Carried out", id[0] - 6, id[1] - 18, C.text, "right");
      label(ctx, narrow ? "Samples: GPS · p · T · RH" : "Samples: GPS position · pressure · temperature · humidity", 14, 22, C.brass);
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

    // 04 from Lagrangian track to entrainment information (schematic, qualitative axes)
    profile(ctx, w, h, t) {
      ctx.fillStyle = C.sky1; ctx.fillRect(0, 0, w, h);
      const narrow = w < 480, px = narrow ? 26 : 34;
      const A = { x: px, y: 34, w: w - px - 16, h: (h - 84) * 0.56 };
      const B = { x: px, y: A.y + A.h + 34, w: A.w, h: h - (A.y + A.h + 34) - 22 };
      const u0 = 0.04, u1 = 0.97, K = 120, X = (R, u) => R.x + (u - u0) / (u1 - u0) * R.w;
      const zmax = 3.9, ZY = z => A.y + A.h - (z / zmax) * A.h;
      // panel A: height of the track against the top of the farm layer
      ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(A.x, A.y + A.h); ctx.lineTo(A.x + A.w, A.y + A.h); ctx.stroke();
      const tp = []; for (let i = 0; i <= K; i++) { const u = u0 + (u1 - u0) * i / K; tp.push([X(A, u), ZY(u > FARM0 ? layerTop(u) : 1.35 * 0 + layerTop(FARM0)), u]); }
      ctx.beginPath(); ctx.moveTo(X(A, FARM0), A.y + A.h); tp.filter(p => p[2] >= FARM0 && p[2] <= FARM1).forEach(p => ctx.lineTo(p[0], p[1])); ctx.lineTo(X(A, FARM1), A.y + A.h); ctx.closePath(); ctx.fillStyle = "rgba(201,168,107,.08)"; ctx.fill();
      ctx.strokeStyle = "rgba(201,168,107,.65)"; ctx.setLineDash([5, 4]); ctx.beginPath(); tp.filter(p => p[2] >= FARM0 && p[2] <= FARM1).forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.stroke(); ctx.setLineDash([]);
      const f = reduce ? 1 : Math.min(1, ((t * 0.2) % 1) * 1.25), n = Math.floor(f * K);
      const tr = []; for (let i = 0; i <= K; i++) { const u = u0 + (u1 - u0) * i / K; tr.push([X(A, u), ZY(trackA(u)), u]); }
      ctx.lineWidth = 2.2;
      for (let i = 1; i <= n; i++) { const u = tr[i][2], inside = trackA(u) < layerTop(u) && u > FARM0; ctx.strokeStyle = inside ? C.brass : C.B; ctx.beginPath(); ctx.moveTo(tr[i - 1][0], tr[i - 1][1]); ctx.lineTo(tr[i][0], tr[i][1]); ctx.stroke(); }
      dot(ctx, tr[n][0], tr[n][1], 4, C.B);
      label(ctx, narrow ? "Height vs. farm layer (dashed)" : "Track height vs. top of farm layer (dashed)", A.x, 20, C.brass);
      label(ctx, "↑", A.x - 6, A.y + 8, C.dim, "right");
      // panel B: vertical motion of the balloon (from the track), downward = drawn into the farm
      ctx.strokeStyle = C.line; ctx.beginPath(); ctx.moveTo(B.x, B.y); ctx.lineTo(B.x, B.y + B.h); ctx.stroke();
      const mid = B.y + B.h / 2; ctx.strokeStyle = C.grid; ctx.beginPath(); ctx.moveTo(B.x, mid); ctx.lineTo(B.x + B.w, mid); ctx.stroke();
      const vz = i => { const a = tr[Math.max(0, i - 2)], b = tr[Math.min(K, i + 2)]; return -(b[1] - a[1]) / (b[0] - a[0] || 1); };
      let vmax = 0; for (let i = 0; i <= K; i++) vmax = Math.max(vmax, Math.abs(vz(i)));
      const VY = i => mid - (vz(i) / vmax) * (B.h / 2 - 4);
      ctx.beginPath(); ctx.moveTo(tr[0][0], mid); for (let i = 0; i <= n; i++) ctx.lineTo(tr[i][0], VY(i)); ctx.lineTo(tr[n][0], mid); ctx.closePath(); ctx.fillStyle = "rgba(196,84,74,.14)"; ctx.fill();
      ctx.strokeStyle = C.red; ctx.lineWidth = 1.8; ctx.beginPath(); for (let i = 0; i <= n; i++) i ? ctx.lineTo(tr[i][0], VY(i)) : ctx.moveTo(tr[i][0], VY(i)); ctx.stroke();
      label(ctx, narrow ? "Vertical motion (↓ drawn into farm)" : "Vertical motion (↑ up, ↓ down)", B.x, B.y - 10, C.red);
      label(ctx, "↑", B.x - 6, B.y + 8, C.dim, "right"); label(ctx, "↓", B.x - 6, B.y + B.h, C.dim, "right");
      label(ctx, "Distance downstream →", B.x + B.w, B.y + B.h + 16, C.dim, "right");
      if (f > 0.5) { const e = tr[Math.round((0.36 - u0) / (u1 - u0) * K)]; label(ctx, "Entrained", e[0] + 8, ZY(trackA(0.36)) + 4, C.text); }
      if (f > 0.97) { const e = tr[Math.round((0.83 - u0) / (u1 - u0) * K)]; label(ctx, "Leaves", e[0] - 4, ZY(trackA(0.83)) - 12, C.text, "right"); }
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
