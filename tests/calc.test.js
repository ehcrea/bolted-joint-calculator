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

// ---- galling ----
{
  const g = o => C.calculate(stateFrom(Object.assign({ thread: 'M8', FAmax: 2, FQ: 0, plates: [{ mat: 'S235', t: 10 }, { mat: 'S235', t: 10 }] }, o))).gall;
  const key = o => { const r = g(o); return r ? r.level + ':' + r.key : null; };
  ok(key({ cls: 'A2-70', joint: 'nut', friction: 'ss-dry' }) === 'warn:dry-pair', 'galling: dry stainless bolt and nut');
  ok(key({ cls: 'A2-70', joint: 'helicoil', friction: 'ss-dry', tapMat: '5083' }) === 'warn:dry-pair', 'galling: dry stainless bolt in a Heli-Coil');
  ok(key({ cls: 'A2-70', joint: 'tapped', friction: 'ss-dry', tapMat: '1.4301' }) === 'warn:dry-pair', 'galling: dry stainless bolt tapped into stainless');
  ok(key({ cls: 'A2-70', joint: 'tapped', friction: 'ss-dry', tapMat: 'S235' }) === 'warn:dry', 'galling: dry stainless bolt into steel (milder message)');
  ok(key({ cls: 'A2-70', joint: 'helicoil', friction: 'zn-dry' }) === 'warn:mismatch', 'galling: stainless bolt with a steel friction option');
  ok(key({ cls: 'A2-70', joint: 'nut', friction: 'custom', muGmin: 0.25, muGmax: 0.40, muKmin: 0.2, muKmax: 0.3 }) === 'warn:dry-pair', 'galling: custom friction in the dry range');
  ok(key({ cls: 'A2-70', joint: 'nut', friction: 'custom', muGmin: 0.10, muGmax: 0.14, muKmin: 0.1, muKmax: 0.14 }) === 'info:custom', 'galling: custom lubricated friction, note only');
  ok(key({ cls: 'A2-70', joint: 'helicoil', friction: 'locker-ss' }) === 'info:locker', 'galling: thread-locker on stainless, note');
  ok(key({ cls: 'A2-70', joint: 'helicoil', friction: 'ss-paste' }) === null, 'galling: stainless with anti-seize, no message');
  ok(key({ cls: 'Ti5', joint: 'nut', friction: 'ti-dry' }) === 'warn:dry-pair', 'galling: dry titanium bolt and nut');
  ok(key({ cls: 'Ti5', joint: 'nut', friction: 'ti-paste' }) === null, 'galling: titanium with paste, no message');
  ok(key({ cls: '8.8', joint: 'nut', friction: 'zn-dry' }) === null, 'galling: steel bolt, no message');
  ok(D.FRICTION['ti-dry'] && D.FRICTION['ti-dry'].dry, 'dry titanium friction option exists');
}

// ---- custom bolt positions ----
{
  const pp = C.parsePoints('0, 0\n60\t0\n# comment\n120 0\nabc\n0,50; 0,100');
  ok(pp.pts.length === 5 && pp.bad.length === 1, 'custom positions: comma, tab, space, ";" pairs and comments read; bad line reported');
  const base = { patOn: true, patR: 0, FQ: 0 };
  // a 3 x 2 grid entered as custom positions (shifted origin) gives the rectangular result
  const rectS = Object.assign({}, base, { patType: 'rect', patNx: 3, patNy: 2, patSx: 50, patSy: 40, patPerimeter: false, patFz: 6, patMx: 80, patMy: -40, patFx: 1, patMz: 30, patXF: 10, patYF: -5 });
  const pts = C.patternBolts(stateFrom(rectS)).map(p => (p.x + 200) + ', ' + (p.y + 100)).join('\n');
  const cuS = Object.assign({}, rectS, { patType: 'custom', patPts: pts, patXF: 210, patYF: 95 });
  const R = C.calculate(stateFrom(rectS)).pat, U = C.calculate(stateFrom(cuS)).pat;
  near(U.cx0, 200, 1e-12, 'custom: centroid x'); near(U.cy0, 100, 1e-12, 'custom: centroid y');
  R.bolts.forEach((b, i) => { near(U.bolts[i].FA, b.FA, 1e-9, 'custom grid = rect, tension bolt ' + b.i); near(U.bolts[i].FQ, b.FQ, 1e-9, 'custom grid = rect, shear bolt ' + b.i); });
  // irregular pattern (Σxy ≠ 0): equilibrium of force and both moments
  const irr = C.calculate(stateFrom(Object.assign({}, base, { patType: 'custom', patPts: '0, 0\n70, 0\n140, 10\n0, 60\n100, 80', patFz: 6, patXF: 130, patYF: 70, patMx: 50, patMy: -30 }))).pat;
  ok(Math.abs(irr.Sxy) > 1, 'irregular pattern has Σxy ≠ 0');
  near(irr.bolts.reduce((s, b) => s + b.FA, 0), 6000, 1e-9, 'irregular: Σ F_A = F_z');
  near(irr.bolts.reduce((s, b) => s + b.FA * b.y, 0), 50000 + 6000 * irr.yF, 1e-9, 'irregular: Σ F_A·y = M_x');
  near(irr.bolts.reduce((s, b) => s + b.FA * b.x, 0), 30000 + 6000 * irr.xF, 1e-9, 'irregular: Σ F_A·x = −M_y');
  // the result does not depend on the origin the user picks
  const sh = C.calculate(stateFrom(Object.assign({}, base, { patType: 'custom', patPts: '-500, 300\n-430, 300\n-360, 310\n-500, 360\n-400, 380', patFz: 6, patXF: -370, patYF: 370, patMx: 50, patMy: -30 }))).pat;
  irr.bolts.forEach((b, i) => near(sh.bolts[i].FA, b.FA, 1e-9, 'origin-independent, bolt ' + b.i));
  // bolts on a diagonal line: moment across the line cannot be carried → warning; along the line it is
  const line = C.calculate(stateFrom(Object.assign({}, base, { patType: 'custom', patPts: '0, 0\n30, 30\n60, 60', patMx: 60 })));
  ok(line.issues.some(i => /one line/.test(i.text)), 'collinear bolts: warning for the moment about the line');
  near(line.pat.bolts.reduce((s, b) => s + b.FA * (b.x + b.y) / Math.SQRT2, 0), 60000 / Math.SQRT2, 1e-9, 'collinear bolts: moment component along the line carried');
  // heel model: heel at the outermost bolt plus the edge distance
  const heel = C.calculate(stateFrom(Object.assign({}, base, { patType: 'custom', patPts: '0, 0\n0, 100\n50, 50', patMethod: 'heel', patMx: 100, patEdge: 20 }))).pat;
  near(heel.c, 50 + 20, 1e-12, 'custom heel line at outermost bolt + edge');
  const bad = C.calculate(stateFrom(Object.assign({}, base, { patType: 'custom', patPts: '10, 10' })));
  ok(bad.issues.some(i => i.level === 'error'), 'custom pattern with one bolt is an error');
}

// ---- mixed bolt sizes in one pattern ----
{
  const pp = C.parsePoints('0, 0, M6\n10 0 m10x1.25\n5, 5, M7\n3, 3');
  ok(pp.pts.length === 3 && pp.pts[0].size === 'M6' && pp.pts[1].size === 'M10x1.25' && !pp.pts[2].size && pp.bad[0] === 3, 'size column parsed; unknown size rejected');
  const base = { thread: 'M10', cls: '10.9', plates: [{ mat: 'S235', t: 15 }, { mat: 'S235', t: 20 }], FQ: 0, patOn: true, patType: 'custom', patR: 0,
    patFz: 12, patXF: 80, patYF: 50, patMx: 400, patMy: -150, patFx: 1, patFy: 3, patMz: 120 };
  const plainPts = '0, 0\n160, 0\n0, 100\n160, 100\n80, 0\n80, 100';
  const mixPts = '0, 0\n160, 0\n0, 100\n160, 100\n80, 0, M6\n80, 100, M6';
  // equal weights reproduce the unweighted formulas (centroid and heel)
  for (const method of ['centroid', 'heel']) {
    const s = stateFrom(Object.assign({}, base, { patPts: '0, 0\n70, 0\n140, 10\n0, 60\n100, 80', patMethod: method }));
    const a = C.boltPattern(s), b = C.boltPattern(s, null, { k: [2, 2, 2, 2, 2], A: [5, 5, 5, 5, 5] });
    a.bolts.forEach((x, i) => { near(b.bolts[i].FA, x.FA, 1e-9, 'equal weights = unweighted (' + method + '), tension ' + x.i); near(b.bolts[i].FQ, x.FQ, 1e-9, 'equal weights = unweighted (' + method + '), shear ' + x.i); });
  }
  const tagged = C.calculate(stateFrom(Object.assign({}, base, { patPts: plainPts.split('\n').map(l => l + ', M10').join('\n') }))).pat;
  const plain = C.calculate(stateFrom(Object.assign({}, base, { patPts: plainPts }))).pat;
  ok(!tagged.mixed, 'all bolts tagged with the section-1 size: not mixed');
  plain.bolts.forEach((x, i) => near(tagged.bolts[i].FA, x.FA, 1e-12, 'tagged same size = untagged, bolt ' + x.i));
  const r = C.calculate(stateFrom(Object.assign({}, base, { patPts: mixPts }))), P = r.pat;
  ok(P.mixed && P.weighted && P.groups.length === 2, 'mixed sizes: two size groups, weighted sharing');
  near(P.bolts.reduce((s, b) => s + b.FA, 0), 12000, 1e-9, 'mixed: Σ F_A = F_z');
  near(P.bolts.reduce((s, b) => s + b.FA * b.y, 0), P.Mx, 1e-9, 'mixed: Σ F_A·y = M_x');
  near(P.bolts.reduce((s, b) => s + b.FA * b.x, 0), -P.My, 1e-9, 'mixed: Σ F_A·x = −M_y');
  near(P.bolts.reduce((s, b) => s + b.qx, 0), 1000, 1e-9, 'mixed: Σ q_x = F_x');
  near(P.bolts.reduce((s, b) => s + b.qy, 0), 3000, 1e-9, 'mixed: Σ q_y = F_y');
  near(P.bolts.reduce((s, b) => s + b.x * b.qy - b.y * b.qx, 0), 120000, 1e-9, 'mixed: Σ (x q_y − y q_x) = M_z about C');
  const m10 = P.groups.find(g => g.size === 'M10'), m6 = P.groups.find(g => g.size === 'M6');
  ok(m10.k > m6.k && m10.As > m6.As, 'M10 stiffer and larger than M6');
  ok(P.bolts[3].FA > plain.bolts[3].FA && P.bolts[5].FA < plain.bolts[5].FA, 'stiffer bolts take more, the smaller ones less');
  near(r.FAmax, m10.FAmax, 1e-12, 'detailed results use the section-1 size group');
  ok(m6.r && m6.r.valid && m6.r.g.d === 6, 'the other size is checked on its own');
  near(m6.r.FAmax, m6.FAmax, 1e-9, 'sub-check uses the group maximum tension');
  const fail = C.calculate(stateFrom(Object.assign({}, base, { patPts: mixPts, patFz: 40, patMx: 1500 })));
  ok(fail.issues.some(i => i.level === 'error' && /^M6 10\.9 bolts/.test(i.text)), 'a failing other size is reported');
  const none = C.calculate(stateFrom(Object.assign({}, base, { patPts: '0, 0, M8\n100, 0, M8\n50, 60, M12' })));
  ok(none.issues.some(i => /no bolt in the pattern is the M10 10\.9 from sections 1–3/.test(i.text)), 'section-1 size not used: warned');
  const si = C.sizeInput({ thread: 'M10', engage: 15, mode: 'torque', MA: 50, holeFit: 'custom', dhCustom: 11 }, 'M6');
  ok(si.thread === 'M6' && Math.abs(si.engage - 9) < 1e-9 && si.mode === 'nu' && Math.abs(si.dhCustom - 6.6) < 1e-9 && !si.patOn, 'size input scales engagement and hole, torque → ν');
}

// ---- different property classes in one pattern ----
{
  ok(C.normClass('12.9') === '12.9' && C.normClass('a4-70') === 'A2-70' && C.normClass('A2-80') === 'A4-80' && C.normClass('ti5') === 'Ti5' && C.normClass('9.9') === null, 'property class names and aliases');
  const pp = C.parsePoints('0, 0, M6, 12.9\n1, 0, 12.9, M6\n2, 0, A4-70\n3, 0, M6, M8\n4, 0, 12.9, 8.8\n5, 0, 9.9');
  ok(pp.pts.length === 3 && pp.pts[0].size === 'M6' && pp.pts[0].cls === '12.9' && pp.pts[1].size === 'M6' && pp.pts[1].cls === '12.9' && !pp.pts[2].size && pp.pts[2].cls === 'A2-70', 'size and class in either order');
  ok(pp.bad.join() === '4,5,6', 'two sizes, two classes or an unknown class are rejected');
  const base = { joint: 'nut', thread: 'M10', cls: '8.8', plates: [{ mat: 'S235', t: 15 }, { mat: 'S235', t: 20 }], FQ: 0, washerGrade: '300HV',
    patOn: true, patType: 'custom', patEdge: 15, patFz: 30, patXF: 100, patYF: 40, patMx: 3000, patFy: 6, patR: 0.6 };
  const all = C.calculate(stateFrom(Object.assign({}, base, { patPts: '0, 0\n100, 0\n200, 0\n0, 80\n100, 80\n200, 80' })));
  const up = C.calculate(stateFrom(Object.assign({}, base, { patPts: '0, 0\n100, 0\n200, 0\n0, 80, 12.9\n100, 80, 12.9\n200, 80, 12.9' })));
  ok(up.pat.mixed && up.pat.mixedClass && !up.pat.mixedSize && up.pat.groups.length === 2, 'same size, two classes: two bolt types');
  const g129 = up.pat.groups.find(g => g.cls === '12.9');
  ok(g129 && g129.r.valid && g129.r.bc.key === '12.9' && g129.r.g.d === 10, 'the 12.9 bolts are checked as 12.9');
  near(g129.k, up.pat.groups.find(g => g.cls === '8.8').k, 1e-9, 'steel classes have the same stiffness (same E)');
  all.pat.bolts.forEach((b, i) => near(up.pat.bolts[i].FA, b.FA, 1e-9, 'equal stiffness: sharing unchanged, bolt ' + b.i));
  ok(all.status === 'error' && up.status !== 'error', 'upgrading the loaded row to 12.9 makes the pattern pass');
  ok(up.issues.some(i => /look alike/.test(i.text)), 'same size, different class: marking note');
  const ss = C.calculate(stateFrom(Object.assign({}, base, { friction: 'ss-paste', patFz: 6, patMx: 300, patFy: 1, patPts: '0, 0\n100, 0\n200, 0\n0, 80, A2-70\n100, 80, A2-70\n200, 80, A2-70' }))).pat;
  const kS = ss.groups.find(g => g.cls === 'A2-70').k, kC = ss.groups.find(g => g.cls === '8.8').k;
  ok(kS < kC, 'stainless bolts (lower E) are a little softer and take a little less');
  const none = C.calculate(stateFrom(Object.assign({}, base, { patPts: '0, 0, 10.9\n100, 0, 10.9\n50, 60, 10.9' })));
  ok(none.issues.some(i => /no bolt in the pattern is the M10 8\.8 from sections 1–3/.test(i.text)), 'section-1 bolt type not used: warned');
  const si = C.sizeInput({ thread: 'M10', cls: '8.8' }, 'M10', null, '12.9');
  ok(si.cls === '12.9' && si.thread === 'M10', 'size input sets the class');
}

// ---- different joint types in one pattern ----
{
  ok(C.normJoint('Tapped') === 'tapped' && C.normJoint('hc') === 'helicoil' && C.normJoint('Heli-Coil') === 'helicoil' && C.normJoint('nut') === 'nut' && C.normJoint('bolt') === null, 'joint type names');
  const pp = C.parsePoints('0, 0, tapped\n1, 0, M6, hc, 12.9\n2, 0, nut, tapped');
  ok(pp.pts.length === 2 && pp.pts[0].joint === 'tapped' && pp.pts[1].joint === 'helicoil' && pp.pts[1].size === 'M6' && pp.pts[1].cls === '12.9' && pp.bad[0] === 3, 'joint column parsed, two joints rejected');
  const inp = { joint: 'nut', thread: 'M10', plates: [{ mat: 'S235', t: 12 }, { mat: '6082T6', t: 25 }], engage: 15, tapMat: 'S235', hcLen: 1.5 };
  const toT = C.jointParts(inp, 'tapped', 10);
  ok(toT.plates.length === 1 && toT.tapMat === '6082T6' && toT.engage === 15 && toT.partT === 25, 'nut → tapped: last part becomes the tapped part (engagement ≤ 1.5 d)');
  ok(C.sizeInput(inp, 'M10', null, null, 'helicoil').engage === 15, 'nut → Heli-Coil: coil length h·d');
  const back = C.jointParts(Object.assign({}, inp, { joint: 'tapped', plates: [{ mat: 'S235', t: 12 }], tapMat: '6082T6', engage: 15 }), 'nut', 10);
  ok(back.plates.length === 2 && back.plates[1].mat === '6082T6' && back.plates[1].t === 15, 'tapped → nut: tapped part clamped, as thick as the engagement');
  ok(!!C.jointParts(Object.assign({}, inp, { plates: [{ mat: 'S235', t: 12 }] }), 'tapped', 10).jointError, 'nut → tapped with one part: error');
  const round = C.jointParts(Object.assign({}, inp, toT), 'nut', 10);
  ok(round.plates.length === 2 && round.plates[1].t === 25 && round.plates[1].mat === '6082T6', 'nut → tapped → nut keeps the part thickness');
  ok(C.sizeInput({ thread: 'M10', insD: 14, insP: 1.5 }, 'M10').insD === 14, 'same size keeps the insert outer thread');
  const ex = P.PRESETS.find(p => p.id === 'pat-joints').s;
  const r = C.calculate(stateFrom(ex)), PT = r.pat;
  ok(PT.mixed && PT.mixedJoint && !PT.mixedSize && !PT.mixedClass && PT.groups.length === 2, 'nut + tapped: two bolt types');
  const gN = PT.groups.find(g => g.joint === 'nut'), gT = PT.groups.find(g => g.joint === 'tapped');
  ok(gT.k > 1.5 * gN.k, 'the tapped screw (short clamp length) is much stiffer than the through-bolt');
  ok(gT.r.valid && gT.r.esv && gT.r.lK < r.lK, 'the tapped type is checked as a screw joint with its shorter clamp length');
  ok(PT.bolts[2].FA > PT.bolts[2].FAeq && PT.bolts[0].FA < PT.bolts[0].FAeq, 'stiffer tapped screws take more than equal sharing');
  near(PT.bolts.reduce((s, b) => s + b.FA, 0), 30000, 1e-9, 'nut + tapped: Σ F_A = F_z');
  ok(r.status !== 'error', 'mixed joint example passes');
  const one = C.calculate(stateFrom(Object.assign({}, ex, { plates: [{ mat: 'S235', t: 12 }] })));
  ok(one.issues.some(i => i.level === 'error' && /two clamped parts/.test(i.text)), 'tapped lines with one clamped part: error');
}

// ---- flexible flange (beam on elastic bolt supports) ----
{
  const base = { thread: 'M8', cls: '8.8', plates: [{ mat: 'S235', t: 10 }, { mat: 'S235', t: 20 }], FQ: 0,
    patOn: true, patType: 'rect', patNx: 5, patNy: 1, patSx: 60, patSy: 0, patLx: 280, patLy: 40, patPerimeter: false, patFz: 12, patXF: 90, patR: 0 };
  const rig = C.calculate(stateFrom(base)).pat;
  const fl = C.calculate(stateFrom(Object.assign({}, base, { patFlex: true }))).pat;
  ok(fl.flex && !rig.flex, 'flexible model only when ticked');
  near(fl.bolts.reduce((s, b) => s + b.FA, 0), 12000, 1e-9, 'flexible: bolt loads add up to F_z');
  near(fl.bolts.reduce((s, b) => s + b.FA * b.x, 0), 12000 * 90, 1e-9, 'flexible: moment equilibrium about the centre');
  near(rig.bolts[4].FA, 12000 / 5 + 12000 * 90 * 120 / rig.Sx2, 1e-12, 'rigid: load offset x_F acts as a moment');
  fl.bolts.forEach((b, i) => near(b.FArigid, rig.bolts[i].FA, 1e-12, 'rigid comparison stored, bolt ' + b.i));
  ok(fl.FAmax > 1.2 * rig.FAmax && fl.critA.i === 4, 'thin flange: the bolt next to the load carries much more than the rigid model says');
  const stiffF = C.calculate(stateFrom(Object.assign({}, base, { patFlex: true, patFt: 3000 }))).pat;
  stiffF.bolts.forEach((b, i) => near(b.FA, rig.bolts[i].FA, 1e-3, 'very stiff flange approaches the rigid model, bolt ' + b.i));
  const sym = C.calculate(stateFrom(Object.assign({}, base, { patFlex: true, patXF: 0 }))).pat;
  near(sym.bolts[0].FA, sym.bolts[4].FA, 1e-9, 'symmetric load: symmetric bolt loads');
  const ex = C.calculate(stateFrom(Object.assign({}, base, { patFlex: true })));
  ok(ex.checks.some(c => /Flange bending \(flexible/.test(c.label)), 'flange bending check listed');
  near(ex.pat.flex.sig, ex.pat.flex.Mmax / (40 * 100 / 6), 1e-12, 'flange stress M / (b t^2 / 6)');
  // two rows: x from the beam, y rigid
  const two = C.calculate(stateFrom(Object.assign({}, base, { patFlex: true, patNy: 2, patSy: 30, patYF: 10 }))).pat;
  near(two.bolts.reduce((s, b) => s + b.FA * b.y, 0), 12000 * 10, 1e-9, 'two rows: M_x from y_F shared rigidly');
  const circ = C.calculate(stateFrom(Object.assign({}, base, { patFlex: true, patType: 'circle' })));
  ok(!circ.pat.flex && circ.issues.some(i => /Flexible flange/.test(i.text)), 'circular pattern: flexible model not available, warned');
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
