// Real-data balloon explorer: one clock (the model-viewer animation) drives the 3D scene,
// a top-down map, a side profile and a live readout table.
(() => {
  const box = document.getElementById("bx");
  if (!box) return;
  const mv = box.querySelector("model-viewer");
  const playBtn = box.querySelector(".bx-play");
  const range = box.querySelector(".bx-range");
  const timeEl = box.querySelector(".bx-time span");
  const mapCv = box.querySelector("canvas[data-view=map]");
  const profCv = box.querySelector("canvas[data-view=profile]");
  const tbody = box.querySelector("tbody");
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const C = { grid: "rgba(236,235,229,.07)", axis: "rgba(236,235,229,.25)", text: "#a9aeaa", dim: "#7f8581", tur: "rgba(236,235,229,.55)", ground: "rgba(236,235,229,.10)" };
  const FONT = "600 10px Inter, system-ui, sans-serif";

  let D, hidden = new Set(), scrubbing = false;

  const fitCanvas = cv => {
    const ctx = cv.getContext("2d");
    const fit = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = Math.round(cv.clientWidth * dpr); cv.height = Math.round(cv.clientHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); cv._w = cv.clientWidth; cv._h = cv.clientHeight;
    };
    fit(); new ResizeObserver(() => { fit(); render(true); }).observe(cv);
    return ctx;
  };
  const mapCtx = fitCanvas(mapCv), profCtx = fitCanvas(profCv);
  const text = (ctx, s, x, y, col = C.text, align = "left") => { ctx.font = FONT; ctx.fillStyle = col; ctx.textAlign = align; ctx.fillText(s, x, y); };
  const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  // value of series `key` for sonde s at flight time tau (seconds), linear interpolation
  function sample(s, key, tau) {
    const t = s.t;
    if (tau < t[0] || tau > t[t.length - 1]) return null;
    let lo = 0, hi = t.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; t[m] <= tau ? lo = m : hi = m; }
    const a = s[key][lo], b = s[key][hi];
    if (a == null || b == null) return a ?? b;
    const f = t[hi] === t[lo] ? 0 : (tau - t[lo]) / (t[hi] - t[lo]);
    return a + (b - a) * f;
  }

  // ---------- map (top view) ----------
  function drawMap(tau) {
    const ctx = mapCtx, w = mapCv._w, h = mapCv._h, e = D.extent, pad = 18;
    const sx = (w - 2 * pad) / (e.x1 - e.x0), sy = (h - 2 * pad - 14) / (e.y1 - e.y0), s = Math.min(sx, sy);
    const ox = pad + ((w - 2 * pad) - s * (e.x1 - e.x0)) / 2, oy = pad + ((h - 2 * pad - 14) - s * (e.y1 - e.y0)) / 2;
    const X = x => ox + (x - e.x0) * s, Y = y => oy + (e.y1 - y) * s;
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
    for (let gx = Math.ceil(e.x0 / 5000) * 5000; gx < e.x1; gx += 5000) { ctx.beginPath(); ctx.moveTo(X(gx), Y(e.y0)); ctx.lineTo(X(gx), Y(e.y1)); ctx.stroke(); }
    for (let gy = Math.ceil(e.y0 / 5000) * 5000; gy < e.y1; gy += 5000) { ctx.beginPath(); ctx.moveTo(X(e.x0), Y(gy)); ctx.lineTo(X(e.x1), Y(gy)); ctx.stroke(); }
    for (const t of D.turbines) { ctx.beginPath(); ctx.arc(X(t.x), Y(t.y), 1.8, 0, 7); ctx.fillStyle = C.tur; ctx.fill(); }
    for (const sd of D.sondes) {
      if (hidden.has(sd.launch)) continue;
      ctx.strokeStyle = sd.color + "40"; ctx.lineWidth = 1.2; ctx.beginPath();
      sd.x.forEach((x, i) => i ? ctx.lineTo(X(x), Y(sd.y[i])) : ctx.moveTo(X(x), Y(sd.y[i]))); ctx.stroke();
      ctx.strokeStyle = sd.color; ctx.lineWidth = 1.8; ctx.beginPath();
      let last = null;
      for (let i = 0; i < sd.t.length && sd.t[i] <= tau; i++) { i ? ctx.lineTo(X(sd.x[i]), Y(sd.y[i])) : ctx.moveTo(X(sd.x[i]), Y(sd.y[i])); last = i; }
      const px = sample(sd, "x", tau), py = sample(sd, "y", tau);
      if (px != null) ctx.lineTo(X(px), Y(py));
      ctx.stroke();
      const hx = px ?? sd.x[sd.x.length - 1], hy = py ?? sd.y[sd.y.length - 1];
      if (last !== null || px != null) {
        ctx.beginPath(); ctx.arc(X(hx), Y(hy), px != null ? 4 : 2.5, 0, 7);
        ctx.fillStyle = px != null ? sd.color : sd.color + "80"; ctx.fill();
        if (px != null) { ctx.beginPath(); ctx.arc(X(hx), Y(hy), 9, 0, 7); ctx.strokeStyle = sd.color + "55"; ctx.lineWidth = 1; ctx.stroke(); }
      }
    }
    // release point, scale bar, north
    ctx.beginPath(); ctx.arc(X(0), Y(0), 5, 0, 7); ctx.strokeStyle = "#c9a86b"; ctx.lineWidth = 1.5; ctx.stroke();
    text(ctx, "WINSENT · release", X(0) + 9, Y(0) - 8, "#c9a86b");
    const bx = w - pad - 5000 * s, by = h - 8;
    ctx.strokeStyle = C.axis; ctx.beginPath(); ctx.moveTo(bx, by - 4); ctx.lineTo(bx, by); ctx.lineTo(bx + 5000 * s, by); ctx.lineTo(bx + 5000 * s, by - 4); ctx.stroke();
    text(ctx, "5 km", bx + 2500 * s, by - 6, C.dim, "center");
    text(ctx, "N ↑", pad, h - 6, C.dim);
  }

  // ---------- profile (side view: altitude vs distance east) ----------
  let groundLine = null;
  function buildGround() {
    const bins = new Map();
    for (const sd of D.sondes) sd.x.forEach((x, i) => {
      const k = Math.round(x / 400); const b = bins.get(k) || [0, 0]; b[0] += sd.ground[i]; b[1]++; bins.set(k, b);
    });
    groundLine = [...bins.entries()].sort((a, b) => a[0] - b[0]).map(([k, b]) => [k * 400, b[0] / b[1]]);
  }
  function drawProfile(tau) {
    const ctx = profCtx, w = profCv._w, h = profCv._h, e = D.extent;
    const L = 38, R = 10, T = 10, B = 22, zmin = 350, zmax = 1850;
    const X = x => L + (x - e.x0) / (e.x1 - e.x0) * (w - L - R), Y = z => T + (zmax - z) / (zmax - zmin) * (h - T - B);
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
    for (let z = 500; z <= 1750; z += 250) { ctx.beginPath(); ctx.moveTo(L, Y(z)); ctx.lineTo(w - R, Y(z)); ctx.stroke(); text(ctx, String(z), L - 6, Y(z) + 3, C.dim, "right"); }
    for (let x = 0; x < e.x1; x += 5000) text(ctx, `${x / 1000} km`, X(x), h - 6, C.dim, "center");
    // terrain under the tracks
    ctx.beginPath(); ctx.moveTo(X(groundLine[0][0]), Y(zmin));
    groundLine.forEach(([x, g]) => ctx.lineTo(X(x), Y(g)));
    ctx.lineTo(X(groundLine[groundLine.length - 1][0]), Y(zmin)); ctx.closePath();
    ctx.fillStyle = C.ground; ctx.fill();
    // turbines near the corridor: tower to hub height
    ctx.strokeStyle = C.tur; ctx.lineWidth = 1;
    for (const t of D.turbines) { if (Math.abs(t.y) > 2500) continue; ctx.beginPath(); ctx.moveTo(X(t.x), Y(t.ground)); ctx.lineTo(X(t.x), Y(t.ground + t.hub)); ctx.stroke(); }
    for (const sd of D.sondes) {
      if (hidden.has(sd.launch)) continue;
      ctx.strokeStyle = sd.color + "40"; ctx.lineWidth = 1.2; ctx.beginPath();
      sd.x.forEach((x, i) => i ? ctx.lineTo(X(x), Y(sd.msl[i])) : ctx.moveTo(X(x), Y(sd.msl[i]))); ctx.stroke();
      ctx.strokeStyle = sd.color; ctx.lineWidth = 1.8; ctx.beginPath();
      for (let i = 0; i < sd.t.length && sd.t[i] <= tau; i++) i ? ctx.lineTo(X(sd.x[i]), Y(sd.msl[i])) : ctx.moveTo(X(sd.x[i]), Y(sd.msl[i]));
      const px = sample(sd, "x", tau), pz = sample(sd, "msl", tau);
      if (px != null) { ctx.lineTo(X(px), Y(pz)); ctx.stroke(); ctx.beginPath(); ctx.arc(X(px), Y(pz), 4, 0, 7); ctx.fillStyle = sd.color; ctx.fill(); }
      else ctx.stroke();
    }
    text(ctx, "m MSL", L - 6, T + 2, C.dim, "right");
  }

  // ---------- readout table ----------
  const rows = new Map();
  function buildTable() {
    for (const sd of D.sondes) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td><span class="bx-id" style="--c:${sd.color}"><i></i>${sd.launch} <small>· ${sd.id}</small></span></td>
        <td data-k="agl"></td><td data-k="dist"></td><td data-k="T" class="opt"></td><td data-k="rh" class="opt"></td><td data-k="p" class="opt"></td>`;
      tbody.appendChild(tr); rows.set(sd, tr);
    }
  }
  function updateTable(tau) {
    for (const [sd, tr] of rows) {
      tr.classList.toggle("off", hidden.has(sd.launch));
      const x = sample(sd, "x", tau);
      const cells = tr.querySelectorAll("td[data-k]");
      if (x == null) {
        const ended = tau > sd.t[sd.t.length - 1];
        cells.forEach((c, i) => { c.textContent = i === 0 ? (ended ? "end of track" : "—") : "—"; c.className = (c.className.includes("opt") ? "opt " : "") + "dim"; });
        continue;
      }
      const y = sample(sd, "y", tau), msl = sample(sd, "msl", tau), g = sample(sd, "ground", tau);
      const v = { agl: `${Math.round(msl - g)} m`, dist: `${(Math.hypot(x, y) / 1000).toFixed(1)} km`,
        T: sample(sd, "T", tau)?.toFixed(1) + " °C", rh: Math.round(sample(sd, "rh", tau) ?? NaN) + " %", p: sample(sd, "p", tau)?.toFixed(1) + " hPa" };
      cells.forEach(c => { c.textContent = v[c.dataset.k]; c.className = c.className.replace(/\s?dim/, ""); });
    }
  }

  // ---------- launch toggles (also fade the 3D materials) ----------
  function setLaunchVisible(L, on) {
    on ? hidden.delete(L) : hidden.add(L);
    const mats = mv.model?.materials || [];
    for (const m of mats) if (m.name === "Track " + L || m.name === "Balloon " + L) {
      m.setAlphaMode(on ? "OPAQUE" : "BLEND");
      const c = m.pbrMetallicRoughness.baseColorFactor; m.pbrMetallicRoughness.setBaseColorFactor([c[0], c[1], c[2], on ? 1 : 0.06]);
    }
    render(true);
  }
  box.querySelectorAll(".bx-chip").forEach(b => b.addEventListener("click", () => {
    const on = b.getAttribute("aria-pressed") !== "true"; b.setAttribute("aria-pressed", on); setLaunchVisible(b.dataset.launch, on);
  }));

  // ---------- clock ----------
  let lastT = -1, lastTable = 0;
  function render(force) {
    if (!D) return;
    const t = mv.loaded ? mv.currentTime : 0;
    if (!force && Math.abs(t - lastT) < 1e-3) return;
    lastT = t;
    const tau = t * D.speedup;
    drawMap(tau); drawProfile(tau);
    const now = performance.now();
    if (force || now - lastTable > 120) { updateTable(tau); lastTable = now; }
    timeEl.textContent = "T + " + fmt(tau);
    if (!scrubbing) range.value = t;
    range.style.setProperty("--p", (t / D.loop * 100) + "%");
  }
  const syncPlay = () => { playBtn.textContent = mv.paused ? "▶" : "❚❚"; playBtn.setAttribute("aria-label", mv.paused ? "Play" : "Pause"); };
  playBtn.addEventListener("click", () => { mv.paused ? mv.play() : mv.pause(); syncPlay(); });
  range.addEventListener("input", () => { scrubbing = true; mv.pause(); mv.currentTime = +range.value; syncPlay(); render(true); });
  range.addEventListener("change", () => { scrubbing = false; });
  ["play", "pause"].forEach(ev => mv.addEventListener(ev, syncPlay));


  // ---------- navigation: drag rotates (model-viewer), Shift-drag moves the map; viewpoint presets ----------
  const VIEWS = {
    overview: ["14000m 4200m -900m", "-10deg 64deg 38000m"],
    release: ["600m 900m 0m", "-35deg 62deg 7000m"],
    farms: ["9000m 1300m -1200m", "-20deg 58deg 13000m"],
    top: ["14000m 0m -900m", "0deg 5deg 40000m"],
  };
  box.querySelectorAll(".bx-views button").forEach(b => b.addEventListener("click", () => {
    const [t, o] = VIEWS[b.dataset.view]; mv.cameraTarget = t; mv.cameraOrbit = o;
  }));

  let drag = null;
  const clampTarget = (x, z) => {
    if (!D) return [x, z];
    const e = D.extent;
    return [Math.min(Math.max(x, e.x0), e.x1), Math.min(Math.max(z, -e.y1), -e.y0)];
  };
  let shiftHeld = false;
  addEventListener("keydown", e => { if (e.key === "Shift") shiftHeld = true; });
  addEventListener("keyup", e => { if (e.key === "Shift") shiftHeld = false; });
  addEventListener("blur", () => { shiftHeld = false; });
  mv.addEventListener("pointerdown", ev => {
    if (!(ev.shiftKey || shiftHeld) || ev.button !== 0) return;
    ev.stopPropagation(); ev.preventDefault();
    mv.setPointerCapture(ev.pointerId);
    drag = { id: ev.pointerId, x: ev.clientX, y: ev.clientY };
    mv.classList.add("dragging");
  }, true);
  mv.addEventListener("pointermove", ev => {
    if (!drag || ev.pointerId !== drag.id) return;
    ev.stopPropagation();
    const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
    drag.x = ev.clientX; drag.y = ev.clientY;
    const o = mv.getCameraOrbit(), t = mv.getCameraTarget(), fov = mv.getFieldOfView() * Math.PI / 180;
    const mpp = 2 * o.radius * Math.tan(fov / 2) / mv.clientHeight;
    const rx = Math.cos(o.theta), rz = -Math.sin(o.theta);          // camera right, on the ground plane
    const fx = -Math.sin(o.theta), fz = -Math.cos(o.theta);         // camera forward, on the ground plane
    const k = 1 / Math.max(Math.cos(o.phi), 0.35);
    const [x, z] = clampTarget(t.x - rx * dx * mpp + fx * dy * mpp * k, t.z - rz * dx * mpp + fz * dy * mpp * k);
    mv.cameraTarget = `${x}m ${t.y}m ${z}m`;
    mv.jumpCameraToGoal();
  }, true);
  const endDrag = ev => { if (drag && ev.pointerId === drag.id) { ev.stopPropagation(); drag = null; mv.classList.remove("dragging"); } };
  mv.addEventListener("pointerup", endDrag, true);
  mv.addEventListener("pointercancel", endDrag, true);

  fetch(mv.dataset.tracks).then(r => r.json()).then(data => {
    D = data; range.max = D.loop; buildGround(); buildTable(); render(true);
    mv.addEventListener("load", () => { if (reduce) { mv.pause(); mv.currentTime = 9; } syncPlay(); render(true); });
    (function tick() { render(false); requestAnimationFrame(tick); })();
  });
})();
