(() => {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Full-screen menu
  const menu = document.getElementById("menu");
  if (menu) {
    const open = () => { menu.classList.add("open"); document.body.style.overflow = "hidden"; menu.querySelector("nav a")?.focus(); };
    const close = () => { menu.classList.remove("open"); document.body.style.overflow = ""; };
    document.querySelectorAll("[data-menu-open]").forEach(b => b.addEventListener("click", open));
    menu.querySelectorAll("[data-menu-close], nav a").forEach(b => b.addEventListener("click", close));
    document.addEventListener("keydown", e => { if (e.key === "Escape") close(); });
  }

  // Scroll reveals
  const items = document.querySelectorAll(".reveal");
  if (reduce || !("IntersectionObserver" in window)) {
    items.forEach(el => el.classList.add("in"));
  } else {
    const io = new IntersectionObserver(entries => entries.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
    }), { rootMargin: "0px 0px -8% 0px" });
    items.forEach(el => io.observe(el));
  }

  // 3D models: honour reduced motion, wire up pause buttons and the hero lock toggle
  document.querySelectorAll("model-viewer").forEach(mv => {
    if (reduce) { mv.removeAttribute("autoplay"); mv.removeAttribute("auto-rotate"); }
    const ground = mv.dataset.ground;
    if (ground) mv.addEventListener("load", () => {
      const m = mv.model?.materials.find(x => x.name === (mv.dataset.groundMat || "Material.001"));
      if (!m) return;
      if (ground === "none") { m.setAlphaMode("BLEND"); m.pbrMetallicRoughness.setBaseColorFactor([1, 1, 1, 0]); }
      else m.pbrMetallicRoughness.setBaseColorFactor(ground);
    });
  });

  document.querySelectorAll(".viewer-btn").forEach(btn => {
    const mv = btn.closest("model-viewer");
    const sync = () => { btn.textContent = mv.paused ? "Play" : "Pause"; };
    btn.addEventListener("click", () => { mv.paused ? mv.play() : mv.pause(); sync(); });
    ["play", "pause", "load"].forEach(ev => mv.addEventListener(ev, sync));
  });

  const lock = document.querySelector("[data-lock]");
  if (lock) {
    const mv = document.getElementById(lock.dataset.lock);
    const text = lock.querySelector("span");
    lock.addEventListener("click", () => {
      const on = !mv.classList.contains("unlocked");
      mv.classList.toggle("unlocked", on);
      on ? mv.setAttribute("camera-controls", "") : mv.removeAttribute("camera-controls");
      if (on) mv.removeAttribute("auto-rotate"); else if (!reduce) mv.setAttribute("auto-rotate", "");
      text.textContent = on ? "Back to scroll" : "Explore in 3D";
      lock.setAttribute("aria-pressed", on);
    });
  }
})();
