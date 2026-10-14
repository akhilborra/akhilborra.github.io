// Schematic of the rotor-performance experiment: pressure -> Reynolds number, measuring power and thrust,
// sweeping blade pitch. Qualitative only: no numbers, not measured data.
(() => {
  const root = document.getElementById("rotor-schematic");
  if (!root) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const C = {
    panel: "#171a18", grid: "rgba(236,235,229,.07)", rule: "rgba(236,235,229,.22)", text: "#a9aeaa",
    dim: "rgba(236,235,229,.35)", ink: "#ecebe5", brass: "#c9a86b", brassDim: "rgba(201,168,107,.38)",
    red: "#c4544a", rotor: "rgba(236,235,229,.7)",
  };
  const FONT = '600 11px Inter, system-ui, sans-serif';
  const clamp01 = x => Math.min(1, Math.max(0, x));
  const smooth = f => { f = clamp01(f); return f * f * (3 - 2 * f); };

  // seeded random so the gas molecules are the same on every load
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const gas = Array.from({ length: 230 }, () => ({ x: rand(), y: rand(), v: 0.9 + 0.2 * rand(), a: rand() }));

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
  // italic serif symbol with subscript, e.g. C_P; returns width
  const sym = (ctx, base, subs, x, y, color, size = 16) => {
    ctx.fillStyle = color; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    ctx.font = `italic ${size}px "Instrument Serif", Georgia, serif`; ctx.fillText(base, x, y);
    const wb = ctx.measureText(base).width;
    ctx.font = `italic ${Math.round(size * 0.7)}px "Instrument Serif", Georgia, serif`; ctx.fillText(subs, x + wb + 1, y + size * 0.25);
    return wb + ctx.measureText(subs).width + 2;
  };
  const text = (ctx, s, x, y, color = C.ink, size = 16, align = "left") => {
    ctx.font = `italic ${size}px "Instrument Serif", Georgia, serif`; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = "alphabetic";
    ctx.fillText(s, x, y);
  };
  const dot = (ctx, x, y, r, color) => { ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.fillStyle = color; ctx.fill(); };
  const rrect = (ctx, x, y, w, h, r) => {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  };
  const arrow = (ctx, x0, y0, x1, y1, color, w = 1.6) => {
    const a = Math.atan2(y1 - y0, x1 - x0), s = 6;
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x1 - s * Math.cos(a - 0.45), y1 - s * Math.sin(a - 0.45));
    ctx.lineTo(x1 - s * Math.cos(a + 0.45), y1 - s * Math.sin(a + 0.45)); ctx.closePath(); ctx.fill();
  };
  const bar = (ctx, x, y, w, h, f, color, name) => {
    label(ctx, name, x, y - 7, C.text);
    ctx.strokeStyle = C.rule; ctx.lineWidth = 1; rrect(ctx, x, y, w, h, h / 2); ctx.stroke();
    ctx.fillStyle = color; rrect(ctx, x + 2, y + 2, Math.max(h - 4, (w - 4) * f), h - 4, (h - 4) / 2); ctx.fill();
  };
  // front view of a three-bladed rotor with hub
  function rotor(ctx, cx, cy, R, ang) {
    ctx.strokeStyle = C.grid; ctx.lineWidth = 1; ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, 2 * Math.PI); ctx.stroke(); ctx.setLineDash([]);
    for (let i = 0; i < 3; i++) {
      const a = ang + i * 2 * Math.PI / 3;
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(a);
      ctx.beginPath(); ctx.moveTo(R * 0.12, -R * 0.045); ctx.quadraticCurveTo(R * 0.4, -R * 0.07, R, -R * 0.02);
      ctx.lineTo(R, R * 0.02); ctx.quadraticCurveTo(R * 0.4, R * 0.04, R * 0.12, R * 0.045); ctx.closePath();
      ctx.fillStyle = C.rotor; ctx.fill(); ctx.restore();
    }
    dot(ctx, cx, cy, R * 0.12, "#2a2f2c"); ctx.strokeStyle = C.rotor; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.12, 0, 2 * Math.PI); ctx.stroke();
  }

  const steps = {
    // (a) same tunnel, same speed, denser gas -> higher Reynolds number
    re(ctx, w, h, t) {
      ctx.clearRect(0, 0, w, h);
      const period = 9, ph = (t % period) / period;
      const p = smooth(ph / 0.7) * (ph < 0.9 ? 1 : 1 - smooth((ph - 0.9) / 0.1));
      const m = 14, tx = m, ty = 34, tw = w - 2 * m, th = h * 0.5;
      label(ctx, "Tunnel, side view", m, 22);
      ctx.strokeStyle = C.rule; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tx + tw, ty); ctx.moveTo(tx, ty + th); ctx.lineTo(tx + tw, ty + th); ctx.stroke();
      // gas: more molecules as pressure rises, all drifting at the same speed
      const n = Math.round(24 + (gas.length - 24) * p);
      for (let i = 0; i < n; i++) {
        const g = gas[i];
        const x = ((g.x + 0.07 * t) % 1 + 1) % 1;
        dot(ctx, tx + x * tw, ty + 6 + g.y * (th - 12), 1.5 + g.a * 0.8, `rgba(236,235,229,${0.35 + 0.4 * g.a})`);
      }
      // model rotor (disc edge-on) in the middle, same size throughout
      const cx = tx + tw * 0.5, cy = ty + th / 2, R = th * 0.32;
      ctx.strokeStyle = C.brass; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke();
      ctx.strokeStyle = C.rotor; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx - 14, cy); ctx.lineTo(cx, cy); ctx.stroke();
      dot(ctx, cx - 14, cy, 3, C.rotor);
      arrow(ctx, tx + 10, ty + th + 16, tx + 70, ty + th + 16, C.text);
      label(ctx, "Same speed U", tx + 80, ty + th + 20, C.text);
      label(ctx, "Same size c", tx + tw, ty + th + 20, C.text, "right");
      // gauges
      const by = ty + th + 52, bw = (tw - 20) / 2;
      bar(ctx, m, by, bw, 14, 0.12 + 0.85 * p, C.brass, "Pressure up → density up");
      bar(ctx, m + bw + 20, by, bw, 14, 0.12 + 0.85 * p, C.red, "Reynolds number up");
      const wr = sym(ctx, "Re", "", m, h - 14, C.ink, 16);
      text(ctx, "= ρ U c / μ", m + wr + 4, h - 14, C.ink, 16);
    },

    // (b) rotor spinning; torque x speed -> power -> C_P, strain gauges -> thrust -> C_T
    meas(ctx, w, h, t) {
      ctx.clearRect(0, 0, w, h);
      const m = 14;
      const rx = w * 0.23, ry = h * 0.46, R = Math.min(h * 0.26, w * 0.17);
      const ang = t * 3.2;
      label(ctx, "Model rotor", m, 22);
      rotor(ctx, rx, ry, R, ang);
      ctx.strokeStyle = C.brass; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(rx, ry, R * 1.15, -0.5, 0.9); ctx.stroke();
      arrow(ctx, rx + R * 1.15 * Math.cos(0.84), ry + R * 1.15 * Math.sin(0.84), rx + R * 1.15 * Math.cos(0.9), ry + R * 1.15 * Math.sin(0.9), C.brass);
      label(ctx, "Torque, speed", rx, h - 38, C.brass, "center");
      const th = R * (0.55 + 0.12 * Math.sin(t * 2.4 + 2));
      arrow(ctx, rx - th / 2 - R * 0.5, h - 18, rx + th / 2 - R * 0.5, h - 18, C.red, 2);
      label(ctx, "Thrust", rx - R * 0.5 + th / 2 + 8, h - 14, C.red);
      const bx = w * 0.46, bw = w - m - bx, bh = h * 0.36, y1 = h * 0.1, y2 = y1 + bh + h * 0.08;
      const pulse = k => 0.55 + 0.45 * Math.sin(t * 2.4 + k);
      const box = (y, name, subs, formula, color, f, src) => {
        ctx.strokeStyle = C.rule; ctx.lineWidth = 1; rrect(ctx, bx, y, bw, bh, 8); ctx.stroke();
        label(ctx, name, bx + 12, y + 20, color);
        const wc = sym(ctx, "C", subs, bx + 12, y + bh * 0.66, C.ink, 20);
        text(ctx, formula, bx + 12 + wc + 4, y + bh * 0.66, C.ink, 15);
        ctx.fillStyle = color; ctx.globalAlpha = 0.85;
        rrect(ctx, bx + 12, y + bh - 14, Math.max(8, (bw - 24) * f), 5, 2.5); ctx.fill(); ctx.globalAlpha = 1;
        const sg = (t * 0.45 + src) % 1;
        const x0 = rx + R * 1.25, y0 = ry, x1 = bx, y1c = y + bh / 2;
        ctx.strokeStyle = C.grid; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1c); ctx.stroke();
        dot(ctx, x0 + (x1 - x0) * sg, y0 + (y1c - y0) * sg, 2.6, color);
      };
      box(y1, "Power", "P", "= P / (½ρAU³)", C.brass, pulse(0), 0);
      box(y2, "Thrust", "T", "= T / (½ρAU²)", C.red, pulse(2), 0.5);
    },

    // (c) sweep blade pitch, trace C_P, mark the maximum
    pitch(ctx, w, h, t) {
      ctx.clearRect(0, 0, w, h);
      const stacked = w < 480;
      const period = 10, ph = (t % period) / period;
      const s = smooth(ph / 0.6);                  // sweep progress 0..1, then hold
      const hold = ph > 0.6 ? 1 : 0;
      const m = 14;
      // plot area
      const px = stacked ? m + 22 : w * 0.46, py = stacked ? h * 0.56 : 34, pw = w - px - m, phh = stacked ? h * 0.3 : h - 34 - 40;
      const x0 = 0.5, peak = 0.62;
      const cp = u => Math.exp(-Math.pow((u - peak) / (u < peak ? 0.3 : 0.2), 2));
      const X = u => px + u * pw, Y = v => py + phh * (1 - 0.9 * v) - 4;
      label(ctx, "Power coefficient", px, py - 10, C.text);
      ctx.strokeStyle = C.rule; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, py + phh); ctx.lineTo(px + pw, py + phh); ctx.stroke();
      label(ctx, "Pitch angle →", px + pw, py + phh + 18, C.text, "right");
      ctx.strokeStyle = C.brassDim; ctx.lineWidth = 1; ctx.setLineDash([3, 4]); ctx.beginPath();
      for (let i = 0; i <= 80; i++) { const u = i / 80; i ? ctx.lineTo(X(u), Y(cp(u))) : ctx.moveTo(X(u), Y(cp(u))); }
      ctx.stroke(); ctx.setLineDash([]);
      const u = 0.04 + 0.92 * s;
      ctx.strokeStyle = C.brass; ctx.lineWidth = 2.2; ctx.beginPath();
      for (let i = 0; i <= 80; i++) { const uu = 0.04 + 0.92 * s * i / 80; i ? ctx.lineTo(X(uu), Y(cp(uu))) : ctx.moveTo(X(uu), Y(cp(uu))); }
      ctx.stroke();
      dot(ctx, X(u), Y(cp(u)), 4.5, C.ink);
      if (hold) {
        const f = smooth((ph - 0.6) / 0.1), xm = X(peak), ym = Y(1);
        ctx.globalAlpha = f; ctx.strokeStyle = C.red; ctx.lineWidth = 1.2; ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(xm, ym); ctx.lineTo(xm, py + phh); ctx.stroke(); ctx.setLineDash([]);
        ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(xm, ym, 8, 0, 2 * Math.PI); ctx.stroke();
        label(ctx, "Optimal pitch", xm, py + phh + 18 + (stacked ? 14 : 0), C.red, "center");
        ctx.globalAlpha = 1;
      }
      // blade section, pitching with the sweep
      const bcx = stacked ? w * 0.5 : w * 0.24, bcy = stacked ? h * 0.24 : h * 0.5, L = Math.min(w * (stacked ? 0.2 : 0.13), h * 0.28);
      label(ctx, "Blade section", m, 22);
      const a = (-0.35 + 0.9 * u) ;
      ctx.strokeStyle = C.grid; ctx.lineWidth = 1; ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.moveTo(bcx - L * 1.25, bcy); ctx.lineTo(bcx + L * 1.25, bcy); ctx.stroke(); ctx.setLineDash([]);
      ctx.save(); ctx.translate(bcx, bcy); ctx.rotate(a);
      ctx.beginPath(); ctx.moveTo(-L, 0); ctx.bezierCurveTo(-L * 0.7, -L * 0.28, L * 0.1, -L * 0.2, L, 0);
      ctx.bezierCurveTo(L * 0.1, L * 0.06, -L * 0.7, L * 0.08, -L, 0); ctx.closePath();
      ctx.fillStyle = C.rotor; ctx.fill(); ctx.restore();
      arrow(ctx, bcx - L * 1.25, bcy + L * 0.62, bcx - L * 0.5, bcy + L * 0.62, C.dim, 1.2);
      label(ctx, "Flow", bcx - L * 1.25, bcy + L * 0.62 + 14, C.dim);
    },
  };

  // ---------- run only what's on screen ----------
  const live = new Set();
  const canvases = [...root.querySelectorAll("canvas[data-step]")].map(cv => ({ cv, ctx: setup(cv), fn: steps[cv.dataset.step] }));
  const draw = (item, t) => item.fn(item.ctx, item.cv._w, item.cv._h, t);
  if (reduce) {
    const still = () => canvases.forEach(c => draw(c, c.cv.dataset.step === "pitch" ? 8 : c.cv.dataset.step === "re" ? 6.5 : 1));
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
