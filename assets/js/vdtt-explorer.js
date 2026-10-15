/* VDTT explorer: interactive 3D schematic of the Variable Density Turbulence Tunnel with a
   cutaway onto the MoWiTO 0.6 model turbine, plus pressure / wind speed / TSR / pitch controls.

   Dimensions (metres):
   - VDTT (Bodenschatz et al., Rev. Sci. Instrum. 85, 093908, 2014): overall 18.2 long x 5.3 high; two straight
     cylinders 11.68 long, inner diameter 1.84; two 180-degree elbows, centreline radius 1.75, inner diameter 1.52;
     wall 20 mm; upper measurement section 8.8 long, about 1.5 wide x 1.3 high, corners cut (octagonal).
     Fan, heat exchanger, shroud, bypass: not modelled. Flanges, supports and mezzanine: from the photos (approximate).
   - MoWiTO 0.6: D = 0.60 (owner-confirmed); HubHt 0.52, HubRad 0.0385, Overhang -0.078 (rotor upwind), no tilt/precone,
     Twr2Shft 0.0385, 3 blades, chord and twist per station from OpenFAST
     Aerodyn/MoWiTO_original_BEM/MoWiTO_original_blade.dat. Spinner/nacelle/tower shapes from the photo (approximate).
   Gas: SF6 at 20 C, ideal-gas density with a linear compressibility correction calibrated to 8.7 t in 88 m3 at 15 bar
   (facility paper), mu = 1.53e-5 Pa s (from the owner's AeroDyn driver: 27.4686 kg/m3, nu = 5.57e-7 m2/s). */

const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
const ORBIT_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/OrbitControls.js';

const root = document.getElementById('vdtt');
if (root) {
  const io = new IntersectionObserver((es) => {
    if (es.some((e) => e.isIntersecting)) { io.disconnect(); boot().catch((err) => { console.error(err); fail(); }); }
  }, { rootMargin: '300px' });
  io.observe(root);
}
function fail() {
  const m = root.querySelector('.vx-msg');
  if (m) { m.textContent = 'The 3D view could not be loaded.'; m.hidden = false; }
}

/* ---------- physics (approximate) ---------- */
const R_ROTOR = 0.30, HUB_R = 0.0385, ROOT_R = 0.06;
const SF6 = { M: 0.14606, Rg: 8.314462, T: 293.15, mu: 1.53e-5, kz: (1 - 0.909) / 15 };
const rhoSF6 = (barAbs) => {
  const z = 1 - SF6.kz * barAbs;
  return (barAbs * 1e5 * SF6.M) / (z * SF6.Rg * SF6.T);
};
// blade stations: [span from root (m), twist (deg), chord (m)]  (MoWiTO_original_blade.dat)
const BL = [[0,21.94,.05124],[.01,18.53,.06868],[.02,16.70,.06953],[.03,14.76,.06723],[.04,12.93,.06447],[.05,11.27,.06157],
  [.06,9.85,.05875],[.07,8.58,.05604],[.08,7.41,.05346],[.09,6.48,.05106],[.10,5.57,.04886],[.11,4.79,.04683],[.12,4.17,.04496],
  [.13,3.58,.04322],[.14,3.05,.04159],[.15,2.58,.04004],[.16,2.18,.03852],[.17,1.83,.03696],[.18,1.50,.03532],[.19,1.22,.03346],
  [.20,.97,.03121],[.21,.76,.02838],[.22,.45,.02434],[.23,.19,.01822],[.24,.133,.003882]];
function chordAt(rOverR) {
  const span = rOverR * R_ROTOR - ROOT_R;
  for (let i = 0; i < BL.length - 1; i++) {
    if (span >= BL[i][0] && span <= BL[i + 1][0]) {
      const f = (span - BL[i][0]) / (BL[i + 1][0] - BL[i][0]);
      return BL[i][2] + f * (BL[i + 1][2] - BL[i][2]);
    }
  }
  return BL[BL.length - 1][2];
}
const C_REF = chordAt(0.72);

async function boot() {
  const THREE = await import(THREE_URL);
  const { OrbitControls } = await import(ORBIT_URL);

  const stage = root.querySelector('.vx-stage');
  const canvas = root.querySelector('canvas');
  const $ = (s) => root.querySelector(s);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let interacted = false;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 140);

  /* lights */
  scene.add(new THREE.HemisphereLight(0xdfe6ee, 0x2a2c2b, 1.25));
  const key = new THREE.DirectionalLight(0xffffff, 1.9); key.position.set(6, 10, 9); scene.add(key);
  const fill = new THREE.DirectionalLight(0xb8c8ff, 0.6); fill.position.set(-8, 3, -6); scene.add(fill);
  const lampIn = new THREE.PointLight(0xffffff, 3.2, 6, 1.6); lampIn.position.set(-0.4, 0.5, 0.2); scene.add(lampIn);

  /* materials */
  const M = {
    red: new THREE.MeshStandardMaterial({ color: 0xc5251b, roughness: 0.38, metalness: 0.15 }),
    inner: new THREE.MeshStandardMaterial({ color: 0x555c61, roughness: 0.85, side: THREE.BackSide }),
    blue: new THREE.MeshStandardMaterial({ color: 0x22408f, roughness: 0.5, metalness: 0.2 }),
    grey: new THREE.MeshStandardMaterial({ color: 0x9aa1a4, roughness: 0.6, metalness: 0.25 }),
    rail: new THREE.MeshStandardMaterial({ color: 0xc7ccce, roughness: 0.35, metalness: 0.6 }),
    floor: new THREE.MeshStandardMaterial({ color: 0x242826, roughness: 0.95 }),
    tunnel: new THREE.MeshStandardMaterial({ color: 0x59616a, roughness: 0.75, metalness: 0.2, side: THREE.DoubleSide }),
    alu: new THREE.MeshStandardMaterial({ color: 0xc3c8cb, roughness: 0.4, metalness: 0.35 }),
    white: new THREE.MeshStandardMaterial({ color: 0xeceee9, roughness: 0.4 }),
    black: new THREE.MeshStandardMaterial({ color: 0x18191a, roughness: 0.6 }),
    blade: new THREE.MeshStandardMaterial({ color: 0x2b3238, roughness: 0.45, metalness: 0.1, side: THREE.DoubleSide }),
  };
  const mk = (geo, mat, parent, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); (parent || scene).add(m); return m; };

  /* ---------- VDTT vessel ---------- */
  const vessel = new THREE.Group(); scene.add(vessel);
  const Y_LO = -3.5;                       // lower axis (upper axis at y = 0)
  const RO = 0.94, RI = 0.92;              // outer / inner radius of the 1.84 m vessel
  const L = 11.68, HALF = L / 2;
  const SEG = 40;
  // cylinder along +x; theta = 0 faces +z (viewer side)
  const cyl = (r, x0, x1, tStart = 0, tLen = Math.PI * 2, open = true, rad = SEG) => {
    const g = new THREE.CylinderGeometry(r, r, x1 - x0, rad, 1, open, tStart, tLen);
    g.rotateZ(-Math.PI / 2); g.translate((x0 + x1) / 2, 0, 0); return g;
  };
  const pair = (parent, x0, x1, tStart, tLen, y, mats) => {
    const a = mk(cyl(RO, x0, x1, tStart, tLen), mats[0], parent, 0, y, 0);
    const b = mk(cyl(RI, x0, x1, tStart, tLen), mats[1], parent, 0, y, 0);
    return [a, b];
  };
  const ALPHA = THREE.MathUtils.degToRad(150);      // cutaway opening angle
  const DOOR_X = 1.9;
  // straight cylinders. Upper: left / right fixed pieces + a middle with a cut-out + the removable door.
  const wallMats = [M.red, M.inner];
  pair(vessel, -HALF, -DOOR_X, 0, Math.PI * 2, 0, wallMats);
  pair(vessel, DOOR_X, HALF, 0, Math.PI * 2, 0, wallMats);
  pair(vessel, -DOOR_X, DOOR_X, ALPHA / 2, Math.PI * 2 - ALPHA, 0, wallMats);
  pair(vessel, -HALF, HALF, 0, Math.PI * 2, Y_LO, wallMats);
  // door (fades and slides out)
  const doorMats = [M.red.clone(), M.inner.clone()];
  doorMats.forEach((m) => { m.transparent = true; m.depthWrite = true; });
  const door = new THREE.Group(); vessel.add(door);
  pair(door, -DOOR_X, DOOR_X, -ALPHA / 2, ALPHA, 0, doorMats);
  // end caps of the straight cylinders, flanges
  const capMat = M.red;
  for (const sx of [-1, 1]) for (const y of [0, Y_LO]) {
    mk(new THREE.TorusGeometry(RO + 0.01, 0.06, 6, 40).rotateY(Math.PI / 2), capMat, vessel, sx * (HALF - 0.02), y, 0);
    mk(new THREE.TorusGeometry(RO + 0.01, 0.045, 6, 40).rotateY(Math.PI / 2), capMat, vessel, sx * (HALF - 0.9), y, 0);
  }
  // transition cone 1.84 -> 1.52, short 1.52 straight, then the 180-degree elbow (R = 1.75, d = 1.52)
  const RE_O = 0.77, RE_I = 0.75, RB = 1.75;
  for (const sx of [-1, 1]) {
    const x0 = sx * HALF, x1 = sx * (HALF + 0.4), x2 = sx * (HALF + 0.75);
    for (const y of [0, Y_LO]) {
      const cone = (r0, r1) => { const g = new THREE.CylinderGeometry(r1, r0, 0.4, SEG, 1, true); g.rotateZ(-Math.PI / 2 * sx); g.translate((x0 + x1) / 2, 0, 0); return g; };
      mk(cone(RO, RE_O), M.red, vessel, 0, y, 0);
      mk(cone(RI, RE_I), M.inner, vessel, 0, y, 0);
      mk(cyl(RE_O, Math.min(x1, x2), Math.max(x1, x2), 0, Math.PI * 2, true, 28), M.red, vessel, 0, y, 0);
    }
    // elbow: half torus about the centre (x2, Y_LO/2), arc from the upper axis to the lower axis on the outer side
    const tor = (r, mat) => {
      const g = new THREE.TorusGeometry(RB, r, 14, 28, Math.PI);
      g.rotateZ(sx > 0 ? -Math.PI / 2 : Math.PI / 2);
      return mk(g, mat, vessel, x2, Y_LO / 2, 0);
    };
    tor(RE_O, M.red);
    const ti = tor(RE_I, M.inner);
  }

  /* ---------- steel frame, mezzanine, floor ---------- */
  const FLOOR_Y = Y_LO - RO - 0.55;
  const box = (w, h, d, mat, x, y, z, parent) => mk(new THREE.BoxGeometry(w, h, d), mat, parent, x, y, z);
  for (const x of [-4.2, -1.4, 1.4, 4.2]) {
    for (const z of [-1.15, 1.15]) {
      box(0.2, -RO - 0.1 - FLOOR_Y, 0.2, M.blue, x, (FLOOR_Y + (-RO - 0.1)) / 2 + 0 - 0.05, z, vessel);      // columns
      box(0.4, 0.06, 0.4, M.blue, x, FLOOR_Y + 0.03, z, vessel);                                           // feet
    }
    box(0.18, 0.2, 2.5, M.blue, x, -RO - 0.1, 0, vessel);                                                  // upper saddle beam
    box(0.18, 0.2, 2.1, M.blue, x, Y_LO - RO - 0.12, 0, vessel);                                           // lower saddle beam
  }
  box(9.6, 0.16, 0.16, M.blue, 0, -RO - 0.1, 1.15, vessel);
  box(9.6, 0.16, 0.16, M.blue, 0, -RO - 0.1, -1.15, vessel);
  // mezzanine: platform along the upper section on the near side (+z), railings, a few columns
  const MZ_Y = -RO - 0.03;
  box(15.5, 0.08, 2.0, M.grey, 0.4, MZ_Y, 2.1, vessel);
  box(15.5, 0.05, 0.05, M.rail, 0.4, MZ_Y + 1.05, 3.08, vessel);
  box(15.5, 0.05, 0.05, M.rail, 0.4, MZ_Y + 0.55, 3.08, vessel);
  box(15.5, 0.05, 0.05, M.rail, 0.4, MZ_Y + 0.8, 3.08, vessel);
  for (let i = 0; i <= 15; i++) box(0.04, 1.05, 0.04, M.rail, -7.2 + i * 1.0 + 0.4, MZ_Y + 0.52, 3.08, vessel);
  for (const x of [-6.6, -3, 0.5, 4, 7.4]) box(0.16, MZ_Y - FLOOR_Y, 0.16, M.grey, x, (MZ_Y + FLOOR_Y) / 2, 3.0, vessel);
  box(15.5, 0.12, 0.12, M.grey, 0.4, MZ_Y - 0.1, 3.0, vessel);
  const floor = mk(new THREE.CircleGeometry(32, 48).rotateX(-Math.PI / 2), M.floor, scene, 0, FLOOR_Y - 0.001, 0);
  const grid = new THREE.GridHelper(64, 32, 0x3b403d, 0x2f3331); grid.position.y = FLOOR_Y + 0.002; grid.material.transparent = true; grid.material.opacity = 0.5; scene.add(grid);

  /* ---------- test section (octagonal, front face open) ---------- */
  const TS_L = 8.8, W2 = 0.75, H2 = 0.65, CUT = 0.35;
  const oct = [[W2, H2 - CUT], [W2, -(H2 - CUT)], [W2 - CUT, -H2], [-(W2 - CUT), -H2], [-W2, -(H2 - CUT)], [-W2, H2 - CUT], [-(W2 - CUT), H2], [W2 - CUT, H2]];
  // faces (index i -> i+1): 0 = +z side (hidden), 1 = lower +z chamfer (hidden), 2 bottom, 3 lower -z chamfer, 4 -z side, 5 upper -z chamfer, 6 top, 7 upper +z chamfer (hidden)
  const tsGroup = new THREE.Group(); vessel.add(tsGroup);
  {
    const pos = [], idx = [];
    [2, 3, 4, 5, 6].forEach((i) => {
      const a = oct[i], b = oct[(i + 1) % 8], n = pos.length / 3;
      pos.push(-TS_L / 2, a[1], a[0], TS_L / 2, a[1], a[0], TS_L / 2, b[1], b[0], -TS_L / 2, b[1], b[0]);
      idx.push(n, n + 1, n + 2, n, n + 2, n + 3);
    });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    mk(g, M.tunnel, tsGroup);
    // edges
    const eg = new THREE.EdgesGeometry(g, 20);
    tsGroup.add(new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ color: 0xa9aeaa, transparent: true, opacity: 0.45 })));
  }
  // turbulence-generating grid hint at the upstream end of the test section
  {
    const pos = [];
    for (let k = -3; k <= 3; k++) { pos.push(-TS_L / 2 + 0.02, k * 0.2, -0.75, -TS_L / 2 + 0.02, k * 0.2, 0.75); }
    for (let k = -4; k <= 4; k++) { pos.push(-TS_L / 2 + 0.02, -0.65, k * 0.18, -TS_L / 2 + 0.02, 0.65, k * 0.18); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    tsGroup.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x7f8581, transparent: true, opacity: 0.35 })));
  }

  /* ---------- MoWiTO 0.6 turbine (to scale) ---------- */
  const FLOOR_TS = -H2;                       // test-section floor
  const HUB_Y = FLOOR_TS + 0.52;               // HubHt 0.52
  const X_TOWER = 0, X_ROT = -0.078;           // overhang -0.078 (rotor upwind of the tower axis)
  const turbine = new THREE.Group(); tsGroup.add(turbine);
  // base plate + tower + nacelle
  box(0.22, 0.02, 0.22, M.alu, X_TOWER, FLOOR_TS + 0.01, 0, turbine);
  const towerTop = HUB_Y - 0.0385;
  mk(new THREE.CylinderGeometry(0.014, 0.017, towerTop - (FLOOR_TS + 0.02), 14), M.alu, turbine, X_TOWER, (towerTop + FLOOR_TS + 0.02) / 2, 0);
  const nac = new THREE.Group(); nac.position.set(X_ROT, HUB_Y, 0); turbine.add(nac);
  mk(new THREE.CylinderGeometry(0.0385, 0.0385, 0.22, 20).rotateZ(Math.PI / 2), M.alu, nac, 0.03 + 0.11, 0, 0);
  mk(new THREE.CylinderGeometry(0.0385, 0.0385, 0.08, 20).rotateZ(Math.PI / 2), M.black, nac, 0.29, 0, 0);
  // spinner (ogive), rotates with the rotor
  const rotor = new THREE.Group(); nac.add(rotor);
  {
    const Ls = 0.12;
    // lathe profile around the x axis: (radius, x)
    const prof = []; for (let i = 0; i <= 14; i++) { const t = i / 14; const r = HUB_R * Math.pow(Math.sin(t * Math.PI / 2), 0.62); prof.push(new THREE.Vector2(Math.max(r, 0.0005), -Ls * (1 - t) + 0.03)); }
    const g = new THREE.LatheGeometry(prof, 22); g.rotateZ(-Math.PI / 2);
    mk(g, M.white, rotor);
  }
  // blades
  function bladeGeometry() {
    const NP = 11, pos = [], idx = [];
    const prof = (s) => 5 * 0.12 * (0.2969 * Math.sqrt(s) - 0.126 * s - 0.3516 * s * s + 0.2843 * s ** 3 - 0.1015 * s ** 4);
    const loop = [];                    // closed section: upper surface LE->TE, lower surface TE->LE
    for (let i = 0; i <= NP; i++) { const s = i / NP; loop.push([s, prof(s)]); }
    for (let i = NP - 1; i >= 1; i--) { const s = i / NP; loop.push([s, -prof(s)]); }
    const n = loop.length;
    BL.forEach(([span, tw, c]) => {
      const th = THREE.MathUtils.degToRad(tw), ct = Math.cos(th), st = Math.sin(th);
      const r = ROOT_R + span;
      loop.forEach(([s, t]) => {
        const u = (s - 0.25) * c, v = t * c;
        pos.push(u * st + v * ct, r, u * ct - v * st);   // x (downstream), y (radial), z (towards trailing edge)
      });
    });
    for (let k = 0; k < BL.length - 1; k++) for (let j = 0; j < n; j++) {
      const a = k * n + j, b = k * n + (j + 1) % n, c2 = (k + 1) * n + j, d = (k + 1) * n + (j + 1) % n;
      idx.push(a, b, c2, b, d, c2);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    return g;
  }
  const bladeGeo = bladeGeometry();
  const rootGeo = new THREE.CylinderGeometry(0.012, 0.012, ROOT_R - HUB_R + 0.01, 10);
  const pitchGroups = [];
  for (let k = 0; k < 3; k++) {
    const holder = new THREE.Group(); holder.rotation.x = (k * 2 * Math.PI) / 3; rotor.add(holder);
    mk(rootGeo, M.alu, holder, 0, (HUB_R + ROOT_R) / 2, 0);
    const pg = new THREE.Group(); holder.add(pg); pitchGroups.push(pg);
    mk(bladeGeo, M.blade, pg);
  }

  /* ---------- flow particles (test section) ---------- */
  const NP_MAX = 1400, PX = 3.2;
  const pPos = new Float32Array(NP_MAX * 3), pVel = new Float32Array(NP_MAX);
  for (let i = 0; i < NP_MAX; i++) {
    pPos[i * 3] = (Math.random() * 2 - 1) * PX;
    pPos[i * 3 + 1] = (Math.random() * 2 - 1) * 0.58;
    pPos[i * 3 + 2] = (Math.random() * 2 - 1) * 0.68;
    pVel[i] = 0.85 + Math.random() * 0.3;
  }
  const pGeo = new THREE.BufferGeometry(); pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  const pMat = new THREE.PointsMaterial({ color: 0xe0c58a, size: 0.011, transparent: true, opacity: 0.85, depthWrite: false });
  const points = new THREE.Points(pGeo, pMat); points.frustumCulled = false; tsGroup.add(points);

  /* ---------- state, controls, readouts ---------- */
  const st = { P: 5, U: 3, tsr: 6, pitch: 0 };
  const ROT_SLOW = 1 / 20, FLOW_SLOW = 0.35;
  const el = {
    P: $('#vx-p'), U: $('#vx-u'), tsr: $('#vx-tsr'), pitch: $('#vx-pitch'),
    oP: $('#vx-o-p'), oU: $('#vx-o-u'), oRe: $('#vx-o-re'), oRpm: $('#vx-o-rpm'), oPitch: $('#vx-o-pitch'),
    vP: $('#vx-v-p'), vU: $('#vx-v-u'), vTsr: $('#vx-v-tsr'), vPitch: $('#vx-v-pitch'),
    needle: $('#vx-needle'), gaugeVal: $('#vx-gauge-val'), toggle: $('#vx-toggle'),
  };
  const sup = '⁰¹²³⁴⁵⁶⁷⁸⁹';
  const fmtRe = (re) => {
    const e = Math.floor(Math.log10(re)), m = re / 10 ** e;
    return `${m.toFixed(1)} × 10${String(e).split('').map((d) => (d === '-' ? '⁻' : sup[+d])).join('')}`;
  };
  const signed = (v, d = 1) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(d)}`;
  function applyState() {
    const rho = rhoSF6(st.P);
    // chord Reynolds number with the blade-relative speed at 0.72 R: U_rel = U * sqrt(1 + (TSR * r/R)^2)
    const re = (rho * st.U * Math.sqrt(1 + (st.tsr * 0.72) ** 2) * C_REF) / SF6.mu;
    const rpm = (st.tsr * st.U) / R_ROTOR * 60 / (2 * Math.PI);
    el.vP.textContent = `${st.P.toFixed(1)} bar`;
    el.vU.textContent = `${st.U.toFixed(1)} m/s`;
    el.vTsr.textContent = st.tsr.toFixed(1);
    el.vPitch.textContent = `${signed(st.pitch)}°`;
    el.oP.textContent = `${st.P.toFixed(1)} bar`;
    el.oU.textContent = `${st.U.toFixed(1)} m/s`;
    el.oRe.textContent = fmtRe(re);
    el.oRpm.textContent = `${Math.round(rpm).toLocaleString('en-US')} rpm`;
    el.oPitch.textContent = `${signed(st.pitch)}°`;
    el.gaugeVal.textContent = st.P.toFixed(1);
    el.needle.style.transform = `rotate(${-120 + (240 * (st.P - 0)) / 15}deg)`;
    pitchGroups.forEach((g) => { g.rotation.y = THREE.MathUtils.degToRad(st.pitch); });
    pGeo.setDrawRange(0, Math.round(120 + ((NP_MAX - 120) * (st.P - 1)) / 14));
    ['P', 'U', 'tsr', 'pitch'].forEach((k) => {
      const e = el[k]; e.style.setProperty('--fill', `${((e.value - e.min) / (e.max - e.min)) * 100}%`);
    });
    return rpm;
  }
  let rpm = 0;
  const bind = (k, key) => el[k].addEventListener('input', () => { st[key] = parseFloat(el[k].value); interacted = true; rpm = applyState(); kick(); });
  bind('P', 'P'); bind('U', 'U'); bind('tsr', 'tsr'); bind('pitch', 'pitch');
  ['P', 'U', 'tsr', 'pitch'].forEach((k) => { st[k === 'tsr' ? 'tsr' : k] = parseFloat(el[k].value); });
  st.P = parseFloat(el.P.value); st.U = parseFloat(el.U.value); st.tsr = parseFloat(el.tsr.value); st.pitch = parseFloat(el.pitch.value);

  /* ---------- camera / controls ---------- */
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.minDistance = 0.35; controls.maxDistance = 48; controls.maxPolarAngle = Math.PI / 2 + 0.3;
  controls.enableZoom = false; controls.zoomSpeed = 0.8;
  canvas.style.touchAction = 'pan-y';             // one-finger vertical drag scrolls the page
  const aspectScale = () => Math.max(1, 1.5 / camera.aspect);
  const VIEW = {
    out: () => ({ t: new THREE.Vector3(0, -1.9, 0), p: new THREE.Vector3(10, 3.4, 15.5).multiplyScalar(0.8 * aspectScale()).add(new THREE.Vector3(0, -1.9 * 0, 0)) }),
    in: () => { const t = new THREE.Vector3(0.04, HUB_Y + 0.02, 0); return { t, p: t.clone().add(new THREE.Vector3(-1.05, 0.35, 1.3).multiplyScalar(Math.max(1, 1.25 / camera.aspect))) }; },
  };
  let inside = false;
  { const v = VIEW.out(); camera.position.copy(v.p); controls.target.copy(v.t); camera.lookAt(v.t); }

  let tween = null, doorT = 0;                      // doorT: 0 closed -> 1 open
  function setDoor(t) {
    doorT = t;
    const o = 1 - Math.min(1, t * 1.4);
    doorMats.forEach((m) => { m.opacity = o; });
    door.visible = o > 0.01;
    door.position.z = 0.9 * t;
    lampIn.intensity = 3.2 * (0.4 + 0.6 * t);
  }
  function go(toInside, instant) {
    inside = toInside;
    el.toggle.setAttribute('aria-pressed', String(inside));
    el.toggle.querySelector('span').textContent = inside ? 'Show outside' : 'Show inside';
    const v = inside ? VIEW.in() : VIEW.out();
    if (instant) { camera.position.copy(v.p); controls.target.copy(v.t); setDoor(inside ? 1 : 0); return; }
    flying = true; resize(); last = 0;
    tween = { t0: performance.now(), dur: reduced ? 1 : 1500, p0: camera.position.clone(), t0v: controls.target.clone(), p1: v.p, t1: v.t, d0: doorT, d1: inside ? 1 : 0 };
    kick();
  }
  setDoor(0);
  el.toggle.addEventListener('click', () => { interacted = true; go(!inside); });
  const ease = (x) => x * x * (3 - 2 * x);

  /* wheel zoom only after the viewer has been clicked/touched, so the page still scrolls */
  let activeView = false;
  const setActive = (a) => { activeView = a; controls.enableZoom = a; stage.classList.toggle('is-active', a); };
  canvas.addEventListener('pointerdown', () => { interacted = true; setActive(true); kick(); });
  canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') setActive(false); });
  document.addEventListener('pointerdown', (e) => { if (!stage.contains(e.target)) setActive(false); });
  let controlsMoved = false;
  controls.addEventListener('change', () => { controlsMoved = true; kick(); });

  /* ---------- sizing (resolution capped at 1.25x, lowered automatically on slow devices) ---------- */
  let resScale = 1, slowFrames = 0, flying = false;
  function resize() {
    const w = Math.max(10, stage.clientWidth), h = Math.max(10, stage.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25) * resScale * (flying ? 0.7 : 1));
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix(); kick();
  }
  new ResizeObserver(resize).observe(stage);

  /* ---------- loop (only while visible) ---------- */
  let visible = true, raf = 0, last = 0, phi = 0.4;
  new IntersectionObserver((es) => { visible = es[0].isIntersecting; if (visible) { last = 0; kick(); } }).observe(stage);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { last = 0; kick(); } });
  // the particles and rotor are only visible through the cutaway, so animate only while it is open
  const motion = () => (!reduced || interacted) && visible && !document.hidden && doorT > 0.02;
  const FRAME_MIN = 1000 / 30;   // animate at up to 30 fps; camera moves still render immediately
  function kick() { if (!raf && visible) raf = requestAnimationFrame(frame); }
  function frame(now) {
    raf = 0;
    if (last && !tween && now - last < FRAME_MIN - 1 && !controlsMoved) { raf = requestAnimationFrame(frame); return; }
    controlsMoved = false;
    const dt = last ? Math.min(0.05, Math.max(0, (now - last) / 1000)) : 0; last = now;
    // adaptive resolution: if frames keep taking > 45 ms, render fewer pixels (down to 0.6x)
    if (!tween && dt > 0.045) { if (++slowFrames > 20 && resScale > 0.6) { resScale = Math.max(0.6, resScale - 0.2); slowFrames = 0; resize(); } } else slowFrames = Math.max(0, slowFrames - 1);
    if (tween) {
      const f = Math.max(0, Math.min(1, (performance.now() - tween.t0) / tween.dur)), e = ease(f);
      camera.position.lerpVectors(tween.p0, tween.p1, e); controls.target.lerpVectors(tween.t0v, tween.t1, e);
      setDoor(tween.d0 + (tween.d1 - tween.d0) * e);
      if (f >= 1) { tween = null; flying = false; resize(); }
    }
    const m = motion();
    if (m) {
      phi += (st.tsr * st.U / R_ROTOR) * ROT_SLOW * dt;
      const sp = st.U * FLOW_SLOW * dt, n = pGeo.drawRange.count;
      for (let i = 0; i < n; i++) { let x = pPos[i * 3] + sp * pVel[i]; if (x > PX) x -= 2 * PX; pPos[i * 3] = x; }
      pGeo.attributes.position.needsUpdate = true;
    }
    rotor.rotation.x = -phi;
    const changed = controls.update();
    renderer.render(scene, camera);
    if (m || tween || changed) raf = requestAnimationFrame(frame);
  }
  rpm = applyState();
  resize();
  // compile all shaders now (with the inside visible too), so the first fly-in doesn't stall
  setDoor(1); pGeo.setDrawRange(0, NP_MAX); renderer.compile(scene, camera);
  go(true, true); renderer.render(scene, camera);
  rpm = applyState();
  go(false, true);
  stage.classList.add('is-ready');
  const msg = root.querySelector('.vx-msg'); if (msg) msg.hidden = true;
  kick();
  root._vdtt = { go, st, camera, controls };
}
