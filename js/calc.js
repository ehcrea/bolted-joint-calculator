/* Bolted Joint Calculator: calculation engine.
 * Follows the procedure of VDI 2230 Part 1 (2015) for a single, concentrically loaded
 * bolted joint (steps R0 to R13), plus thread stripping checks for nuts, tapped holes,
 * helical coil inserts and solid threaded inserts.
 * Units: mm, N, N·mm, MPa (N/mm²). Inputs for forces are in kN and converted here.
 */
(function (root) {
  'use strict';
  const D = (typeof module !== 'undefined' && module.exports) ? require('./data.js') : root.BJ_DATA;
  const PI = Math.PI;
  const TAN30 = Math.tan(PI / 6);
  const STD_LENGTHS = [4, 5, 6, 8, 10, 12, 14, 16, 18, 20, 22, 25, 28, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 90,
    100, 110, 120, 130, 140, 150, 160, 180, 200, 220, 240, 260, 280, 300];
  const C3 = 0.9; // thread bending / tolerance reduction factor for stripping (simplified VDI C2·C3)

  // ---------------- geometry ----------------
  function threadGeometry(d, P) {
    const d2 = d - 0.649519 * P;        // pitch diameter
    const d3 = d - 1.226869 * P;        // minor diameter of the bolt
    const D1 = d - 1.082532 * P;        // minor diameter of the nut thread
    const ds = (d2 + d3) / 2;           // stress diameter
    return {
      d, P, d2, d3, D1, D2: d2, ds,
      As: PI / 4 * ds * ds,
      Ad3: PI / 4 * d3 * d3,
      AN: PI / 4 * d * d,
    };
  }

  function findThread(id) {
    return D.threadList().find(t => t.id === id) || D.threadList().find(t => t.id === 'M10');
  }

  function boltClass(key, d) {
    const c = D.BOLT_CLASSES[key] || D.BOLT_CLASSES['8.8'];
    const big = d > 16 && c.RpBig;
    return Object.assign({ key }, c, { Rp: big ? c.RpBig : c.Rp, Rm: big ? c.RmBig : c.Rm });
  }

  // Torque coefficient: MA = FM · K
  function torqueK(g, muG, muK, DKm) {
    return 0.16 * g.P + 0.58 * g.d2 * muG + muK * DKm / 2;
  }

  // Permissible assembly preload at utilisation nu of the yield point (VDI 2230 eq. R5)
  function FMzul(g, Rp, nu, muG) {
    const k = 1.5 * (g.d2 / g.ds) * (g.P / (PI * g.d2) + 1.155 * muG);
    return g.As * nu * Rp / Math.sqrt(1 + 3 * k * k);
  }

  // Plate resilience with the deformation cone / sleeve model (VDI 2230 eq. 5.1/39 to 5.1/45)
  function plateResilience(dW, dh, lK, DA, EP, esv) {
    const w = esv ? 2 : 1; // w = 1 through-bolt, w = 2 tapped thread joint
    const bL = lK / dW;
    const tanPhiOf = (y) => esv
      ? 0.348 + 0.013 * Math.log(bL) + 0.193 * Math.log(y)
      : 0.362 + 0.032 * Math.log(bL / 2) + 0.153 * Math.log(y);
    // DA large or not given: iterate y = DA,Gr / dW
    let tanPhi = Math.tan(30 * PI / 180);
    let DAGr = dW + w * lK * tanPhi;
    const DAeff0 = DA > 0 ? DA : Infinity;
    for (let i = 0; i < 30; i++) {
      const y = Math.max(1.0001, Math.min(DAeff0, DAGr) / dW);
      tanPhi = Math.max(0.2, tanPhiOf(y));
      DAGr = dW + w * lK * tanPhi;
    }
    let delta, model;
    if (DAeff0 >= DAGr) {
      model = 'cone';
      delta = 2 * Math.log(((dW + dh) * (dW + w * lK * tanPhi - dh)) / ((dW - dh) * (dW + w * lK * tanPhi + dh)))
        / (w * EP * PI * dh * tanPhi);
    } else if (DAeff0 > dW) {
      model = 'cone+sleeve';
      const DAx = DAeff0;
      const cone = 2 / (w * dh * tanPhi) * Math.log(((dW + dh) * (DAx - dh)) / ((dW - dh) * (DAx + dh)));
      const sleeve = 4 / (DAx * DAx - dh * dh) * (lK - (DAx - dW) / (w * tanPhi));
      delta = (cone + sleeve) / (EP * PI);
    } else {
      model = 'sleeve';
      delta = 4 * lK / (EP * PI * (DAeff0 * DAeff0 - dh * dh));
    }
    return { delta, tanPhi, phi: Math.atan(tanPhi) * 180 / PI, DAGr, model, w };
  }

  function stdLengthAtLeast(l) { return STD_LENGTHS.find(x => x >= l - 1e-9) || Math.ceil(l / 10) * 10; }
  function stdLengthAtMost(l) { let r = null; for (const x of STD_LENGTHS) if (x <= l + 1e-9) r = x; return r; }

  // ---------------- bolt pattern: load distribution over a rigid flange ----------------
  // Property class written in a bolt list: 8.8, 10.9, A2-70 / A4-70, A4-80, Ti5 (the library keys A2-50, A2-70, A4-80
  // cover both A2 and A4 grades).
  function normClass(t) {
    const u = String(t).toUpperCase().replace(',', '.');
    const alias = { 'A4-50': 'A2-50', 'A4-70': 'A2-70', 'A2-80': 'A4-80', 'TI5': 'Ti5', 'TI-5': 'Ti5', 'GR5': 'Ti5' };
    const k = alias[u] || u;
    return D.BOLT_CLASSES[k] ? k : null;
  }

  // Custom positions: one bolt per line, "x, y" (comma, semicolon, space or tab; pasted spreadsheet columns work).
  function parsePoints(text) {
    const pts = [], bad = [];
    // lines; a line holding several "x, y" pairs separated by ";" is split as well
    String(text || '').split(/\r?\n/).flatMap(l => (l.includes(',') && l.includes(';') ? l.split(';') : [l])).forEach((line, i) => {
      const s = line.replace(/#.*/, '').trim();
      if (!s) return;
      const tok = s.split(/[\s,;]+/).filter(Boolean);
      const m = tok.slice(0, 2).map(Number);
      let size = null, cls = null, ok = tok.length >= 2 && isFinite(m[0]) && isFinite(m[1]);
      // optional thread size (M6, M10x1.25) and property class (8.8, 12.9, A4-70, Ti5), in either order
      if (ok) tok.slice(2).forEach(t => {
        const id = t.replace(/^m/, 'M').replace(/[×X]/g, 'x');
        const th = /^M/.test(id) ? D.threadList().find(q => q.id === id) : null;
        const c = normClass(t);
        if (th && !size) size = th.id;
        else if (c && !cls) cls = c;
        else ok = false;
      });
      if (ok) { const p = { x: m[0], y: m[1] }; if (size) p.size = size; if (cls) p.cls = cls; pts.push(p); }
      else bad.push(i + 1);
    });
    return { pts, bad };
  }

  // Bolt positions for a circular, rectangular or custom pattern, centred on the bolt-group centroid (mm).
  // The returned array carries cx, cy: the centroid in the user's coordinates (0, 0 for circle and rect).
  function patternBolts(inp) {
    let pts = [];
    if (inp.patType === 'custom') {
      const pp = parsePoints(inp.patPts);
      const n = pp.pts.length;
      const cx = n ? pp.pts.reduce((s, p) => s + p.x, 0) / n : 0, cy = n ? pp.pts.reduce((s, p) => s + p.y, 0) / n : 0;
      pts = pp.pts.map(p => ({ x: p.x - cx, y: p.y - cy, size: p.size || null, cls: p.cls || null }));
      pts.cx = cx; pts.cy = cy; pts.bad = pp.bad;
      return pts;
    }
    if (inp.patType === 'rect') {
      const nx = Math.max(1, Math.round(+inp.patNx || 2)), ny = Math.max(1, Math.round(+inp.patNy || 2));
      const sx = Math.max(0, +inp.patSx || 0), sy = Math.max(0, +inp.patSy || 0);
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        if (inp.patPerimeter && nx > 2 && ny > 2 && i > 0 && i < nx - 1 && j > 0 && j < ny - 1) continue;
        pts.push({ x: (i - (nx - 1) / 2) * sx, y: ((ny - 1) / 2 - j) * sy });
      }
    } else {
      const n = Math.max(2, Math.round(+inp.patN || 4)), R = Math.max(0, +inp.patPCD || 0) / 2, a0 = (+inp.patAngle || 0) * PI / 180;
      for (let i = 0; i < n; i++) { const a = a0 + 2 * PI * i / n; pts.push({ x: R * Math.cos(a), y: R * Math.sin(a) }); }
    }
    pts.cx = 0; pts.cy = 0; pts.bad = [];
    return pts;
  }
  // Solve A·x = b (dense, Gaussian elimination with partial pivoting); returns null if singular.
  function solveLin(A, b) {
    const n = b.length, M = A.map((r, i) => r.concat([b[i]]));
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      if (Math.abs(M[p][c]) < 1e-300) return null;
      [M[c], M[p]] = [M[p], M[c]];
      for (let r = c + 1; r < n; r++) { const f = M[r][c] / M[c][c]; if (f) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
    }
    const x = new Array(n).fill(0);
    for (let r = n - 1; r >= 0; r--) { let s = M[r][n]; for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k]; x[r] = s / M[r][r]; }
    return x;
  }

  // Flexible flange: the flange is a beam along x (Euler-Bernoulli, EI = E·L_y·t³/12) on elastic supports, one per
  // bolt column (stiffness = number of bolts · k, k = 1/δ_S + 1/δ_P of one closed joint). The base is rigid.
  // Loads: F_z at x_F and the moment M_y. Returns the column forces, deflection line and flange bending moments.
  function flexBeam(pts, opt) {
    const { k, EI, Fz, My, xF, half } = opt;
    const cols = [];
    pts.forEach((p, i) => { let c = cols.find(q => Math.abs(q.x - p.x) < 1e-6); if (!c) cols.push(c = { x: p.x, idx: [] }); c.idx.push(i); });
    cols.sort((a, b) => a.x - b.x);
    if (cols.length < 2 || !(k > 0) || !(EI > 0)) return null;
    const xs = [-half, half, xF].concat(cols.map(c => c.x)).sort((a, b) => a - b);
    const nodes = xs.filter((x, i) => i === 0 || x - xs[i - 1] > 1e-6);
    const nodeOf = x => nodes.findIndex(v => Math.abs(v - x) <= 1e-6);
    const N = nodes.length, K = Array.from({ length: 2 * N }, () => new Array(2 * N).fill(0)), F = new Array(2 * N).fill(0);
    const ke = L => {
      const a = EI / (L * L * L);
      return [[12 * a, 6 * L * a, -12 * a, 6 * L * a], [6 * L * a, 4 * L * L * a, -6 * L * a, 2 * L * L * a],
        [-12 * a, -6 * L * a, 12 * a, -6 * L * a], [6 * L * a, 2 * L * L * a, -6 * L * a, 4 * L * L * a]];
    };
    for (let e = 0; e < N - 1; e++) {
      const m = ke(nodes[e + 1] - nodes[e]), dof = [2 * e, 2 * e + 1, 2 * e + 2, 2 * e + 3];
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) K[dof[i]][dof[j]] += m[i][j];
    }
    cols.forEach(c => { c.node = nodeOf(c.x); c.k = k * c.idx.length; K[2 * c.node][2 * c.node] += c.k; });
    const jF = nodeOf(xF);
    F[2 * jF] += Fz;
    F[2 * jF + 1] += -My;                       // a positive M_y lifts the −x side (same sign as the rigid model)
    const u = solveLin(K, F);
    if (!u) return null;
    cols.forEach(c => { c.w = u[2 * c.node]; c.R = c.k * c.w; });
    // bending moments at the element ends and the deflection line (Hermite shape functions)
    let Mmax = 0, xM = 0;
    const line = [];
    for (let e = 0; e < N - 1; e++) {
      const L = nodes[e + 1] - nodes[e], m = ke(L), ue = [u[2 * e], u[2 * e + 1], u[2 * e + 2], u[2 * e + 3]];
      const f = m.map(r => r[0] * ue[0] + r[1] * ue[1] + r[2] * ue[2] + r[3] * ue[3]);
      if (Math.abs(f[1]) > Mmax) { Mmax = Math.abs(f[1]); xM = nodes[e]; }
      if (Math.abs(f[3]) > Mmax) { Mmax = Math.abs(f[3]); xM = nodes[e + 1]; }
      const steps = 8;
      for (let s = (e === 0 ? 0 : 1); s <= steps; s++) {
        const t = s / steps, h1 = 1 - 3 * t * t + 2 * t * t * t, h2 = L * (t - 2 * t * t + t * t * t), h3 = 3 * t * t - 2 * t * t * t, h4 = L * (t * t * t - t * t);
        line.push({ x: nodes[e] + t * L, w: h1 * ue[0] + h2 * ue[1] + h3 * ue[2] + h4 * ue[3] });
      }
    }
    return { cols, nodes, line, Mmax, xM };
  }

  // Rigid-flange (bolt group) model. In-plane: direct shear F/n plus torsion Mz·r/Σr². Out of plane:
  //  - 'centroid': joint stays closed, bending about the bolt-group centroid: Fz/n + (Mx·y/Σy² − My·x/Σx²)
  //  - 'heel': flange tips about its edge after opening (prying not included): Fz/n + M·h/Σh², h = distance to the heel line
  // Loads: forces in kN, moments in N·m (converted to N and N·mm).
  // F_z acts at (x_F, y_F); its offset adds M_x = F_z·y_F and M_y = −F_z·x_F about the centroid.
  // stiff (optional) = { k } switches the rectangular pattern to the flexible-flange model along x.
  // wts (optional, mixed bolt sizes): { k: [...], A: [...] } per bolt. Tension is shared by the joint stiffness k
  // about the stiffness-weighted centroid, shear by the stress area A about the area-weighted centroid.
  // With equal weights both reduce to the formulas above.
  function boltPattern(inp, stiff, wts) {
    const pts = patternBolts(inp), n = pts.length;
    const Fx = (+inp.patFx || 0) * 1000, Fy = (+inp.patFy || 0) * 1000, Fz = (+inp.patFz || 0) * 1000;
    const xF = (+inp.patXF || 0) - pts.cx, yF = (+inp.patYF || 0) - pts.cy;      // relative to the centroid
    const Mx0 = (+inp.patMx || 0) * 1000, My0 = (+inp.patMy || 0) * 1000, Mz = (+inp.patMz || 0) * 1000;
    const Mx = Mx0 + Fz * yF, My = My0 - Fz * xF;
    const Sx2 = pts.reduce((s, p) => s + p.x * p.x, 0), Sy2 = pts.reduce((s, p) => s + p.y * p.y, 0), Sr2 = Sx2 + Sy2;
    const Sxy = pts.reduce((s, p) => s + p.x * p.y, 0);
    // Centroid model for any pattern: F_i = F_z/n + b·x_i + c·y_i with Σx²·b + Σxy·c = −M_y and Σxy·b + Σy²·c = M_x.
    // Bolts on one line cannot carry the moment about that line: only the component along the line is shared.
    const det = Sx2 * Sy2 - Sxy * Sxy;
    let bx = 0, cy_ = 0, lineDir = null, unresisted = 0;
    const method = inp.patMethod === 'heel' ? 'heel' : 'centroid';
    const Mb = Math.hypot(Mx, My);
    const u = Mb > 0 ? { x: -My / Mb, y: Mx / Mb } : { x: 0, y: 1 };      // direction towards the tension side
    if (Sr2 > 0 && det > 1e-9 * Sr2 * Sr2) { bx = (-My * Sy2 - Mx * Sxy) / det; cy_ = (Mx * Sx2 + My * Sxy) / det; }
    else if (Sr2 > 0) {
      const th = 0.5 * Math.atan2(2 * Sxy, Sx2 - Sy2), ex = Math.cos(th), ey = Math.sin(th);
      const Ss2 = pts.reduce((s, p) => s + Math.pow(p.x * ex + p.y * ey, 2), 0);
      const k = (-My * ex + Mx * ey) / Ss2;
      bx = k * ex; cy_ = k * ey; lineDir = { x: ex, y: ey };
      unresisted = Math.abs(My * ey + Mx * ex);
    } else unresisted = Math.hypot(Mx, My);
    let c = 0, Sh2 = 0;
    if (method === 'heel') {
      const maxProj = Math.max(...pts.map(p => -(p.x * u.x + p.y * u.y)));
      if (inp.patType === 'rect') c = Math.abs(u.x) * (+inp.patLx || 0) / 2 + Math.abs(u.y) * (+inp.patLy || 0) / 2;
      else if (inp.patType === 'custom') c = maxProj + Math.max(0, +inp.patEdge || 0);   // edge distance beyond the outermost bolt
      else c = (+inp.patDf || 0) / 2;
      c = Math.max(c, maxProj);                                              // heel at least at the outermost bolt
      Sh2 = pts.reduce((s, p) => s + Math.pow(p.x * u.x + p.y * u.y + c, 2), 0);
    }
    const bolts = pts.map((p, i) => {
      let FA;
      if (method === 'heel') { const h = p.x * u.x + p.y * u.y + c; FA = Fz / n + (Sh2 > 0 ? Mb * h / Sh2 : 0); p.h = h; }
      else FA = Fz / n + bx * p.x + cy_ * p.y;
      const qx = Fx / n - (Sr2 > 0 ? Mz * p.y / Sr2 : 0), qy = Fy / n + (Sr2 > 0 ? Mz * p.x / Sr2 : 0);
      return { i: i + 1, x: p.x, y: p.y, xu: p.x + pts.cx, yu: p.y + pts.cy, h: p.h, FA, FAt: Math.max(0, FA), qx, qy, FQ: Math.hypot(qx, qy) };
    });
    const mainId = findThread(inp.thread).id;
    bolts.forEach((b, i) => { b.size = pts[i].size || mainId; b.cls = pts[i].cls || inp.cls; b.type = b.size + ' ' + b.cls; });
    let weighted = null;
    if (wts) {
      const k = wts.k, A = wts.A, sum = a => a.reduce((s, v) => s + v, 0);
      const K = sum(k), xG = sum(pts.map((p, i) => k[i] * p.x)) / K, yG = sum(pts.map((p, i) => k[i] * p.y)) / K;
      const MxG = Mx - Fz * yG, MyG = My + Fz * xG;                       // moments moved to the stiffness centroid G
      let sxx = 0, syy = 0, sxy = 0;
      pts.forEach((p, i) => { const X = p.x - xG, Y = p.y - yG; sxx += k[i] * X * X; syy += k[i] * Y * Y; sxy += k[i] * X * Y; });
      const dt = sxx * syy - sxy * sxy, s2 = sxx + syy;
      let wb = 0, wc = 0, wUn = 0;
      if (s2 > 0 && dt > 1e-9 * s2 * s2) { wb = (-MyG * syy - MxG * sxy) / dt; wc = (MxG * sxx + MyG * sxy) / dt; }
      else if (s2 > 0) {
        const th = 0.5 * Math.atan2(2 * sxy, sxx - syy), ex = Math.cos(th), ey = Math.sin(th);
        const Ss2 = sum(pts.map((p, i) => k[i] * Math.pow((p.x - xG) * ex + (p.y - yG) * ey, 2)));
        const kk = (-MyG * ex + MxG * ey) / Ss2;
        wb = kk * ex; wc = kk * ey; wUn = Math.abs(MyG * ey + MxG * ex);
      } else wUn = Math.hypot(MxG, MyG);
      const Skh2 = method === 'heel' ? sum(bolts.map((b, i) => k[i] * b.h * b.h)) : 0;
      const AS = sum(A), xS = sum(pts.map((p, i) => A[i] * p.x)) / AS, yS = sum(pts.map((p, i) => A[i] * p.y)) / AS;
      const MzS = Mz - xS * Fy + yS * Fx;                                   // torsion moved to the area centroid S
      const J = sum(pts.map((p, i) => A[i] * ((p.x - xS) ** 2 + (p.y - yS) ** 2)));
      bolts.forEach((b, i) => {
        b.FAeq = b.FA; b.FQeq = b.FQ; b.k = k[i]; b.A = A[i];
        b.FA = method === 'heel' ? k[i] * Fz / K + (Skh2 > 0 ? Mb * k[i] * b.h / Skh2 : 0) : k[i] * (Fz / K + wb * (b.x - xG) + wc * (b.y - yG));
        b.FAt = Math.max(0, b.FA);
        const X = b.x - xS, Y = b.y - yS;
        b.qx = Fx * A[i] / AS - (J > 0 ? MzS * A[i] * Y / J : 0);
        b.qy = Fy * A[i] / AS + (J > 0 ? MzS * A[i] * X / J : 0);
        b.FQ = Math.hypot(b.qx, b.qy);
      });
      unresisted = method === 'centroid' ? wUn : 0;
      weighted = { K, xG, yG, MxG, MyG, sxx, syy, sxy, wb, wc, Skh2, AS, xS, yS, MzS, J };
    }
    // flexible flange (rectangular pattern, joint closed): x direction from the beam on elastic supports, y rigid
    let flex = null;
    if (stiff && inp.patType === 'rect' && method === 'centroid') {
      const mat = D.MATERIALS[(inp.plates && inp.plates[0] && inp.plates[0].mat) || 'S235'] || D.MATERIALS.S235;
      const t = +inp.patFt > 0 ? +inp.patFt : Math.max(0, +(inp.plates && inp.plates[0] && inp.plates[0].t) || 0);
      const b = +inp.patLy > 0 ? +inp.patLy : (Math.max(...pts.map(p => p.y)) - Math.min(...pts.map(p => p.y)) + 2 * (+inp.patSy || 20));
      const half = Math.max((+inp.patLx || 0) / 2, ...pts.map(p => Math.abs(p.x)), Math.abs(xF));
      const EI = mat.E * b * t * t * t / 12;
      const fb = flexBeam(pts, { k: stiff.k, EI, Fz, My: My0, xF, half });
      if (fb) {
        const W = b * t * t / 6, sig = fb.Mmax / W;
        flex = Object.assign(fb, { t, b, E: mat.E, EI, k: stiff.k, half, W, sig, mat, fAllow: mat.Rp || mat.Rm, brittle: !mat.Rp });
        bolts.forEach((bo, i) => {
          const c = fb.cols.find(q => q.idx.includes(i));
          bo.FArigid = bo.FA;
          bo.FA = c.R / c.idx.length + (Sy2 > 0 ? Mx * bo.y / Sy2 : 0);
          bo.FAt = Math.max(0, bo.FA);
        });
      }
    }
    const critA = bolts.reduce((a, b) => (b.FA > a.FA ? b : a), bolts[0]);
    let critQ = bolts.reduce((a, b) => (b.FQ > a.FQ ? b : a), bolts[0]);
    if (critA.FQ >= critQ.FQ * (1 - 1e-9)) critQ = critA;          // ties: report the max-tension bolt
    const ratio = Math.min(1, Math.max(0, +inp.patR || 0));
    const rigidMax = flex ? Math.max(0, ...bolts.map(b => b.FArigid)) : null;
    return { n, bolts, method, Fx, Fy, Fz, Mx, My, Mz, Mx0, My0, xF, yF, Sx2, Sy2, Sxy, Sr2, Sh2, det, bx, cy: cy_, lineDir, unresisted,
      custom: inp.patType === 'custom', cx0: pts.cx, cy0: pts.cy, bad: pts.bad, c, u, Mb, critA, critQ, flex, rigidMax, weighted, mainId,
      FAmax: Math.max(0, critA.FA), FQmax: critQ.FQ, ratio, sameBolt: critA.FQ >= critQ.FQ * (1 - 1e-9),
      compression: bolts.some(b => b.FA < 0) };
  }

  // Input for checking another bolt size of a mixed pattern with the same joint: length-type inputs that scale
  // with the bolt (engagement, custom hole) are scaled by d; a given torque belongs to the main bolt, so the
  // other sizes are tightened to the utilisation ν instead; insert outer threads fall back to their defaults.
  function sizeInput(inp, size, extra, cls) {
    const f = findThread(size).d / findThread(inp.thread).d;
    const o = Object.assign({}, inp, { thread: size, patOn: false }, cls ? { cls } : {}, extra || {});
    if (+inp.engage > 0) o.engage = +inp.engage * f;
    if (inp.holeFit === 'custom' && +inp.dhCustom > 0) o.dhCustom = +inp.dhCustom * f;
    o.insD = ''; o.insP = '';
    if (inp.mode === 'torque') o.mode = 'nu';
    return o;
  }

  // ---------------- main ----------------
  function calculate(inp) {
    const issues = [];
    const add = (level, text) => issues.push({ level, text });
    // Bolt pattern: the most loaded bolt (envelope of max tension and max shear) is checked as the single bolt.
    let pat = null;
    if (inp.patOn) {
      let stiff = null;
      const wantFlex = !!inp.patFlex;
      if (wantFlex && inp.patType === 'rect' && inp.patMethod !== 'heel') {
        // joint stiffness of one bolt from a plain single-bolt run (closed joint: bolt and parts in parallel)
        const one = calculate(Object.assign({}, inp, { patOn: false, pryOn: false, eccOn: false, nasa: false, FAmax: 0, FAmin: 0, FQ: 0 }));
        if (one.valid) stiff = { k: 1 / one.res.deltaS + 1 / one.res.deltaP, deltaS: one.res.deltaS, deltaP: one.res.deltaP };
      }
      // mixed bolt types (custom positions with a size and/or property class per line): weights from each type's
      // joint stiffness and stress area, and a full check of every type under its own highest loads
      const mainId = findThread(inp.thread).id, mainType = mainId + ' ' + inp.cls;
      const ptsS = patternBolts(inp);
      const typeOf = p => (p.size || mainId) + ' ' + (p.cls || inp.cls);
      const types = [...new Set(ptsS.map(typeOf))];
      const split = t => { const i = t.indexOf(' '); return { size: t.slice(0, i), cls: t.slice(i + 1) }; };
      const mixed = inp.patType === 'custom' && (types.length > 1 || types[0] !== mainType);
      let wts = null, plain = null;
      if (mixed && ptsS.length >= 2) {
        plain = {};
        types.forEach(t => { const q = split(t); plain[t] = calculate(sizeInput(inp, q.size, { pryOn: false, eccOn: false, nasa: false, FAmax: 0, FAmin: 0, FQ: 0 }, q.cls)); });
        if (types.every(t => plain[t].valid)) {
          const kOf = t => 1 / plain[t].res.deltaS + 1 / plain[t].res.deltaP;
          wts = { k: ptsS.map(p => kOf(typeOf(p))), A: ptsS.map(p => plain[typeOf(p)].g.As) };
        }
      }
      pat = boltPattern(inp, stiff, wts);
      if (stiff) pat.stiff = stiff;
      if (mixed) {
        pat.mixed = true;
        const clsOrder = Object.keys(D.BOLT_CLASSES);
        pat.mixedSize = new Set(ptsS.map(p => p.size || mainId)).size > 1 || !ptsS.some(p => (p.size || mainId) === mainId);
        pat.mixedClass = new Set(ptsS.map(p => p.cls || inp.cls)).size > 1 || !ptsS.some(p => (p.cls || inp.cls) === inp.cls);
        pat.groups = types.map(t => {
          const q = split(t), bs = pat.bolts.filter(b => b.type === t);
          const FA = Math.max(0, ...bs.map(b => b.FA)), FQ = Math.max(0, ...bs.map(b => b.FQ));
          return { type: t, size: q.size, cls: q.cls, d: findThread(q.size).d, main: t === mainType, bolts: bs, n: bs.length, FAmax: FA, FQmax: FQ,
            k: plain && plain[t].valid ? 1 / plain[t].res.deltaS + 1 / plain[t].res.deltaP : NaN, As: plain && plain[t].valid ? plain[t].g.As : NaN };
        }).sort((a, b) => a.d - b.d || (a.size < b.size ? -1 : a.size > b.size ? 1 : clsOrder.indexOf(a.cls) - clsOrder.indexOf(b.cls)));
        const mg = pat.groups.find(g => g.main);
        if (mg) { pat.FAmax = mg.FAmax; pat.FQmax = mg.FQmax; pat.critA = mg.bolts.reduce((a, b) => (b.FA > a.FA ? b : a), mg.bolts[0]); pat.critQ = mg.bolts.reduce((a, b) => (b.FQ > a.FQ ? b : a), mg.bolts[0]); pat.sameBolt = pat.critA === pat.critQ || pat.critA.FQ >= pat.critQ.FQ * (1 - 1e-9); if (pat.sameBolt) pat.critQ = pat.critA; }
        else add('warn', 'Mixed bolts: no bolt in the pattern is the ' + mainType + ' from section 1, so the detailed results below are for an ' + mainType + ' under the highest load of the pattern. Each bolt type used is checked in the table of the bolt pattern card; open one with “Check in detail”.');
        // full check of every other type under its own worst loads
        pat.groups.filter(g => !g.main).forEach(g => {
          const sub = calculate(sizeInput(inp, g.size, { FAmax: g.FAmax / 1000, FAmin: pat.ratio * g.FAmax / 1000, FQ: g.FQmax / 1000 }, g.cls));
          g.r = sub;
          if (!sub.valid) { add('error', g.type + ' bolts in the pattern: ' + ((sub.issues[0] || {}).text || 'no valid result')); return; }
          const bad = sub.checks.find(c => c.status === 'error'), warnC = sub.checks.find(c => c.status === 'warn');
          const badI = sub.issues.find(i => i.level === 'error');
          if (bad || badI) add('error', g.type + ' bolts in the pattern (' + g.n + '×) fail: ' + (bad ? bad.id + ' ' + bad.label : badI.text) + '. Open them with “Check in detail”.');
          else if (sub.status === 'warn') add('warn', g.type + ' bolts in the pattern (' + g.n + '×) need a check: ' + (warnC ? warnC.id + ' ' + warnC.label : (sub.issues.find(i => i.level === 'warn') || {}).text) + '.');
        });
        if (inp.mode === 'torque' && pat.groups.some(g => !g.main)) add('info', 'Mixed bolts: the given torque applies to the ' + mainType + ' bolts. The other bolt types are checked tightened to ν = ' + fmtN((+inp.nu || 0.9) * 100, 0) + ' % with their own torque (see the table).');
        if (pat.mixedClass && new Set(pat.groups.map(g => g.size)).size < pat.groups.length) add('info', 'Bolts of the same size but different property class look alike. Mark them (head marking, colour) and keep them apart in assembly, so a weaker bolt cannot end up in a position checked for a stronger one.');
      }
      if (wantFlex && !pat.flex) add('warn', 'Flexible flange: needs a rectangular pattern with at least two bolt columns along x, the centroid model (joint closed) and a flange thickness. The rigid model is used.');
      inp = Object.assign({}, inp, { FAmax: pat.FAmax / 1000, FAmin: pat.ratio * pat.FAmax / 1000, FQ: pat.FQmax / 1000 });
      if (pat.n < 2) add('error', 'The bolt pattern needs at least two bolts' + (pat.custom ? ': enter one bolt per line as x, y (mm).' : '.'));
      if (pat.bad && pat.bad.length) add('warn', 'Custom bolt positions: line ' + pat.bad.join(', ') + ' could not be read and is ignored. Enter x, y in mm, one bolt per line, optionally followed by a size and a property class such as M6, 12.9.');
      if (pat.method === 'centroid' && pat.unresisted > 1e-6 * (Math.abs(pat.Mx) + Math.abs(pat.My) + 1)) add('warn', 'Bolt pattern: all bolts lie on one line, so the moment about that line (' + fmtN(pat.unresisted / 1000, 1) + ' N·m) cannot be carried by bolt tension in the centroid model. It must be taken by contact at the flange edge: use the heel model or add bolts off the line.');
      if (!pat.sameBolt && pat.FQmax > 0 && pat.FAmax > 0) add('info', 'Bolt pattern: the highest tension (bolt ' + pat.critA.i + ') and the highest shear (bolt ' + pat.critQ.i + ') are on different bolts. Both maxima are applied to one bolt, which is conservative.');
      if (pat.method === 'centroid' && pat.compression && pat.Mb > 0) add('info', 'Bolt pattern: bending is taken about the bolt-group centroid, which assumes the joint stays closed (check that the residual clamp load stays positive). For a joint that may open, or for ultimate loads, use the heel model.');
    }
    const th = findThread(inp.thread);
    const g = threadGeometry(th.d, th.P);
    const d = g.d;
    const sz = D.SIZES[d];
    const bc = boltClass(inp.cls, d);
    const ES = bc.E;
    const esv = inp.joint !== 'nut';
    const head = inp.head === 'shcs' ? sz.shcs : sz.hex;
    const dW = head.dw;
    const holeIdx = { fine: 0, medium: 1, coarse: 2 }[inp.holeFit] ?? 1;
    const dh = inp.holeFit === 'custom' && inp.dhCustom > d ? +inp.dhCustom : sz.hole[holeIdx];
    const nut = sz.hex; // ISO 4032 nut

    // ---- prying of a T-stub or angle flange (Douty & McGuire elastic formula, as in Kulak, Fisher & Struik) ----
    //   Q/T = (1/2 − w·t⁴/(30·a·b²·A_b)) / ((a/b)·(a/(3b) + 1) + w·t⁴/(6·a·b²·A_b)),   a ≤ 1.25·b
    // a: bolt to flange edge (prying contact), b: bolt to web face / bend line, w: flange width per bolt, t: flange thickness.
    // The prying force adds to the external axial load on the bolt (as in ECSS-E-HB-32-23A).
    let pry = null;
    if (inp.pryOn) {
      const firstPlateMat = D.MATERIALS[(inp.plates && inp.plates[0] && inp.plates[0].mat) || 'S235'] || D.MATERIALS.S235;
      const t = +inp.pryT > 0 ? +inp.pryT : Math.max(0, +(inp.plates && inp.plates[0] && inp.plates[0].t) || 0);
      const a = Math.max(0, +inp.pryA || 0), b = Math.max(0, +inp.pryB || 0), w = Math.max(0, +inp.pryW || 0);
      if (a <= 0 || b <= 0 || w <= 0 || t <= 0) add('error', 'Prying: enter the edge distance a, the distance to the web b, the flange width per bolt w and the flange thickness t.');
      else {
        const aEff = Math.min(a, 1.25 * b);
        const Ab = g.As;
        const X = w * Math.pow(t, 4) / (aEff * b * b * Ab);
        const raw = (0.5 - X / 30) / ((aEff / b) * (aEff / (3 * b) + 1) + X / 6);
        const ratio = Math.max(0, raw);
        const T = (+inp.FAmax || 0) * 1000, Q = ratio * T;
        const Mbolt = Q * aEff, Mweb = Math.abs(T * b - Q * aEff);
        const wNet = Math.max(1e-6, w - dh);
        const sigBolt = 6 * Mbolt / (wNet * t * t), sigWeb = 6 * Mweb / (w * t * t);
        const brittle = firstPlateMat.Rp === null || firstPlateMat.Rp === undefined;
        const fAllow = brittle ? firstPlateMat.Rm : firstPlateMat.Rp;
        pry = { a, aEff, b, w, t, Ab, X, raw, ratio, T, Q, Mbolt, Mweb, wNet, sigBolt, sigWeb, mat: firstPlateMat, fAllow, brittle };
        inp = Object.assign({}, inp, { FAmax: (+inp.FAmax || 0) * (1 + ratio), FAmin: (+inp.FAmin || 0) * (1 + ratio) });
        if (a > 1.25 * b) add('info', 'Prying: the edge distance a is limited to 1.25·b = ' + fmtN(1.25 * b, 1) + ' mm, as is usual for the prying formula (a longer edge does not reduce prying further).');
        if (ratio > 0) add('info', 'Prying raises the axial load on the bolt by ' + fmtN(ratio * 100, 0) + ' % (Q = ' + fmtN(Q / 1000, 2) + ' kN on T = ' + fmtN(T / 1000, 2) + ' kN). A thicker flange or a bolt closer to the web reduces it.');
        else add('info', 'Prying: the flange is stiff enough that no prying force develops (Q = 0).');
        if (brittle) add('warn', 'Prying: the flange material (' + firstPlateMat.label + ') is brittle; flange bending is checked against R<sub>m</sub>. Avoid prying in cast iron flanges.');
      }
    }
    const fr = D.FRICTION[inp.friction] || D.FRICTION['oxide-oil'];
    const muGmin = fr.custom ? +inp.muGmin : fr.muG[0];
    const muGmax = fr.custom ? +inp.muGmax : fr.muG[1];
    const muKmin = fr.custom ? +inp.muKmin : fr.muK[0];
    const muKmax = fr.custom ? +inp.muKmax : fr.muK[1];
    const meth = D.TIGHTENING[inp.method] || D.TIGHTENING['tw-table'];
    const aA = inp.aA > 0 ? +inp.aA : meth.aA;
    const torqueMethod = ['tw-test', 'tw-table', 'power', 'impact'].includes(inp.method);

    // ---- layers of the clamped part (washers included) ----
    const washer = inp.washer && inp.washer !== 'none' ? (inp.washer === '7093' ? sz.w7093 : sz.w7089) : null;
    const wg = D.WASHER_GRADES[inp.washerGrade] || D.WASHER_GRADES['200HV'];
    const layers = [];
    // ---- locking element under the head (on top of the flat washer, if any) ----
    const lockKey = D.LOCKING[inp.lock] ? inp.lock : 'none';
    const lockDef = D.LOCKING[lockKey];
    let lock = null;
    if (lockKey === 'split' || lockKey === 'conical' || lockKey === 'wedge') {
      const ls_ = (D.LOCK_SIZES[d] || {})[lockKey];
      if (!ls_) add('warn', lockDef.short + ': no size for M' + fmtN(d) + ' in the library, so it is left out of the calculation.');
      else {
        const lm = bc.stainless ? { E: 193000, alpha: 16e-6 } : { E: 206000, alpha: 11.5e-6 };
        const conical = lockKey === 'conical';
        lock = { key: lockKey, def: lockDef, t: conical ? ls_[2] : ls_[0], D: conical ? ls_[0] : ls_[1], d1: sz.w7089[0], E: lm.E, alpha: lm.alpha };
        if (conical) { lock.h = ls_[1]; lock.travel = ls_[1] - ls_[2]; lock.Fflat = ls_[3]; lock.c = lock.Fflat / lock.travel; }
        layers.push({ kind: 'washer', lock: true, t: lock.t, E: lock.E, alpha: lock.alpha, label: lockDef.short, D: lock.D, d1: lock.d1 });
      }
    }
    if (washer) layers.push({ kind: 'washer', t: washer[2], E: wg.E, alpha: wg.alpha, label: 'Washer ISO ' + inp.washer, D: washer[1], d1: washer[0] });
    (inp.plates || []).forEach((p, i) => {
      const m = D.MATERIALS[p.mat] || D.MATERIALS.S235;
      layers.push({ kind: 'plate', t: Math.max(0, +p.t || 0), E: m.E, alpha: m.alpha, mat: p.mat, m, label: 'Part ' + (i + 1) + ': ' + m.label });
    });
    const nutWasher = !esv && washer && inp.washerNut;
    if (nutWasher) layers.push({ kind: 'washer', t: washer[2], E: wg.E, alpha: wg.alpha, label: 'Washer under nut', D: washer[1], d1: washer[0] });
    const plates = layers.filter(l => l.kind === 'plate');
    const lK = layers.reduce((s, l) => s + l.t, 0);
    if (!plates.length || lK <= 0) {
      return { valid: false, issues: [{ level: 'error', text: 'Add at least one clamped part with a thickness.' }] };
    }
    const EP = lK / layers.reduce((s, l) => s + l.t / l.E, 0);
    const alphaP = layers.reduce((s, l) => s + l.alpha * l.t, 0) / lK;

    // ---- R1: tightening factor (input) ----
    // ---- R5 / R13: assembly preload and tightening torque (independent of the resilience) ----
    const dhb = lock ? lock.d1 : washer ? washer[0] : dh;   // bore under the head bearing face
    const DKm = (dW + dhb) / 2;
    const Kmin = torqueK(g, muGmin, muKmin, DKm);
    const Kmax = torqueK(g, muGmax, muKmax, DKm);
    const nu = Math.min(1, Math.max(0.1, +inp.nu || 0.9));
    const FMzulNu = FMzul(g, bc.Rp, nu, muGmin);
    let FMmax, MA;
    if (inp.mode === 'torque' && +inp.MA > 0) {
      MA = +inp.MA * 1000;
      FMmax = MA / Kmin;
    } else {
      FMmax = FMzulNu;
      MA = FMmax * Kmin;
    }
    const FMatMuMax = MA / Kmax;
    let FMmin = FMmax / aA;
    if (torqueMethod) FMmin = Math.min(FMmin, FMatMuMax);
    const torqueParts = {
      pitch: 0.16 * g.P / Kmin, thread: 0.58 * g.d2 * muGmin / Kmin, head: muKmin * DKm / 2 / Kmin,
    };

    // ---- R3: bolt resilience ----
    const lSK = (inp.head === 'shcs' ? 0.4 : 0.5) * d;
    const ls = Math.min(Math.max(0, +inp.shank || 0), lK);
    const lGew = lK - ls;
    const lG = 0.5 * d;
    let EM, lM;
    if (!esv) { EM = ES; lM = 0.4 * d; }
    else if (inp.joint === 'insert') { EM = 205000; lM = 0.33 * d; }
    else { EM = (D.MATERIALS[inp.tapMat] || D.MATERIALS.S235).E; lM = 0.33 * d; }
    const dSK = lSK / (ES * g.AN);
    const dShank = ls / (ES * g.AN);
    const dGew = lGew / (ES * g.Ad3);
    const dG = lG / (ES * g.Ad3);
    const dM = lM / (EM * g.AN);
    // Conical spring washer: a spring in series with the bolt (linear secant to the flat point, an estimate).
    // If even F_M,max stays below its flat load it is a spring in every state; otherwise it is solid at assembly
    // and only becomes a spring once settling has brought the force down to F_flat (see the embedding below).
    const dC = lock && lock.key === 'conical' ? 1 / lock.c : 0;
    const springAlways = !!(lock && lock.key === 'conical' && FMmax < lock.Fflat);
    const deltaS0 = dSK + dShank + dGew + dG + dM;
    const deltaS = deltaS0 + (springAlways ? dC : 0);

    // ---- plate resilience ----
    const DA = +inp.DA > 0 ? +inp.DA : 0;
    if (DA > 0 && DA <= dh) add('error', 'The outer diameter of the clamped parts D<sub>A</sub> must be larger than the hole.');
    const pr = plateResilience(dW, dh, lK, DA > dh ? DA : 0, EP, esv);
    const deltaP = pr.delta;

    // ---- R3: load factor ----
    const n = Math.min(1, Math.max(0, inp.n ?? 0.5));
    const PhiK = deltaP / (deltaS + deltaP);
    let Phi = n * PhiK;

    // ---- eccentric clamping and loading (VDI 2230 Part 1, joint still closed) ----
    // Signs: s_sym (bolt axis) and a (load line) measured from the axis of the symmetric deformation body
    // (centre of the interface), positive towards the edge U where the joint would open first; u = distance to U.
    let ecc = null;
    if (inp.eccOn) {
      const cT = Math.max(0, +inp.eccC || 0), bT = Math.max(0, +inp.eccB || 0);
      if (cT <= 0 || bT <= 0) add('error', 'Eccentric case: enter the interface length c<sub>T</sub> and width b<sub>T</sub>.');
      else {
        const ssym = +inp.eccS || 0, aL = +inp.eccA || 0;
        const u = +inp.eccU > 0 ? +inp.eccU : cT / 2;
        const AD = bT * cT - PI / 4 * dh * dh;                                   // interface area
        const IBT = bT * Math.pow(cT, 3) / 12 - PI / 64 * Math.pow(dh, 4);       // its moment of inertia
        // equivalent bending inertia of the deformation body: cylinder with the same axial resilience as δ_P
        const Aers = lK / (EP * deltaP);
        const Ders = Math.sqrt(4 * Aers / PI + dh * dh);
        const Iers = PI / 64 * (Math.pow(Ders, 4) - Math.pow(dh, 4));
        const IBauto = !(+inp.eccI > 0);
        const IBers = IBauto ? Math.min(Iers, IBT) : +inp.eccI;
        const betaP = lK / (EP * IBers);                                        // bending resilience of the parts
        const dPstar = deltaP + ssym * ssym * betaP;                            // eccentric clamping
        const dPss = deltaP + ssym * aL * betaP;                                // eccentric loading
        const PhiEn = n * dPss / (deltaS + dPstar);
        // bending substitute length of the bolt referred to d_S (bending stiffness ∝ d⁴)
        const r4 = x => Math.pow(g.ds / x, 4);
        const lers = lSK * r4(d) + ls * r4(d) + lGew * r4(g.d3) + lG * r4(g.d3) + lM * r4(d);
        ecc = { cT, bT, ssym, a: aL, u, uAuto: !(+inp.eccU > 0), AD, IBT, Aers, Ders, Iers, IBers, IBauto, betaP, dPstar, dPss, PhiEn, PhiCon: n * PhiK, dP: deltaP, lers,
          MB: (+inp.eccMB || 0) * 1000 };
        Phi = PhiEn;
        if (Math.abs(ssym) > cT / 2 || Math.abs(aL) > cT) add('warn', 'Eccentric case: s<sub>sym</sub> or a lies outside the interface c<sub>T</sub>; check the geometry and the sign convention.');
        if (PhiEn < 0) add('warn', 'Eccentric case: the load factor Φ<sub>en</sub>* is negative (the load relieves the bolt); check the signs of s<sub>sym</sub> and a.');
        if (inp.pryOn) add('info', 'Prying and the eccentric case both describe a bending flange: using both counts the effect twice. Use one of them.');
      }
    }
    const deltaPe = ecc ? ecc.dPstar : deltaP;   // resilience of the parts for preload changes (eccentric clamping)

    // ---- R4: preload changes: embedding and temperature ----
    const shear = (+inp.FQ || 0) > 0;
    const emb = D.EMBEDDING[inp.rough] || D.EMBEDDING.medium;
    const ev = shear ? emb.shear : emb.axial;
    const nThread = 1 + (inp.joint === 'helicoil' || inp.joint === 'insert' ? 1 : 0);
    const nBear = esv ? 1 : 2;
    const nLockExtra = lock ? (lock.def.extraInterfaces || 0) : 0;   // split ends / cam faces: one more face
    const nInter = (esv ? layers.length : layers.length - 1) + nLockExtra;
    const fZum = nThread * ev[0] + nBear * ev[1] + nInter * ev[2];
    const fZ = fZum / 1000;
    // Preload lost to embedding, evaluated at F_M,min (the case that matters for the residual clamp load).
    const FZ0 = fZ / (deltaS0 + deltaPe);                // without any spring effect
    let FZ = fZ / (deltaS + deltaPe);
    let springStage = null;
    if (lock && lock.key === 'conical' && !springAlways) {
      const stiff = deltaS0 + deltaPe;
      const fToFlat = Math.max(0, FMmin - lock.Fflat) * stiff;   // settling taken while the washer is still flat
      if (fZ > fToFlat) {
        FZ = Math.max(0, FMmin - lock.Fflat) + (fZ - fToFlat) / (stiff + dC);
        springStage = { fToFlat };
      } else FZ = fZ / stiff;
    }
    const dT = +inp.dT || 0;
    const dFth = lK * (alphaP - bc.alpha) * dT / (deltaS + deltaPe); // + = preload gain
    const thLoss = Math.max(0, -dFth), thGain = Math.max(0, dFth);

    // ---- R2: required clamp load ----
    const FAmax = (+inp.FAmax || 0) * 1000;
    const FAmin = Math.min(FAmax, (+inp.FAmin || 0) * 1000);
    const FQ = (+inp.FQ || 0) * 1000;
    const muT = +inp.muT || 0.15;
    const qF = Math.max(1, Math.round(+inp.qF || 1));
    const SGreq = +inp.SGreq || 1.2;
    const FKQ = FQ > 0 ? FQ * SGreq / (qF * muT) : 0;
    const FKextra = (+inp.FKmin || 0) * 1000;
    // eccentric case: clamp load needed so that the joint does not open on one side (VDI 2230 F_KA)
    let FKA = 0;
    if (ecc) {
      const den = ecc.IBT / ecc.AD + ecc.ssym * ecc.u;
      FKA = den > 0 ? Math.max(0, (FAmax * (ecc.a * ecc.u - ecc.ssym * ecc.u) + ecc.MB * ecc.u) / den) : Infinity;
      ecc.FKA = FKA; ecc.den = den;
      if (!(den > 0)) add('error', 'Eccentric case: I<sub>BT</sub>/A<sub>D</sub> + s<sub>sym</sub>·u must be positive; the bolt is too far from the opening edge for this model.');
    }
    const FKerf = Math.max(FKQ, FKextra, isFinite(FKA) ? FKA : 0);
    const FPA = (1 - Phi) * FAmax;
    const FSA = Phi * FAmax;
    const FMerf = FKerf + FPA + FZ + thLoss;

    // ---- assembly stress (utilisation during tightening) ----
    const Wp = PI / 16 * Math.pow(g.ds, 3);
    const MG = FMmax * g.d2 / 2 * (g.P / (PI * g.d2) + 1.155 * muGmin);
    const sigM = FMmax / g.As;
    const tauM = MG / Wp;
    // utilisation consistent with VDI eq. R5 (torsion with the partly plastic factor 3/2 instead of 2)
    const FM100 = FMzul(g, bc.Rp, 1.0, muGmin);
    const nuActual = FMmax / FM100;
    const sigRedM = nuActual * bc.Rp;

    // ---- R6 / R8: working stress ----
    const FSmax = FMmax + FSA + thGain;
    const sigZ = FSmax / g.As;
    const ktau = 0.5;
    const sigRedB = Math.sqrt(sigZ * sigZ + 3 * Math.pow(ktau * tauM, 2));
    const SF = bc.Rp / sigRedB;

    // ---- residual clamp load, opening, slipping ----
    const FVmin = FMmin - FZ - thLoss;
    const FKRmin = FVmin - FPA;
    const SG = FQ > 0 ? FKRmin * qF * muT / FQ : Infinity;

    // ---- R9: fatigue (alternating stress) ----
    // eccentric loading: tension plus bending in the bolt, σ_SAb = [1 + (a/Φ_en* − s_sym)·(l_K/l_ers)·(E_S/E_P)·π·d_S³/(8·Ī_Bers)]·Φ_en*·F_A/A_S
    let bendFactor = 1;
    if (ecc && Math.abs(Phi) > 1e-9) {
      bendFactor = 1 + (ecc.a / Phi - ecc.ssym) * (lK / ecc.lers) * (ES / EP) * PI * Math.pow(g.ds, 3) / (8 * ecc.IBers);
      ecc.bendFactor = bendFactor;
      ecc.sigSAbo = bendFactor * Phi * FAmax / g.As; ecc.sigSAbu = bendFactor * Phi * FAmin / g.As;
      ecc.sigSAo = Phi * FAmax / g.As;
    }
    const sigA = Math.abs(bendFactor * Phi * (FAmax - FAmin) / (2 * g.As));
    const sigASV = 0.85 * (150 / d + 45);
    const F02 = g.As * bc.Rp;
    const FSm = FMmax + Phi * (FAmax + FAmin) / 2;
    const sigASG = Math.max(sigASV, (2 - FSm / F02) * sigASV);
    const sigAS = inp.rolledAfter ? sigASG : sigASV;
    const SD = sigA > 0 ? sigAS / sigA : Infinity;
    const SDreq = 1.2;

    // ---- R7: surface pressure ----
    const Fpress = Math.max(FMmax, FSmax);
    const pressures = [];
    const pushP = (where, dOut, dIn, mat, pG, est) => {
      const Ap = PI / 4 * (dOut * dOut - dIn * dIn);
      const p = Fpress / Ap;
      pressures.push({ where, dOut, dIn, Ap, p, pG, Sp: pG / p, mat, est });
    };
    const firstPlate = plates[0];
    const lastPlate = plates[plates.length - 1];
    if (lock) {
      // the hardened lock washer spreads the head load a little; it bears on the flat washer or the first part
      const De = Math.min(lock.D, dW + 2 * lock.t);
      if (washer) pushP(lock.def.short + ' on washer', De, washer[0], wg.label, wg.pG, wg.est);
      else pushP(lock.def.short + ' on ' + firstPlate.m.label, De, dh, firstPlate.m.label, firstPlate.m.pG, firstPlate.m.est);
    }
    if (washer) {
      if (!lock) pushP('Head on washer', dW, washer[0], wg.label, wg.pG, wg.est);
      const De = Math.min(washer[1], dW + 2 * washer[2]);
      pushP('Washer on ' + firstPlate.m.label, De, dh, firstPlate.m.label, firstPlate.m.pG, firstPlate.m.est);
    } else if (!lock) {
      pushP('Head on ' + firstPlate.m.label, dW, dh, firstPlate.m.label, firstPlate.m.pG, firstPlate.m.est);
    }
    if (!esv) {
      if (nutWasher) {
        pushP('Nut on washer', nut.dw, washer[0], wg.label, wg.pG, wg.est);
        const De = Math.min(washer[1], nut.dw + 2 * washer[2]);
        pushP('Washer on ' + lastPlate.m.label, De, dh, lastPlate.m.label, lastPlate.m.pG, lastPlate.m.est);
      } else {
        pushP('Nut on ' + lastPlate.m.label, nut.dw, dh, lastPlate.m.label, lastPlate.m.pG, lastPlate.m.est);
      }
    }

    // ---- thread stripping ----
    const Fbreak = g.As * bc.Rm;
    const tauBS = 0.6 * bc.Rm;
    const ASGSper = PI * g.D1 * (0.5 + (g.d2 - g.D1) * TAN30 / g.P); // bolt thread, per mm
    const ASGMper = (dd, PP, D2) => PI * dd * (0.5 + (dd - D2) * TAN30 / PP); // internal thread, per mm
    const strip = { modes: [] };
    let Le; // thread engagement length of the bolt
    if (!esv) {
      Le = nut.m;
      const meff = Le - g.P;
      const sd = nut.s / d;
      const C1 = Math.min(1, Math.max(0.5, 3.8 * sd - sd * sd - 2.61));
      const tauBM = 0.6 * bc.Rm; // nut of matching property class
      strip.meff = meff; strip.C1 = C1;
      strip.modes.push({ key: 'nut', label: 'Nut thread (ISO 4032, matching class)', F: tauBM * ASGMper(d, g.P, g.D2) * meff * C1 * C3, tau: tauBM, A: ASGMper(d, g.P, g.D2) * meff });
      strip.modes.push({ key: 'bolt', label: 'Bolt thread', F: tauBS * ASGSper * meff * C3, tau: tauBS, A: ASGSper * meff });
    } else {
      const pm = D.MATERIALS[inp.tapMat] || D.MATERIALS.S235;
      const tauBM = pm.ftau * pm.Rm;
      Le = Math.max(0, +inp.engage || 0);
      strip.parent = pm;
      if (inp.joint === 'tapped') {
        const meff = Math.max(0, Le - g.P);
        strip.meff = meff;
        strip.modes.push({ key: 'parent', label: 'Internal thread in ' + pm.label, F: tauBM * ASGMper(d, g.P, g.D2) * meff * C3, tau: tauBM, A: ASGMper(d, g.P, g.D2) * meff, per: tauBM * ASGMper(d, g.P, g.D2) * C3, offset: g.P });
        strip.modes.push({ key: 'bolt', label: 'Bolt thread', F: tauBS * ASGSper * meff * C3, tau: tauBS, A: ASGSper * meff, per: tauBS * ASGSper * C3, offset: g.P });
      } else if (inp.joint === 'helicoil') {
        // STI tapped hole for the coil: major diameter about d + 1.3 P, same pitch
        const dO = d + 1.299 * g.P, PO = g.P, D2O = dO - 0.649519 * PO;
        const meffO = Math.max(0, Le - 0.5 * PO);
        const meffI = Math.max(0, Le - 0.5 * g.P);
        strip.dO = dO; strip.PO = PO; strip.meff = meffI; strip.meffO = meffO;
        strip.modes.push({ key: 'parent', label: 'STI thread in ' + pm.label + ' (coil outer flanks)', F: tauBM * ASGMper(dO, PO, D2O) * meffO * C3, tau: tauBM, A: ASGMper(dO, PO, D2O) * meffO, per: tauBM * ASGMper(dO, PO, D2O) * C3, offset: 0.5 * PO });
        strip.modes.push({ key: 'bolt', label: 'Bolt thread in the coil', F: tauBS * ASGSper * meffI * C3, tau: tauBS, A: ASGSper * meffI, per: tauBS * ASGSper * C3, offset: 0.5 * g.P });
      } else {
        const dO = +inp.insD > d ? +inp.insD : d + 4;
        const PO = +inp.insP > 0 ? +inp.insP : 1.5;
        const D2O = dO - 0.649519 * PO;
        const meffO = Math.max(0, Le - PO);
        const meffI = Math.max(0, Le - g.P);
        const tauIns = 0.6 * 800; // steel insert body
        strip.dO = dO; strip.PO = PO; strip.meff = meffI; strip.meffO = meffO;
        strip.modes.push({ key: 'parent', label: 'Outer thread M' + fmtN(dO) + '×' + fmtN(PO) + ' in ' + pm.label, F: tauBM * ASGMper(dO, PO, D2O) * meffO * C3, tau: tauBM, A: ASGMper(dO, PO, D2O) * meffO, per: tauBM * ASGMper(dO, PO, D2O) * C3, offset: PO });
        strip.modes.push({ key: 'insert', label: 'Inner thread of the steel insert', F: tauIns * ASGMper(d, g.P, g.D2) * meffI * C3, tau: tauIns, A: ASGMper(d, g.P, g.D2) * meffI });
        strip.modes.push({ key: 'bolt', label: 'Bolt thread in the insert', F: tauBS * ASGSper * meffI * C3, tau: tauBS, A: ASGSper * meffI });
      }
    }
    const weakest = strip.modes.reduce((a, b) => (b.F < a.F ? b : a));
    strip.weakest = weakest;
    strip.Fbreak = Fbreak;
    strip.ratio = weakest.F / Fbreak;
    // required engagement length so that the parent thread is at least as strong as the bolt
    const parentMode = strip.modes.find(m => m.key === 'parent');
    if (parentMode && parentMode.per > 0) strip.LeReq = Fbreak / parentMode.per + parentMode.offset;

    // ---- bolt length ----
    let lenInfo;
    if (!esv) {
      const lReq = lK + nut.m + 2 * g.P;
      lenInfo = { lReq, lStd: stdLengthAtLeast(lReq), note: 'clamp length + nut height + 2 pitches protrusion' };
    } else {
      const lReq = lK + Le;
      const lStd = stdLengthAtMost(lReq + 0.5);
      lenInfo = { lReq, lStd, note: 'clamp length + engagement length (choose the hole depth deeper than the bolt end)' };
      if (lStd && lReq - lStd > 0.25 * Le) add('info', 'No standard length matches exactly: a ' + lStd + ' mm bolt gives ' + fmtN(lStd - lK) + ' mm engagement.');
    }

    // ---------------- checks ----------------
    const checks = [];
    const ck = (id, label, value, limit, ok, warn, unit, safety) => {
      const status = ok ? 'ok' : (warn ? 'warn' : 'error');
      checks.push({ id, label, value, limit, status, unit, safety });
      return status;
    };
    ck('R5', 'Assembly utilisation ν (equivalent stress / R<sub>p0.2</sub>)', nuActual * 100, '≤ 100 %', nuActual <= 0.905 || (inp.mode !== 'torque' && nuActual <= 1.0001), nuActual <= 1.0, '%');
    ck('R2', 'Minimum assembly preload F<sub>M,min</sub> ≥ F<sub>M,erf</sub>', FMmin / 1000, '≥ ' + fmtN(FMerf / 1000, 2) + ' kN', FMmin >= FMerf, false, 'kN', FMmin / FMerf);
    ck('R10', 'Residual clamp load F<sub>KR,min</sub> (joint must not open)', FKRmin / 1000, '> 0', FKRmin > 0, false, 'kN');
    if (FQ > 0) ck('R12', 'Safety against slipping S<sub>G</sub>', SG, '≥ ' + fmtN(SGreq, 2), SG >= SGreq, SG >= 1.0, '', SG);
    ck('R8', 'Working stress safety S<sub>F</sub> = R<sub>p0.2</sub> / σ<sub>red,B</sub>', SF, '≥ 1.0', SF >= 1.0, false, '', SF);
    if (sigA > 0) ck('R9', 'Fatigue safety S<sub>D</sub> = σ<sub>AS</sub> / σ<sub>a</sub>', SD, '≥ ' + SDreq, SD >= SDreq, SD >= 1.0, '', SD);
    for (const p of pressures) ck('R7', 'Surface pressure: ' + p.where, p.p, '≤ ' + fmtN(p.pG, 0) + ' MPa', p.Sp >= 1.0, p.Sp >= 0.9, 'MPa', p.Sp);
    if (pat && pat.flex) {
      const fx = pat.flex;
      ck('Pattern', 'Flange bending (flexible flange): σ = M<sub>max</sub> / W', fx.sig, '≤ ' + (fx.brittle ? 'R<sub>m</sub> ' : 'R<sub>p</sub> ') + fmtN(fx.fAllow, 0) + ' MPa', fx.sig <= fx.fAllow, false, 'MPa', fx.sig > 0 ? fx.fAllow / fx.sig : undefined);
    }
    if (ecc && isFinite(FKA)) ck('R10', 'No one-sided opening: F<sub>KR,min</sub> ≥ F<sub>KA</sub> (eccentric)', FKRmin / 1000, '≥ ' + fmtN(FKA / 1000, 2) + ' kN', FKRmin >= FKA, false, 'kN', FKA > 0 ? FKRmin / FKA : undefined);
    if (pry) {
      const lim = (pry.brittle ? 'R<sub>m</sub>' : 'R<sub>p</sub>') + ' = ' + fmtN(pry.fAllow, 0) + ' MPa';
      ck('Pry', 'Flange bending at the web face (prying)', pry.sigWeb, '≤ ' + lim, pry.sigWeb <= pry.fAllow, false, 'MPa', pry.fAllow / pry.sigWeb);
      if (pry.Q > 0) ck('Pry', 'Flange bending at the bolt line, net section (prying)', pry.sigBolt, '≤ ' + lim, pry.sigBolt <= pry.fAllow, false, 'MPa', pry.fAllow / pry.sigBolt);
    }
    ck('R13', 'Thread stripping: weakest thread ≥ bolt breaking load', weakest.F / 1000, '≥ ' + fmtN(Fbreak / 1000, 1) + ' kN', weakest.F >= Fbreak, weakest.F >= FSmax, 'kN', weakest.F / Fbreak);

    // ---------------- issues ----------------
    if (nuActual > 1.0) add('error', 'The bolt yields during tightening (utilisation ' + fmtN(nuActual * 100, 0) + ' %). Lower the torque or use a stronger property class.');
    else if (inp.mode === 'torque' && nuActual > 0.905) add('warn', 'The bolt is tightened above 90 % of its yield point. Fine for yield- or angle-controlled tightening only.');
    if (FMmin < FMerf) add('error', 'The minimum preload ' + fmtN(FMmin / 1000, 2) + ' kN is below the required ' + fmtN(FMerf / 1000, 2) + ' kN. Use a bigger or stronger bolt, a more accurate tightening method (lower α<sub>A</sub>), more bolts or a lower load.');
    if (FKRmin <= 0) add('error', 'The joint opens under the axial load: the residual clamp load is gone. Increase the preload or reduce the load per bolt.');
    if (FQ > 0 && SG < SGreq) add(SG >= 1 ? 'warn' : 'error', 'The transverse load can make the parts slip (S<sub>G</sub> = ' + fmtN(SG, 2) + '). Raise the preload, the interface friction or the number of bolts; or use dowel pins.');
    if (SF < 1) add('error', 'The bolt yields in service (S<sub>F</sub> = ' + fmtN(SF, 2) + '). Reduce the preload or the axial load, or use a stronger bolt.');
    if (sigA > 0 && SD < SDreq) add(SD >= 1 ? 'warn' : 'error', 'Fatigue: alternating stress ' + fmtN(sigA, 1) + ' MPa against an endurance limit of ' + fmtN(sigAS, 1) + ' MPa (S<sub>D</sub> = ' + fmtN(SD, 2) + '). Use a more elastic bolt (reduced shank, longer clamp length), lower n or Φ, or threads rolled after heat treatment.');
    for (const p of pressures) if (p.Sp < 1) add(p.Sp >= 0.9 ? 'warn' : 'error', 'Surface pressure too high: ' + p.where + ' ' + fmtN(p.p, 0) + ' MPa > p<sub>G</sub> ' + fmtN(p.pG, 0) + ' MPa. Use a (larger, hardened) washer, a flange head or a lower preload.');
    if (weakest.F < FSmax) add('error', 'Thread stripping: the ' + lcFirst(weakest.label) + ' strips (' + fmtN(weakest.F / 1000, 1) + ' kN) below the maximum bolt force (' + fmtN(FSmax / 1000, 1) + ' kN). Increase the engagement length or use a thread insert.');
    else if (weakest.F < Fbreak) add('warn', 'The ' + lcFirst(weakest.label) + ' would strip before the bolt breaks (' + fmtN(strip.ratio * 100, 0) + ' % of the breaking load). For a ductile, visible failure aim for ≥ 100 %' + (strip.LeReq ? ': engagement length ≥ ' + fmtN(strip.LeReq, 1) + ' mm' : '') + '.');
    if (esv && inp.joint === 'tapped' && strip.parent && strip.parent.Rm < 400 && strip.ratio < 1) add('info', 'In soft materials a Heli-Coil or a solid threaded insert moves the shear area to a larger diameter and is wear resistant for repeated assembly.');
    const pcb = layers.some(l => l.m && l.m.pcb);
    if (pcb) {
      add('warn', 'Printed circuit board in the clamp: FR-4 is soft through its thickness (E<sub>z</sub> ≈ 10 GPa, about 1/20 of steel) and creeps, more so above about 80 °C and near its glass transition T<sub>g</sub>. Solder mask and plating under the head settle and relax the preload. Clamp on bare copper or ENIG pads (a mask-free ring), use a washer or flange head, keep the torque moderate and keep strain-sensitive parts (MLCCs, BGAs) away from the mounting holes.');
      if (dT > 0) add('info', 'FR-4 expands about 60 ppm/K through its thickness below T<sub>g</sub> and about 250 ppm/K above it (not modelled). Heating raises the bolt force and the pressure on the board; above T<sub>g</sub> the laminate creeps and the preload drops when it cools again.');
    }
    if (esv && strip.parent && strip.parent.pcb) add('error', 'Do not tap threads into a PCB: use a nut, a standoff or a press-fit / SMD nut.');
    if (layers.some(l => l.m && l.m.polymer) || (esv && strip.parent && strip.parent.polymer)) add('warn', 'Polymer parts creep and relax: the preload will drop over time. Use compression limiters (metal sleeves) in clamped polymer parts, metal inserts for threads, and re-check the torque after some hours.');
    if ((bc.stainless || bc.titanium) && layers.concat(strip.parent ? [{ m: strip.parent }] : []).some(l => l.m && (l.m.group === 'Aluminium' || l.m.group === 'Magnesium'))) add('info', 'Stainless or titanium fasteners in aluminium or magnesium: check galvanic corrosion in wet environments (<a href="https://ehcrea.github.io/galvanic-corrosion-checker/" target="_blank" rel="noopener">Galvanic Corrosion Checker</a>).');
    // ---- galling (cold welding of the threads during tightening) ----
    const gall = gallingCheck();
    if (gall) add(gall.level, gall.text);
    if (DA > 0 && DA < dW) add('warn', 'D<sub>A</sub> is smaller than the head bearing diameter; the clamped part is treated as a sleeve.');
    // Clamp length ratio: a short, stiff bolt stretches little, so settling of a few µm costs much of the preload.
    // Common design rule (e.g. semiconductor equipment, vibration-loaded joints): l_K/d >= 3.
    const lKd = lK / d, fzShare = fmtN(Math.min(FZ / FMmin, 1) * 100, 0);
    if (lKd < 1) add('warn', 'Very short clamp length (l<sub>K</sub>/d = ' + fmtN(lKd, 2) + ' &lt; 1): the bolt stretches little, so embedding costs ' + fzShare + ' % of the minimum preload. Use a longer bolt with a spacer sleeve or a stiff washer stack to reach l<sub>K</sub>/d ≥ 3.');
    else if (lKd < 3) add('info', 'Short clamp length (l<sub>K</sub>/d = ' + fmtN(lKd, 2) + ' &lt; 3): embedding costs ' + fzShare + ' % of the minimum preload. A longer bolt with a spacer sleeve (l<sub>K</sub>/d ≥ 3) makes the preload less sensitive to settling and vibration.');
    if (lK / d > 10) add('warn', 'Very long clamp length (l<sub>K</sub>/d > 10): the cone model and the resilience formulas lose accuracy.');
    // Galling risk. Stainless steel and titanium have a thin oxide layer and harden fast; under thread pressure and
    // sliding the surfaces cold-weld, the torque jumps and the joint seizes before the preload is reached.
    // Risk = galling-prone bolt (stainless, titanium) × mating thread of a galling-prone material × lubrication.
    function gallingCheck() {
      const boltMat = bc.titanium ? 'titanium' : bc.stainless ? 'stainless' : null;
      if (!boltMat) return null;
      let mate = null, mateLabel = '';
      if (inp.joint === 'nut') { mate = boltMat; mateLabel = boltMat === 'titanium' ? 'a titanium nut' : 'a stainless nut (same property class)'; }
      else if (inp.joint === 'helicoil') { mate = 'stainless'; mateLabel = 'a Heli-Coil (stainless wire)'; }
      else if (inp.joint === 'tapped' && strip.parent) {
        const gp = strip.parent.group;
        if (gp === 'Stainless') { mate = 'stainless'; mateLabel = 'a tapped hole in ' + strip.parent.label; }
        else if (gp === 'Titanium') { mate = 'titanium'; mateLabel = 'a tapped hole in ' + strip.parent.label; }
      }
      const boltLabel = boltMat === 'titanium' ? 'Titanium bolt' : 'Stainless bolt';
      const fk = inp.friction;
      const lubed = ['ss-paste', 'ti-paste', 'mos2'].includes(fk);
      const locker = fk === 'locker-ss' || fk === 'locker-steel';
      const steelOnly = ['oxide-oil', 'zn-dry', 'zn-flake', 'al-oil', 'locker-steel'].includes(fk);
      const dry = !!(fr && fr.dry) || (fr && fr.custom && muGmax >= 0.2);
      const cure = 'Use an anti-seize paste (e.g. MoS<sub>2</sub>, nickel or PTFE based) on the thread and under the head, or a coated or silver-plated bolt; mix materials of different hardness (e.g. a Nitronic 60 or steel nut / coated Heli-Coil); tighten slowly and steadily (no impact or fast power drivers); do not reuse galled parts.';
      const pair = mate ? boltLabel.toLowerCase() + ' in ' + mateLabel : '';
      if (lubed) return null;
      if (steelOnly) return { level: 'warn', key: 'mismatch', text: 'Galling: the friction option “' + fr.label + '” is for steel bolts, but this is a ' + boltLabel.toLowerCase() + (mate ? ' in ' + mateLabel : '') + '. ' + (boltMat === 'titanium' ? 'Titanium' : 'Stainless steel') + ' galls (cold welds) when not lubricated, and its friction is higher and wider than these values. Choose a ' + boltMat + ' friction option. ' + cure };
      if (dry && mate) return { level: 'warn', key: 'dry-pair', text: 'High galling risk: ' + pair + ', threads not lubricated' + (fr && fr.custom ? ' (μ<sub>G,max</sub> = ' + fmtN(muGmax, 2) + ')' : '') + '. Like materials of this kind cold-weld under thread pressure: the torque jumps, the threads seize before the preload is reached, and the bolt may twist off. ' + cure };
      if (dry) return { level: 'warn', key: 'dry', text: 'Galling: ' + boltLabel.toLowerCase() + ' with dry threads' + (fr && fr.custom ? ' (μ<sub>G,max</sub> = ' + fmtN(muGmax, 2) + ')' : '') + ' can gall (cold weld) during tightening. ' + cure };
      if (locker && mate) return { level: 'info', key: 'locker', text: 'Galling: ' + pair + ' with a wet thread-locker. The locker lubricates only partly; with like materials, fine threads or fast tightening the threads can still gall. Tighten slowly, or use an anti-seize on the bearing face and a locking element instead.' };
      if (fr && fr.custom && mate) return { level: 'info', key: 'custom', text: 'Galling: ' + pair + '. Make sure the custom friction values belong to a lubricated thread (anti-seize paste or coating); dry, like materials of this kind gall.' };
      return null;
    }

    // ---- NASA-STD-5020 style check (optional) ----
    const nasa = inp.nasa ? nasaCheck() : null;
    function nasaCheck() {
      const num = (v, def) => (v === '' || v === null || v === undefined || !isFinite(+v)) ? def : +v;
      const dry = fr.custom || fr.dry || fr.locker;
      const GammaAuto = dry ? 0.35 : 0.25;
      const Gamma = num(inp.nGamma, 0) > 0 ? +inp.nGamma : GammaAuto;
      const tol = Math.max(0, num(inp.nTtol, 10)) / 100;
      const relax = Math.max(0, num(inp.nRelax, 5)) / 100;
      const TpvMin = Math.max(0, num(inp.nTpvMin, 0)) * 1000, TpvMax = Math.max(TpvMin, num(inp.nTpvMax, 0) * 1000);
      const FSy = num(inp.nFSy, 1.25), FSu = num(inp.nFSu, 1.4), FSsep = num(inp.nFSsep, 1.2), FSslip = num(inp.nFSslip, 1.2), FF = num(inp.nFF, 1.15);
      // nominal nut factor K = T / (F·d) at the mean friction coefficients
      const K = torqueK(g, (muGmin + muGmax) / 2, (muKmin + muKmax) / 2, DKm) / d;
      const Tnom = MA, Tmax = Tnom * (1 + tol), Tmin = Tnom * (1 - tol);
      // Prevailing (running) torque of a locking feature does not create preload. If the torque is specified
      // above the measured running torque, it is already excluded; otherwise subtract it (min / max crossed).
      const tpvAdded = !!inp.nTpvAdded;
      const Ppimax = (1 + Gamma) * Math.max(0, Tmax - (tpvAdded ? 0 : TpvMin)) / (K * d);
      const Ppimin = (1 - Gamma) * Math.max(0, Tmin - (tpvAdded ? 0 : TpvMax)) / (K * d);
      const Prelax = Math.max(relax * Ppimin, FZ);          // short-term relaxation, at least the VDI 2230 embedding
      const Ppmax = Ppimax + thGain;
      const Ppmin = Ppimin - Prelax - thLoss;
      const Pt = FAmax, Ps = FQ, nphi = Phi;
      const Pty = bc.Rp * g.As, Ptu = bc.Rm * g.As;
      const Psu = 0.6 * bc.Rm * g.Ad3;                      // threads in the shear plane (conservative)
      const Fstrip = strip.weakest ? strip.weakest.F : Infinity;
      const ms = (allow, load) => load > 0 ? allow / load - 1 : Infinity;
      const margins = [];
      const m = (key, label, allow, load, formula) => margins.push({ key, label, allow, load, MS: ms(allow, load), formula });
      m('sep', 'Separation', Math.max(0, Ppmin), FSsep * Pt * (1 - nphi), 'P<sub>p,min</sub> / (FS<sub>sep</sub>·P<sub>t</sub>·(1 − nφ))');
      m('yield', 'Bolt tension, yield', Pty, Ppmax + nphi * FF * FSy * Pt, 'A<sub>S</sub>·R<sub>p0.2</sub> / (P<sub>p,max</sub> + nφ·FF·FS<sub>y</sub>·P<sub>t</sub>)');
      m('ult', 'Bolt tension, ultimate', Ptu, FF * FSu * Pt, 'A<sub>S</sub>·R<sub>m</sub> / (FF·FS<sub>u</sub>·P<sub>t</sub>), preload neglected (ductile fastener)');
      m('strip', 'Thread shear-out, ultimate', Fstrip, FF * FSu * Pt, 'F<sub>strip,min</sub> / (FF·FS<sub>u</sub>·P<sub>t</sub>)');
      if (Ps > 0) {
        const avail = muT * qF * Math.max(0, Ppmin - (1 - nphi) * FSslip * Pt);
        m('slip', 'Slip', avail, FSslip * Ps, 'μ<sub>T</sub>·q<sub>F</sub>·(P<sub>p,min</sub> − (1 − nφ)·FS<sub>slip</sub>·P<sub>t</sub>) / (FS<sub>slip</sub>·P<sub>s</sub>)');
        m('shear', 'Bolt shear, ultimate', Psu, FF * FSu * Ps, '0.6·R<sub>m</sub>·A<sub>d3</sub> / (FF·FS<sub>u</sub>·P<sub>s</sub>), threads in the shear plane');
        if (Pt > 0) {
          const Rt = FF * FSu * Pt / Ptu, Rs = FF * FSu * Ps / Psu;
          margins.push({ key: 'inter', label: 'Tension + shear interaction, ultimate', allow: 1, load: Math.hypot(Rt, Rs), MS: 1 / Math.hypot(Rt, Rs) - 1, formula: '1 / √(R<sub>t</sub>² + R<sub>s</sub>²) (elliptical interaction)', Rt, Rs });
        }
      }
      const locked = (lock && lock.key !== 'split') || lockKey === 'locker' || fr.locker || TpvMax > 0;
      return { Gamma, GammaAuto, dry: !!dry, tol, relax, TpvMin, TpvMax, tpvAdded, FSy, FSu, FSsep, FSslip, FF, K, Tnom, Tmax, Tmin,
        Ppimax, Ppimin, Prelax, relaxFromVDI: FZ > relax * Ppimin, Ppmax, Ppmin, Pt, Ps, nphi, Pty, Ptu, Psu, Fstrip, margins, locked,
        worstMS: Math.min(...margins.map(x => x.MS)) };
    }
    if (nasa) {
      const neg = nasa.margins.filter(x => x.MS < 0);
      if (neg.length) add('error', 'NASA-STD-5020 check: negative margin of safety for ' + neg.map(x => x.label.toLowerCase() + ' (MS = ' + fmtN(x.MS, 2) + ')').join(', ') + '.');
      if (nasa.margins.find(x => x.key === 'yield').MS < 0 && nasa.Ppmax > 0.75 * nasa.Pty) add('info', 'With the preload uncertainty Γ = ±' + fmtN(nasa.Gamma * 100, 0) + ' % the maximum preload reaches ' + fmtN(nasa.Ppmax / nasa.Pty * 100, 0) + ' % of the bolt yield load. Aerospace joints are usually tightened to a lower nominal preload (often 50–75 % of yield), or the preload is measured to reduce Γ.');
      if (!nasa.locked) add('warn', 'NASA-STD-5020: fasteners in safety-critical joints need a locking feature (e.g. a prevailing-torque nut or insert, with its running torque measured at installation). Enter the prevailing torque or choose a locking element.');
      if (lock && lock.key === 'split') add('warn', 'NASA-STD-5020: a split lock washer is not a locking feature.');
      if (lockKey === 'locker' || fr.locker) add('info', 'NASA-STD-5020: liquid locking compound as the only locking feature needs approval and verification in most programmes; check your requirements.');
    }

    // ---- locking elements ----
    const fzLockUm = lock ? (1 + nLockExtra) * ev[2] : 0;
    if (lock && lock.key === 'split') add('warn', 'Split lock washers (DIN 127, withdrawn in 2003) do not secure a preloaded joint: they are pressed flat far below the preload and then only add contact faces that settle, here about ' + fmtN(fzLockUm, 1) + ' µm more embedding. VDI 2230 Part 1 advises against them (Junker vibration test, DIN 65151). Use enough preload, a thread-locker or a wedge-locking washer pair instead.');
    if (lock && lock.key === 'wedge') add('info', 'Wedge-locking washers stop the screw from turning loose under transverse vibration (tested to DIN 25201 / Junker test). They do not stop settling or creep: the preload loss is calculated as for a washer pair with one more contact face (' + fmtN(fzLockUm, 1) + ' µm). Dimensions are typical catalogue values.');
    if (lock && lock.key === 'conical') {
      const kept = FZ0 - FZ;
      const base = 'Conical spring washer (DIN 6796): flat at about ' + fmtN(lock.Fflat / 1000, 2) + ' kN, spring rate about ' + fmtN(lock.c / 1000, 0) + ' kN/mm (estimate, linearised). ';
      if (springAlways) add('info', base + 'It is not pressed flat by the preload, so it acts as a spring in series with the bolt: settling costs ' + fmtN(kept / 1000, 2) + ' kN less preload and the load factor drops to Φ<sub>K</sub> = ' + fmtN(PhiK, 2) + '.');
      else if (springStage) add('info', base + 'At F<sub>M,max</sub> it is pressed flat; once settling brings the force below the flat load it springs back and keeps ' + fmtN(kept / 1000, 2) + ' kN more preload than a plain washer.');
      else add('info', base + 'F<sub>M,min</sub> is so far above the flat load that settling never lets it spring back: here it works like a plain hardened washer. Choose a smaller or thinner spring washer, or a disc spring stack, to compensate settling.');
    }
    const lockerUsed = lockKey === 'locker' || fr.locker;
    if (lockKey === 'locker' && !fr.locker) add('info', 'Thread-locker selected: also pick a thread-locker friction entry, because the wet adhesive changes the friction during tightening and so the preload at a given torque.');
    if (lockerUsed) add('info', 'A cured thread-locker stops the screw from turning loose and seals the thread, but adds no preload and does not stop settling or creep. Stainless steel, aluminium and plated surfaces cure slowly: use an activator (primer). Most grades weaken above about 150 °C. Friction values for thread-lockers are estimates: use the supplier\'s torque-tension data.');

    if (inp.method === 'yield' || inp.method === 'angle') {
      if (inp.mode !== 'torque' && nu < 0.99) add('info', 'With yield- or angle-controlled tightening the bolt is tightened to its yield point: set ν = 1.0.');
    }
    if (thLoss > 0) add('info', 'Temperature change reduces the preload by ' + fmtN(thLoss / 1000, 2) + ' kN (bolt expands more than the clamped parts).');
    if (thGain > 0) add('info', 'Temperature change increases the bolt force by ' + fmtN(thGain / 1000, 2) + ' kN (clamped parts expand more than the bolt).');
    if (bc.stainless || bc.titanium) add('info', 'The fatigue limit formula of VDI 2230 is for heat-treated steel bolts; for ' + (bc.titanium ? 'titanium' : 'stainless') + ' bolts treat S<sub>D</sub> as indicative.');

    const worst = checks.some(c => c.status === 'error') || issues.some(i => i.level === 'error') ? 'error'
      : (checks.some(c => c.status === 'warn') || issues.some(i => i.level === 'warn') ? 'warn' : 'ok');

    return {
      valid: true, status: worst, issues, checks,
      thread: th, g, bc, sz, head, dW, dh, dhb, DKm, nut, washer, wg, nutWasher, layers, plates, lK, lKd, EP, alphaP, DA,
      esv, joint: inp.joint,
      res: { lSK, ls, lGew, lG, lM, EM, dSK, dShank, dGew, dG, dM, dC, springAlways, deltaS0, deltaS, deltaP, pr },
      lock, lockKey, lockerUsed, nasa, pat, pry, ecc, FKA, bendFactor, gall,
      n, PhiK, Phi,
      emb: { fZum, nThread, nBear, nInter, nLockExtra, values: ev, shear }, fZ, FZ, FZ0, springStage, dT, dFth, thLoss, thGain,
      FAmax, FAmin, FQ, muT, qF, SGreq, FKQ, FKextra, FKerf, FPA, FSA, FMerf,
      fr, muGmin, muGmax, muKmin, muKmax, meth, aA, torqueMethod, nu,
      Kmin, Kmax, FMzulNu, FMmax, FMmin, FMatMuMax, MA, torqueParts,
      Wp, MG, sigM, tauM, sigRedM, nuActual,
      FSmax, sigZ, ktau, sigRedB, SF,
      FVmin, FKRmin, SG,
      sigA, sigASV, sigASG, sigAS, SD, SDreq, FSm, F02,
      pressures, Fpress, strip, Le, lenInfo,
    };
  }

  // FM as a function of thread friction for a fixed torque (head friction scales with it)
  function preloadVsFriction(r, muFrom, muTo, steps) {
    const out = [];
    const ratio = r.muKmin / r.muGmin;
    for (let i = 0; i <= steps; i++) {
      const mu = muFrom + (muTo - muFrom) * i / steps;
      out.push({ mu, F: r.MA / torqueK(r.g, mu, mu * ratio, r.DKm) });
    }
    return out;
  }

  function lcFirst(s) { return s.charAt(0).toLowerCase() + s.slice(1); }

  function fmtN(x, dec) {
    if (!isFinite(x)) return '∞';
    if (dec === undefined) dec = Math.abs(x) >= 100 ? 0 : Math.abs(x) >= 10 ? 1 : 2;
    const s = x.toFixed(dec);
    return dec > 0 ? s.replace(/\.?0+$/, '') || '0' : s;
  }

  const CALC = { calculate, boltPattern, patternBolts, parsePoints, sizeInput, normClass, threadGeometry, FMzul, torqueK, plateResilience, preloadVsFriction, fmtN, findThread, boltClass, STD_LENGTHS };
  if (typeof module !== 'undefined' && module.exports) module.exports = CALC;
  else root.BJ_CALC = CALC;
})(typeof window !== 'undefined' ? window : globalThis);
