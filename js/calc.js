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
  // Bolt positions for a circular or rectangular pattern, centred on the pattern centroid (mm).
  function patternBolts(inp) {
    const pts = [];
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
    return pts;
  }
  // Rigid-flange (bolt group) model. In-plane: direct shear F/n plus torsion Mz·r/Σr². Out of plane:
  //  - 'centroid': joint stays closed, bending about the bolt-group centroid: Fz/n + (Mx·y/Σy² − My·x/Σx²)
  //  - 'heel': flange tips about its edge after opening (prying not included): Fz/n + M·h/Σh², h = distance to the heel line
  // Loads: forces in kN, moments in N·m (converted to N and N·mm).
  function boltPattern(inp) {
    const pts = patternBolts(inp), n = pts.length;
    const Fx = (+inp.patFx || 0) * 1000, Fy = (+inp.patFy || 0) * 1000, Fz = (+inp.patFz || 0) * 1000;
    const Mx = (+inp.patMx || 0) * 1000, My = (+inp.patMy || 0) * 1000, Mz = (+inp.patMz || 0) * 1000;
    const Sx2 = pts.reduce((s, p) => s + p.x * p.x, 0), Sy2 = pts.reduce((s, p) => s + p.y * p.y, 0), Sr2 = Sx2 + Sy2;
    const method = inp.patMethod === 'heel' ? 'heel' : 'centroid';
    const Mb = Math.hypot(Mx, My);
    const u = Mb > 0 ? { x: -My / Mb, y: Mx / Mb } : { x: 0, y: 1 };      // direction towards the tension side
    let c = 0, Sh2 = 0;
    if (method === 'heel') {
      if (inp.patType === 'rect') c = Math.abs(u.x) * (+inp.patLx || 0) / 2 + Math.abs(u.y) * (+inp.patLy || 0) / 2;
      else c = (+inp.patDf || 0) / 2;
      const maxProj = Math.max(...pts.map(p => -(p.x * u.x + p.y * u.y)));
      c = Math.max(c, maxProj);                                              // heel at least at the outermost bolt
      Sh2 = pts.reduce((s, p) => s + Math.pow(p.x * u.x + p.y * u.y + c, 2), 0);
    }
    const bolts = pts.map((p, i) => {
      let FA;
      if (method === 'heel') { const h = p.x * u.x + p.y * u.y + c; FA = Fz / n + (Sh2 > 0 ? Mb * h / Sh2 : 0); p.h = h; }
      else FA = Fz / n + (Sy2 > 0 ? Mx * p.y / Sy2 : 0) - (Sx2 > 0 ? My * p.x / Sx2 : 0);
      const qx = Fx / n - (Sr2 > 0 ? Mz * p.y / Sr2 : 0), qy = Fy / n + (Sr2 > 0 ? Mz * p.x / Sr2 : 0);
      return { i: i + 1, x: p.x, y: p.y, h: p.h, FA, FAt: Math.max(0, FA), qx, qy, FQ: Math.hypot(qx, qy) };
    });
    const critA = bolts.reduce((a, b) => (b.FA > a.FA ? b : a), bolts[0]);
    let critQ = bolts.reduce((a, b) => (b.FQ > a.FQ ? b : a), bolts[0]);
    if (critA.FQ >= critQ.FQ * (1 - 1e-9)) critQ = critA;          // ties: report the max-tension bolt
    const ratio = Math.min(1, Math.max(0, +inp.patR || 0));
    return { n, bolts, method, Fx, Fy, Fz, Mx, My, Mz, Sx2, Sy2, Sr2, Sh2, c, u, Mb, critA, critQ,
      FAmax: Math.max(0, critA.FA), FQmax: critQ.FQ, ratio, sameBolt: critA.FQ >= critQ.FQ * (1 - 1e-9),
      compression: bolts.some(b => b.FA < 0) };
  }

  // ---------------- main ----------------
  function calculate(inp) {
    const issues = [];
    const add = (level, text) => issues.push({ level, text });
    // Bolt pattern: the most loaded bolt (envelope of max tension and max shear) is checked as the single bolt.
    let pat = null;
    if (inp.patOn) {
      pat = boltPattern(inp);
      inp = Object.assign({}, inp, { FAmax: pat.FAmax / 1000, FAmin: pat.ratio * pat.FAmax / 1000, FQ: pat.FQmax / 1000 });
      if (pat.n < 2) add('error', 'The bolt pattern needs at least two bolts.');
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
    const Phi = n * PhiK;

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
    const FZ0 = fZ / (deltaS0 + deltaP);                 // without any spring effect
    let FZ = fZ / (deltaS + deltaP);
    let springStage = null;
    if (lock && lock.key === 'conical' && !springAlways) {
      const stiff = deltaS0 + deltaP;
      const fToFlat = Math.max(0, FMmin - lock.Fflat) * stiff;   // settling taken while the washer is still flat
      if (fZ > fToFlat) {
        FZ = Math.max(0, FMmin - lock.Fflat) + (fZ - fToFlat) / (stiff + dC);
        springStage = { fToFlat };
      } else FZ = fZ / stiff;
    }
    const dT = +inp.dT || 0;
    const dFth = lK * (alphaP - bc.alpha) * dT / (deltaS + deltaP); // + = preload gain
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
    const FKerf = Math.max(FKQ, FKextra);
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
    const sigA = Phi * (FAmax - FAmin) / (2 * g.As);
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
    if (bc.stainless && inp.friction === 'ss-dry') add('warn', 'Dry stainless threads can gall (cold weld) during tightening. Use an anti-seize paste or a coated bolt.');
    if (DA > 0 && DA < dW) add('warn', 'D<sub>A</sub> is smaller than the head bearing diameter; the clamped part is treated as a sleeve.');
    // Clamp length ratio: a short, stiff bolt stretches little, so settling of a few µm costs much of the preload.
    // Common design rule (e.g. semiconductor equipment, vibration-loaded joints): l_K/d >= 3.
    const lKd = lK / d, fzShare = fmtN(Math.min(FZ / FMmin, 1) * 100, 0);
    if (lKd < 1) add('warn', 'Very short clamp length (l<sub>K</sub>/d = ' + fmtN(lKd, 2) + ' &lt; 1): the bolt stretches little, so embedding costs ' + fzShare + ' % of the minimum preload. Use a longer bolt with a spacer sleeve or a stiff washer stack to reach l<sub>K</sub>/d ≥ 3.');
    else if (lKd < 3) add('info', 'Short clamp length (l<sub>K</sub>/d = ' + fmtN(lKd, 2) + ' &lt; 3): embedding costs ' + fzShare + ' % of the minimum preload. A longer bolt with a spacer sleeve (l<sub>K</sub>/d ≥ 3) makes the preload less sensitive to settling and vibration.');
    if (lK / d > 10) add('warn', 'Very long clamp length (l<sub>K</sub>/d > 10): the cone model and the resilience formulas lose accuracy.');
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
      lock, lockKey, lockerUsed, nasa, pat, pry,
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

  const CALC = { calculate, boltPattern, patternBolts, threadGeometry, FMzul, torqueK, plateResilience, preloadVsFriction, fmtN, findThread, boltClass, STD_LENGTHS };
  if (typeof module !== 'undefined' && module.exports) module.exports = CALC;
  else root.BJ_CALC = CALC;
})(typeof window !== 'undefined' ? window : globalThis);
