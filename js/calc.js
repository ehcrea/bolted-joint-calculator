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

  // ---------------- main ----------------
  function calculate(inp) {
    const issues = [];
    const add = (level, text) => issues.push({ level, text });
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
    const deltaS = dSK + dShank + dGew + dG + dM;

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
    const nInter = esv ? layers.length : layers.length - 1;
    const fZum = nThread * ev[0] + nBear * ev[1] + nInter * ev[2];
    const fZ = fZum / 1000;
    const FZ = fZ / (deltaS + deltaP);
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

    // ---- R5 / R13: assembly preload and tightening torque ----
    const dhb = washer ? washer[0] : dh;         // bore under the head bearing face
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
    if (washer) {
      pushP('Head on washer', dW, washer[0], wg.label, wg.pG, wg.est);
      const De = Math.min(washer[1], dW + 2 * washer[2]);
      pushP('Washer on ' + firstPlate.m.label, De, dh, firstPlate.m.label, firstPlate.m.pG, firstPlate.m.est);
    } else {
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
    if (layers.some(l => l.m && l.m.polymer) || (esv && strip.parent && strip.parent.polymer)) add('warn', 'Polymer parts creep and relax: the preload will drop over time. Use compression limiters (metal sleeves) in clamped polymer parts, metal inserts for threads, and re-check the torque after some hours.');
    if ((bc.stainless || bc.titanium) && layers.concat(strip.parent ? [{ m: strip.parent }] : []).some(l => l.m && (l.m.group === 'Aluminium' || l.m.group === 'Magnesium'))) add('info', 'Stainless or titanium fasteners in aluminium or magnesium: check galvanic corrosion in wet environments (<a href="https://ehcrea.github.io/galvanic-corrosion-checker/" target="_blank" rel="noopener">Galvanic Corrosion Checker</a>).');
    if (bc.stainless && inp.friction === 'ss-dry') add('warn', 'Dry stainless threads can gall (cold weld) during tightening. Use an anti-seize paste or a coated bolt.');
    if (DA > 0 && DA < dW) add('warn', 'D<sub>A</sub> is smaller than the head bearing diameter; the clamped part is treated as a sleeve.');
    if (lK / d < 1) add('info', 'Short clamp length (l<sub>K</sub>/d < 1): the joint is stiff, embedding losses are large relative to the bolt elongation. Consider a longer bolt with a spacer sleeve.');
    if (lK / d > 10) add('warn', 'Very long clamp length (l<sub>K</sub>/d > 10): the cone model and the resilience formulas lose accuracy.');
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
      thread: th, g, bc, sz, head, dW, dh, dhb, DKm, nut, washer, wg, nutWasher, layers, plates, lK, EP, alphaP, DA,
      esv, joint: inp.joint,
      res: { lSK, ls, lGew, lG, lM, EM, dSK, dShank, dGew, dG, dM, deltaS, deltaP, pr },
      n, PhiK, Phi,
      emb: { fZum, nThread, nBear, nInter, values: ev, shear }, fZ, FZ, dT, dFth, thLoss, thGain,
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

  const CALC = { calculate, threadGeometry, FMzul, torqueK, plateResilience, preloadVsFriction, fmtN, findThread, boltClass, STD_LENGTHS };
  if (typeof module !== 'undefined' && module.exports) module.exports = CALC;
  else root.BJ_CALC = CALC;
})(typeof window !== 'undefined' ? window : globalThis);
