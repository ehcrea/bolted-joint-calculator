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
