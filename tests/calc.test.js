/* Tests for the bolted joint calculation engine. Run: node tests/calc.test.js */
'use strict';
global.window = globalThis;
const D = require('../js/data.js');
const C = require('../js/calc.js');
require('../js/presets.js');
const P = globalThis.BJ_PRESETS;

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) pass++; else { fail++; console.error('FAIL: ' + msg); } }
function near(a, b, tol, msg) { ok(Math.abs(a - b) <= tol * Math.abs(b), `${msg}: ${a} vs ${b} (±${tol * 100} %)`); }

function stateFrom(overrides) {
  const s = Object.assign(JSON.parse(JSON.stringify(P.DEFAULT)), JSON.parse(JSON.stringify(overrides || {})));
  const fr = D.FRICTION[s.friction];
  if (fr && !fr.custom) { s.muGmin = fr.muG[0]; s.muGmax = fr.muG[1]; s.muKmin = fr.muK[0]; s.muKmax = fr.muK[1]; }
  if (s.joint === 'helicoil') s.engage = s.hcLen * C.findThread(s.thread).d;
  return s;
}

// ---- thread geometry against ISO 898-1 stress areas ----
const AS = { M3: 5.03, M4: 8.78, M5: 14.2, M6: 20.1, M8: 36.6, M10: 58.0, M12: 84.3, M16: 157, M20: 245, M24: 353, M30: 561, M36: 817, 'M10x1.25': 61.2, 'M12x1.5': 88.1 };
for (const [id, As] of Object.entries(AS)) {
  const t = C.findThread(id);
  near(C.threadGeometry(t.d, t.P).As, As, 0.006, 'stress area ' + id);
}

// ---- permissible assembly preload against VDI 2230 table A1 ----
{
  const t = C.findThread('M10'), g = C.threadGeometry(t.d, t.P);
  near(C.FMzul(g, 940, 0.9, 0.12) / 1000, 43.4, 0.01, 'FMzul M10 10.9 muG 0.12');
}
// higher friction lowers the permissible preload
{
  const t = C.findThread('M12'), g = C.threadGeometry(t.d, t.P);
  ok(C.FMzul(g, 640, 0.9, 0.08) > C.FMzul(g, 640, 0.9, 0.14), 'FMzul decreases with friction');
}
// property class 8.8 above M16 uses the higher yield
ok(C.boltClass('8.8', 20).Rp === 660 && C.boltClass('8.8', 16).Rp === 640, '8.8 yield by diameter');

// ---- utilisation in nu-mode equals nu ----
{
  const r = C.calculate(stateFrom({ nu: 0.9 }));
  near(r.nuActual, 0.9, 1e-6, 'utilisation equals nu');
}

// ---- plate resilience model regimes ----
{
  const a = C.plateResilience(15, 11, 24, 0, 210000, false);
  ok(a.model === 'cone' && a.delta > 0, 'large DA gives cone');
  const b = C.plateResilience(15, 11, 24, 20, 210000, false);
  ok(b.model === 'cone+sleeve' && b.delta > a.delta, 'limited DA gives cone + sleeve and more resilience');
  const c = C.plateResilience(15, 11, 24, 14, 210000, false);
  ok(c.model === 'sleeve', 'DA below dW gives sleeve');
  ok(a.phi > 15 && a.phi < 45, 'cone angle in a sensible range: ' + a.phi);
}

// ---- load factor and embedding are sensible ----
{
  const r = C.calculate(stateFrom({}));
  ok(r.PhiK > 0 && r.PhiK < 0.5, 'PhiK between 0 and 0.5 for a steel joint: ' + r.PhiK);
  ok(r.FZ > 0, 'embedding loss positive');
  near(r.FMmin * r.aA >= r.FMmax - 1e-6 ? 1 : 0, 1, 0, 'FMmin <= FMmax / alphaA');
}

// ---- longer engagement makes the tapped thread stronger; inserts beat plain tapping ----
{
  const base = { joint: 'tapped', thread: 'M8', tapMat: '6082T6', head: 'shcs', plates: [{ mat: '6082T6', t: 10 }] };
  const r1 = C.calculate(stateFrom(Object.assign({}, base, { engage: 8 })));
  const r2 = C.calculate(stateFrom(Object.assign({}, base, { engage: 16 })));
  const p1 = r1.strip.modes.find(m => m.key === 'parent').F, p2 = r2.strip.modes.find(m => m.key === 'parent').F;
  ok(p2 > 1.9 * p1, 'parent thread strength grows with engagement');
  const hc = C.calculate(stateFrom(Object.assign({}, base, { joint: 'helicoil', hcLen: 1 })));
  ok(hc.strip.modes.find(m => m.key === 'parent').F > p1, 'Heli-Coil parent shear area larger than plain tapping');
  ok(r1.strip.LeReq > 8 && r1.strip.LeReq < 30, 'required engagement in aluminium is plausible: ' + r1.strip.LeReq);
}

// ---- temperature: aluminium parts with a steel bolt gain preload when heated ----
{
  const r = C.calculate(stateFrom({ joint: 'tapped', tapMat: 'S235', plates: [{ mat: '6082T6', t: 20 }], dT: 50 }));
  ok(r.dFth > 0 && r.thGain > 0 && r.thLoss === 0, 'Al parts + steel bolt heated: preload gain');
  const r2 = C.calculate(stateFrom({ joint: 'tapped', tapMat: 'S235', plates: [{ mat: '6082T6', t: 20 }], dT: -40 }));
  ok(r2.thLoss > 0, 'Al parts + steel bolt cooled: preload loss');
}

// ---- washer lowers the pressure on the part ----
{
  const without = C.calculate(stateFrom({ washer: 'none' }));
  const withW = C.calculate(stateFrom({ washer: '7093' }));
  const pPartNo = without.pressures[0].p;
  const pPartW = withW.pressures.find(p => p.where.startsWith('Washer on')).p;
  ok(pPartW < pPartNo, 'washer reduces surface pressure on the clamped part');
}

// ---- fatigue: no alternating load gives infinite safety ----
{
  const r = C.calculate(stateFrom({ FAmin: 8, FAmax: 8 }));
  ok(!isFinite(r.SD), 'static load: no fatigue check');
}

// ---- torque mode reproduces the nu-mode torque ----
{
  const r = C.calculate(stateFrom({}));
  const r2 = C.calculate(stateFrom({ mode: 'torque', MA: r.MA / 1000 }));
  near(r2.FMmax, r.FMmax, 1e-9, 'torque mode inverse');
}

// ---- PCB: FR-4 is soft through its thickness, so the board dominates the joint stiffness ----
{
  const pcb = C.calculate(stateFrom(P.PRESETS.find(p => p.id === 'm3-pcb-standoff').s));
  ok(pcb.PhiK > 0.5, 'FR-4 board makes the load factor large: ' + pcb.PhiK);
  ok(pcb.issues.some(i => /circuit board/.test(i.text)), 'PCB warning shown');
  const steel = C.calculate(stateFrom(Object.assign({}, P.PRESETS.find(p => p.id === 'm3-pcb-standoff').s, { plates: [{ mat: 'S235', t: 1.6 }] })));
  ok(steel.res.deltaP < pcb.res.deltaP / 5, 'steel plate far stiffer than FR-4');
  const tapPcb = C.calculate(stateFrom({ joint: 'tapped', thread: 'M3', tapMat: 'FR4', plates: [{ mat: 'S235', t: 2 }] }));
  ok(tapPcb.issues.some(i => i.level === 'error' && /tap threads into a PCB/.test(i.text)), 'tapping into a PCB is an error');
}
// ---- small fasteners: embedding takes a large share of the preload ----
{
  const r = C.calculate(stateFrom(P.PRESETS.find(p => p.id === 'm4-sheet').s));
  ok(r.FZ / r.FMmin > 0.3, 'M4 in thin sheets loses a large share of preload to embedding: ' + (r.FZ / r.FMmin));
}

// ---- clamp length ratio l_K/d: short joints lose more preload to settling and are flagged ----
{
  const short = C.calculate(stateFrom({ plates: [{ mat: 'S235', t: 4 }] }));   // M10: 4 mm + washers
  const long = C.calculate(stateFrom({ plates: [{ mat: 'S235', t: 40 }] }));
  near(short.lKd, short.lK / 10, 1e-9, 'lKd = lK / d');
  ok(short.lKd < 1 && short.issues.some(i => i.level === 'warn' && /l<sub>K<\/sub>\/d/.test(i.text)), 'lK/d < 1 warns: ' + short.lKd);
  ok(long.lKd >= 3 && !long.issues.some(i => /l<sub>K<\/sub>\/d = /.test(i.text)), 'lK/d >= 3 gives no clamp-length note: ' + long.lKd);
  ok(short.FZ / short.FMmin > long.FZ / long.FMmin, 'shorter clamp length loses a larger share to embedding');
  const mid = C.calculate(stateFrom({ plates: [{ mat: 'S235', t: 20 }] }));
  ok(mid.lKd >= 1 && mid.lKd < 3 && mid.issues.some(i => i.level === 'info' && /l<sub>K<\/sub>\/d = /.test(i.text)), '1 <= lK/d < 3 gives a note: ' + mid.lKd);
}

// ---- locking elements ----
{
  const base = P.PRESETS.find(p => p.id === 'def-m3-bracket').s;
  const run = lock => C.calculate(stateFrom(Object.assign({}, base, { lock })));
  const none = run('none'), split = run('split'), conical = run('conical'), wedge = run('wedge');
  ok(split.FZ > none.FZ && split.issues.some(i => i.level === 'warn' && /DIN 127/.test(i.text)), 'split lock washer adds embedding and warns');
  ok(wedge.FZ > none.FZ && wedge.issues.some(i => /DIN 25201/.test(i.text)), 'wedge-lock pair adds a contact face and a note');
  ok(conical.FZ < 0.5 * none.FZ, 'conical spring washer compensates settling: ' + conical.FZ + ' vs ' + none.FZ);
  ok(split.lK > none.lK && conical.layers[0].label.startsWith('Conical'), 'lock washer is a layer under the head');
  ok(none.MA === split.MA || Math.abs(none.MA - split.MA) / none.MA < 0.05, 'lock washer barely changes the torque');
  // spring washer that is never flat: compliance in the bolt, lower load factor
  const soft = C.calculate(stateFrom(Object.assign({}, base, { lock: 'conical', mode: 'torque', MA: 0.3 })));
  ok(soft.res.springAlways && soft.res.deltaS > soft.res.deltaS0, 'unflattened spring washer adds bolt resilience');
  // thread-locker: friction entry changes the torque; note shown
  const lk = C.calculate(stateFrom(Object.assign({}, base, { lock: 'locker', friction: 'locker-ss' })));
  ok(lk.MA > none.MA && lk.issues.some(i => /activator/.test(i.text)), 'thread-locker friction raises the torque, note shown');
  const lkNoFr = C.calculate(stateFrom(Object.assign({}, base, { lock: 'locker' })));
  ok(lkNoFr.issues.some(i => /pick a thread-locker friction/.test(i.text)), 'thread-locker without its friction entry gives a hint');
  const m2 = C.calculate(stateFrom({ thread: 'M2', joint: 'tapped', engage: 4, plates: [{ mat: 'S235', t: 3 }], lock: 'wedge' }));
  ok(m2.valid && m2.issues.some(i => /no size for M2/.test(i.text)), 'missing lock washer size is reported, not fatal');
}

// ---- NASA-STD-5020 check ----
{
  const off = C.calculate(stateFrom({}));
  ok(off.nasa === null, 'NASA check off by default');
  const r = C.calculate(stateFrom({ nasa: true, lock: 'wedge' }));
  const N = r.nasa;
  ok(N && N.margins.length >= 4, 'NASA margins computed');
  near(N.Gamma, 0.25, 1e-9, 'Gamma auto 0.25 for oiled steel');
  ok(C.calculate(stateFrom({ nasa: true, friction: 'zn-dry' })).nasa.Gamma === 0.35, 'Gamma auto 0.35 for dry');
  ok(C.calculate(stateFrom({ nasa: true, nGamma: 0.1 })).nasa.Gamma === 0.1, 'Gamma user value');
  // preload range: (1 ± Γ)·T(1 ± tol) / (K d)
  near(N.Ppimax / N.Ppimin, (1.25 * 1.1) / (0.75 * 0.9), 1e-9, 'preload range ratio from Γ and torque tolerance');
  ok(N.Ppmin <= N.Ppimin - r.FZ + 1e-6, 'service preload includes at least the VDI embedding loss');
  // margins follow their definitions
  const sep = N.margins.find(m => m.key === 'sep');
  near(sep.MS, N.Ppmin / (1.2 * r.FAmax * (1 - r.Phi)) - 1, 1e-9, 'separation MS definition');
  const y = N.margins.find(m => m.key === 'yield');
  near(y.MS, r.bc.Rp * r.g.As / (N.Ppmax + r.Phi * 1.15 * 1.25 * r.FAmax) - 1, 1e-9, 'yield MS definition');
  const u = N.margins.find(m => m.key === 'ult');
  near(u.MS, r.bc.Rm * r.g.As / (1.15 * 1.4 * r.FAmax) - 1, 1e-9, 'ultimate MS definition');
  ok(N.margins.some(m => m.key === 'slip') && N.margins.some(m => m.key === 'inter'), 'slip and interaction checked with a transverse load');
  // higher preload: separation margin up, yield margin down
  const hi = C.calculate(stateFrom({ nasa: true, lock: 'wedge', nu: 0.6 })).nasa, lo = C.calculate(stateFrom({ nasa: true, lock: 'wedge', nu: 0.4 })).nasa;
  ok(hi.margins[0].MS > lo.margins[0].MS && hi.margins[1].MS < lo.margins[1].MS, 'preload trades separation margin against yield margin');
  // running torque: subtracted unless the torque is specified above it
  const tpv = C.calculate(stateFrom({ nasa: true, nTpvMin: 2, nTpvMax: 5 })).nasa;
  const tpvAdded = C.calculate(stateFrom({ nasa: true, nTpvMin: 2, nTpvMax: 5, nTpvAdded: true })).nasa;
  ok(tpv.Ppimin < tpvAdded.Ppimin && tpv.locked, 'running torque lowers the preload unless excluded; counts as locking');
  ok(r.issues.every(i => !/need a locking feature/.test(i.text)) && C.calculate(stateFrom({ nasa: true })).issues.some(i => /need a locking feature/.test(i.text)), 'locking feature required');
  const neg = C.calculate(stateFrom({ nasa: true, lock: 'wedge', FAmax: 60, FQ: 0 }));
  ok(neg.status === 'error' && neg.issues.some(i => /negative margin/.test(i.text)), 'negative margin is an error');
}

// ---- bolt pattern (rigid flange) ----
{
  // 6 bolts on Ø100, bolt 1 at 0°: Fz = 6 kN, Mx = 300 N·m → bolts at y = ±43.3 mm; Σy² = 7500 mm²
  const p = C.boltPattern({ patType: 'circle', patN: 6, patPCD: 100, patAngle: 0, patFz: 6, patMx: 300 });
  near(p.FAmax, 1000 + 300000 * 43.30127 / 7500, 1e-5, 'centroid model: max tension by hand');
  near(p.bolts.reduce((s, b) => s + b.FA, 0), 6000, 1e-9, 'tensions sum to Fz');
  near(p.bolts.reduce((s, b) => s + b.FA * b.y, 0), 300000, 1e-9, 'tension moments sum to Mx');
  // torsion: Mz = 150 N·m on r = 50 mm, 6 bolts → 150000 / (6·50) = 500 N per bolt, tangential
  const t = C.boltPattern({ patType: 'circle', patN: 6, patPCD: 100, patMz: 150 });
  ok(t.bolts.every(b => Math.abs(b.FQ - 500) < 1e-6 && Math.abs(b.qx * b.x + b.qy * b.y) < 1e-6), 'torsion gives equal tangential shear');
  near(t.bolts.reduce((s, b) => s + (b.x * b.qy - b.y * b.qx), 0), 150000, 1e-9, 'shear moments sum to Mz');
  // direct shear shared equally
  const q = C.boltPattern({ patType: 'rect', patNx: 2, patNy: 2, patSx: 60, patSy: 40, patFx: 4 });
  ok(q.bolts.every(b => Math.abs(b.FQ - 1000) < 1e-9), 'direct shear shared equally');
  // My: positive My puts the −x side in tension
  const m = C.boltPattern({ patType: 'rect', patNx: 3, patNy: 3, patSx: 50, patSy: 40, patPerimeter: true, patMy: 200 });
  ok(m.n === 8 && m.critA.x < 0, 'perimeter grid has 8 bolts; +My loads −x side');
  // heel model: moment about the flange edge
  const h = C.boltPattern({ patType: 'circle', patN: 6, patPCD: 100, patAngle: 0, patFz: 6, patMx: 300, patMethod: 'heel', patDf: 130 });
  near(h.bolts.reduce((s, b) => s + (b.FA - 1000) * b.h, 0), 300000, 1e-9, 'heel model: tension moments about the heel equal M');
  ok(h.bolts.every(b => b.FA >= 1000 - 1e-9), 'heel model: no bolt relieved below Fz/n');
  // hand-off to the single-bolt check
  const r = C.calculate(stateFrom({ patOn: true, patType: 'circle', patN: 6, patPCD: 100, patAngle: 0, patFz: 6, patMx: 300, patFx: 3, patR: 0.5 }));
  near(r.FAmax, p.FAmax, 1e-9, 'worst bolt tension used as FA,max');
  near(r.FAmin, 0.5 * p.FAmax, 1e-9, 'load ratio gives FA,min');
  near(r.FQ, 500, 1e-9, 'pattern shear used as FQ');
  ok(r.pat && r.pat.n === 6, 'pattern returned with the result');
}

// ---- prying (Douty & McGuire) ----
{
  const base = { FAmax: 8, FQ: 0, plates: [{ mat: 'S235', t: 10 }, { mat: 'S235', t: 12 }], pryOn: true, pryA: 30, pryB: 25, pryW: 60 };
  const r = C.calculate(stateFrom(base)), p = r.pry;
  const As = r.g.As, X = 60 * Math.pow(10, 4) / (30 * 625 * As);
  near(p.ratio, (0.5 - X / 30) / ((30 / 25) * (30 / 75 + 1) + X / 6), 1e-12, 'Q/T by hand');
  near(r.FAmax, 8000 * (1 + p.ratio), 1e-12, 'prying added to the bolt axial load');
  near(p.sigWeb, 6 * Math.abs(8000 * 25 - p.Q * 30) / (60 * 100), 1e-12, 'flange bending at the web face');
  ok(r.checks.some(c => /web face/.test(c.label)), 'flange bending check listed');
  const thick = C.calculate(stateFrom(Object.assign({}, base, { pryT: 30 }))).pry;
  const thin = C.calculate(stateFrom(Object.assign({}, base, { pryT: 6 }))).pry;
  ok(thick.ratio === 0 && thin.ratio > p.ratio, 'thicker flange: less prying, none when very stiff');
  const longA = C.calculate(stateFrom(Object.assign({}, base, { pryA: 80 }))).pry;
  ok(longA.aEff === 1.25 * 25, 'edge distance limited to 1.25 b');
  const thinFail = C.calculate(stateFrom(Object.assign({}, base, { pryT: 5 })));
  ok(thinFail.checks.some(c => /web face/.test(c.label) && c.status === 'error'), 'thin flange fails in bending');
  // with a pattern: prying acts on the most loaded bolt
  const pp = C.calculate(stateFrom(Object.assign({}, base, { patOn: true, patType: 'rect', patNx: 2, patNy: 2, patSx: 60, patSy: 40, patFz: 8 })));
  near(pp.FAmax, 2000 * (1 + pp.pry.ratio), 1e-12, 'prying on the pattern bolt load');
}

// ---- eccentric clamping and loading ----
{
  const base = { FAmax: 6, FQ: 0, plates: [{ mat: 'S235', t: 15 }, { mat: 'S235', t: 15 }] };
  const con = C.calculate(stateFrom(base));
  const z = C.calculate(stateFrom(Object.assign({}, base, { eccOn: true, eccC: 60, eccB: 40, eccS: 0, eccA: 0 })));
  near(z.Phi, con.Phi, 1e-12, 'eccentric s = a = 0 gives the concentric load factor');
  near(z.FZ, con.FZ, 1e-12, 'eccentric s = 0: embedding loss unchanged');
  near(z.bendFactor, 1, 1e-12, 'eccentric a = 0, s = 0: no bending factor');
  ok(z.ecc.FKA === 0, 'centric load: F_KA = 0');
  const e = z.ecc;
  near(e.AD, 60 * 40 - Math.PI / 4 * z.dh * z.dh, 1e-12, 'interface area A_D');
  near(e.IBT, 40 * 60 ** 3 / 12 - Math.PI / 64 * z.dh ** 4, 1e-12, 'interface inertia I_BT');
  const r = C.calculate(stateFrom(Object.assign({}, base, { eccOn: true, eccC: 60, eccB: 40, eccS: 5, eccA: 12 })));
  const E = r.ecc;
  near(E.dPstar, r.res.deltaP + 25 * E.betaP, 1e-12, 'delta_P* = delta_P + s^2 beta_P');
  near(E.dPss, r.res.deltaP + 60 * E.betaP, 1e-12, 'delta_P** = delta_P + s a beta_P');
  near(r.Phi, r.n * E.dPss / (r.res.deltaS + E.dPstar), 1e-12, 'Phi_en* formula');
  ok(r.Phi > con.Phi, 'load beyond the bolt raises the load factor');
  near(E.FKA, 6000 * (12 * 30 - 5 * 30) / (E.IBT / E.AD + 5 * 30), 1e-9, 'F_KA formula (u = c_T/2)');
  ok(r.FKerf >= E.FKA, 'F_KA enters the required clamp load');
  ok(r.bendFactor > 1, 'load further out than the bolt bends the bolt (factor > 1)');
  ok(r.checks.some(c => /eccentric/.test(c.label)), 'opening check listed');
  const ov = C.calculate(stateFrom(Object.assign({}, base, { eccOn: true, eccC: 60, eccB: 40, eccS: 5, eccA: 12, eccI: E.IBers * 4 })));
  ok(!ov.ecc.IBauto && ov.bendFactor < r.bendFactor, 'entered stiffer I_Bers: less bolt bending');
  const mb = C.calculate(stateFrom(Object.assign({}, base, { eccOn: true, eccC: 60, eccB: 40, eccS: 5, eccA: 12, eccMB: 20 })));
  ok(mb.ecc.FKA > E.FKA, 'extra bending moment raises F_KA');
  const bad = C.calculate(stateFrom(Object.assign({}, base, { eccOn: true, eccC: 0 })));
  ok(bad.issues.some(i => i.level === 'error'), 'missing interface size is an error');
}

// ---- every example computes, has no NaN and is not failing ----
for (const p of P.PRESETS) {
  const r = C.calculate(stateFrom(p.s));
  ok(r.valid, 'preset valid: ' + p.id);
  const nums = ['MA', 'FMmax', 'FMmin', 'FKRmin', 'SF', 'Phi', 'FZ'].map(k => r[k]);
  ok(nums.every(x => Number.isFinite(x)), 'preset numbers finite: ' + p.id);
  ok(r.status !== 'error', 'preset has no errors: ' + p.id + ' ' + r.issues.filter(i => i.level === 'error').map(i => i.text).join(' | '));
}

// ---- every thread and joint type computes ----
for (const t of D.threadList()) {
  for (const joint of ['nut', 'tapped', 'helicoil', 'insert']) {
    const r = C.calculate(stateFrom({ thread: t.id, joint, engage: 2 * t.d, insD: t.d + 6, insP: 1.5 }));
    ok(r.valid && Number.isFinite(r.MA) && r.MA > 0, `computes ${t.id} ${joint}`);
  }
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
