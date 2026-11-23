/* Bolted Joint Calculator: default state and application examples. */
(function (root) {
  'use strict';
  const DEFAULT = {
    joint: 'nut', thread: 'M10', cls: '10.9', head: 'hex', shank: 0,
    washer: '7089', washerGrade: '300HV', washerNut: true, lock: 'none', rolledAfter: false,
    plates: [{ mat: 'S235', t: 12 }, { mat: 'S235', t: 12 }],
    holeFit: 'medium', dhCustom: 11, DA: 0, rough: 'medium',
    tapMat: '6082T6', engage: 15, hcLen: 1.5, insD: 14, insP: 1.5,
    friction: 'oxide-oil', muGmin: 0.12, muGmax: 0.18, muKmin: 0.10, muKmax: 0.18,
    method: 'tw-table', aA: '', mode: 'nu', nu: 0.9, MA: 60,
    FAmax: 8, FAmin: 0, FQ: 1.5, muT: 0.15, qF: 1, SGreq: 1.2, FKmin: 0, dT: 0, n: 0.5,
    nasa: false, nGamma: '', nTtol: 10, nRelax: 5, nTpvMin: 0, nTpvMax: 0, nTpvAdded: false,
    nFSy: 1.25, nFSu: 1.4, nFSsep: 1.2, nFSslip: 1.2, nFF: 1.15,
    patOn: false, patType: 'circle', patMethod: 'centroid', patN: 6, patPCD: 100, patAngle: 90, patDf: 130,
    patNx: 2, patNy: 2, patSx: 80, patSy: 60, patPerimeter: true, patLx: 110, patLy: 90,
    patFx: 0, patFy: 0, patFz: 0, patMx: 0, patMy: 0, patMz: 0, patR: 0, patXF: 0, patYF: 0, patFlex: false, patFt: '', patPts: '', patStacks: '', patEdge: 15, partT: '',
    pryOn: false, pryA: 30, pryB: 25, pryW: 60, pryT: '',
    eccOn: false, eccC: 50, eccB: 40, eccS: 0, eccA: 0, eccU: '', eccMB: 0, eccI: '', eccOpen: false,
  };

  const PRESETS = [
    { id: 'flange', label: 'M10 10.9 bolt + nut, steel flange', s: {} },
    { id: 'al-tapped', label: 'M6 12.9 socket screw into aluminium (tapped)', s: {
      joint: 'tapped', thread: 'M6', cls: '12.9', head: 'shcs', washer: '7089', washerGrade: '300HV', plates: [{ mat: '6082T6', t: 8 }],
      tapMat: '6082T6', engage: 12, holeFit: 'medium', DA: 16, FAmax: 3, FAmin: 0, FQ: 0.5, muT: 0.15, method: 'tw-test', nu: 0.7 } },
    { id: 'al-helicoil', label: 'M6 into aluminium with Heli-Coil 1.5d', s: {
      joint: 'helicoil', thread: 'M6', cls: '10.9', head: 'shcs', washer: '7089', washerGrade: '300HV', plates: [{ mat: '6082T6', t: 8 }],
      tapMat: '6082T6', hcLen: 1.5, DA: 16, FAmax: 3, FAmin: 0, FQ: 0.5, method: 'tw-test', nu: 0.9 } },
    { id: 'diecast-insert', label: 'M8 into die-cast housing, solid insert M12×1.5', s: {
      joint: 'insert', thread: 'M8', cls: '8.8', head: 'hex', washer: '7089', washerGrade: '200HV', plates: [{ mat: 'S235', t: 10 }],
      tapMat: 'AlSi9Cu3', engage: 12, insD: 12, insP: 1.5, DA: 22, FAmax: 3, FAmin: 0, FQ: 0.5, method: 'tw-test' } },
    { id: 'fatigue', label: 'M12 8.8 machine base, pulsating load (fatigue)', s: {
      joint: 'nut', thread: 'M12', cls: '8.8', head: 'hex', washer: '7089', washerGrade: '300HV', washerNut: true,
      plates: [{ mat: 'C45', t: 20 }, { mat: 'GJS400', t: 25 }], DA: 40, FAmax: 18, FAmin: 2, FQ: 0, method: 'tw-test' } },
    { id: 'stainless', label: 'M8 A2-70 stainless bracket on aluminium profile', s: {
      joint: 'nut', thread: 'M8', cls: 'A2-70', head: 'shcs', washer: '7089', washerGrade: 'A2', washerNut: true,
      plates: [{ mat: '1.4301', t: 4 }, { mat: '6082T6', t: 8 }], friction: 'ss-paste', DA: 20, FAmax: 1.2, FAmin: 0, FQ: 0.25, muT: 0.12, method: 'tw-test' } },
    { id: 'maker-pom', label: 'M5 into POM part with threaded insert (maker)', s: {
      joint: 'insert', thread: 'M5', cls: '8.8', head: 'shcs', washer: '7093', washerGrade: '200HV', plates: [{ mat: '6082T6', t: 3 }],
      tapMat: 'POM', engage: 10, insD: 8, insP: 1.25, DA: 18, FAmax: 0.2, FAmin: 0, FQ: 0, muT: 0.12, method: 'tw-table', mode: 'torque', MA: 5 } },
    { id: 'slip', label: 'M16 10.9 slip-critical splice (transverse load)', s: {
      joint: 'nut', thread: 'M16', cls: '10.9', head: 'hex', washer: '7089', washerGrade: '300HV', washerNut: true,
      plates: [{ mat: 'S235', t: 15 }, { mat: 'S235', t: 15 }], FAmax: 0, FAmin: 0, FQ: 20, muT: 0.35, qF: 1, SGreq: 1.25, friction: 'zn-flake', method: 'tw-test' } },
    { id: 'thermal', label: 'M8 steel bolt clamping aluminium, +80 K in service', s: {
      joint: 'tapped', thread: 'M8', cls: '10.9', head: 'shcs', washer: '7089', washerGrade: '300HV',
      plates: [{ mat: '6082T6', t: 25 }], tapMat: 'GJS400', engage: 12, DA: 24, FAmax: 4, FQ: 0, dT: 80, method: 'tw-test' } },
    // small fasteners: M4 and M3
    { id: 'm3-pcb-standoff', label: 'M3 screw clamping a PCB to a brass standoff', s: {
      joint: 'tapped', thread: 'M3', cls: '8.8', head: 'shcs', washer: '7089', washerGrade: '200HV',
      plates: [{ mat: 'FR4', t: 1.6 }], tapMat: 'CuZn39', engage: 5, DA: 5.5, rough: 'fine', friction: 'oxide-oil',
      method: 'tw-test', mode: 'torque', MA: 0.6, FAmax: 0.05, FAmin: 0, FQ: 0, muT: 0.2 } },
    { id: 'm3-pcb-housing', label: 'M3 A2 screw, PCB into aluminium housing, +50 K', s: {
      joint: 'tapped', thread: 'M3', cls: 'A2-70', head: 'shcs', washer: '7089', washerGrade: 'A2',
      plates: [{ mat: 'FR4', t: 1.6 }], tapMat: '6082T6', engage: 6, DA: 7, rough: 'fine', friction: 'ss-paste',
      method: 'tw-table', mode: 'torque', MA: 0.6, FAmax: 0.05, FAmin: 0, FQ: 0.03, muT: 0.2, dT: 50 } },
    { id: 'm4-sheet', label: 'M4 10.9 bolt + nut through two 2 mm steel sheets', s: {
      joint: 'nut', thread: 'M4', cls: '10.9', head: 'hex', washer: '7089', washerGrade: '300HV', washerNut: true,
      plates: [{ mat: 'S235', t: 2 }, { mat: 'S235', t: 2 }], DA: 12, rough: 'fine', friction: 'zn-flake', method: 'tw-test',
      FAmax: 0.3, FAmin: 0, FQ: 0.2, muT: 0.15 } },
    { id: 'm4-alu', label: 'M4 A2-70 socket screw into aluminium (tapped)', s: {
      joint: 'tapped', thread: 'M4', cls: 'A2-70', head: 'shcs', washer: '7089', washerGrade: 'A2',
      plates: [{ mat: '6082T6', t: 4 }], tapMat: '6082T6', engage: 8, DA: 10, friction: 'ss-paste', method: 'tw-test',
      FAmax: 0.5, FAmin: 0, FQ: 0, muT: 0.15 } },
    { id: 'm3-helicoil', label: 'M3 12.9 bracket into magnesium with Heli-Coil 2d', s: {
      joint: 'helicoil', thread: 'M3', cls: '12.9', head: 'shcs', washer: '7089', washerGrade: '300HV',
      plates: [{ mat: 'S235', t: 2 }], tapMat: 'AZ91', hcLen: 2, DA: 9, friction: 'oxide-oil', method: 'tw-test',
      FAmax: 0.6, FAmin: 0.2, FQ: 0.05, muT: 0.15, nu: 0.9 } },
    // Electronics enclosures (defence, aerospace): aluminium 5083 / 6061 with stainless wire thread inserts.
    // Short clamp lengths make settling the main concern, so each example shows one way to keep the preload.
    { id: 'def-m25-cover', label: 'M2.5 A4-80 cover screw, 5083 lid, Heli-Coil 1.5d', s: {
      joint: 'helicoil', thread: 'M2.5', cls: 'A4-80', head: 'shcs', washer: '7089', washerGrade: 'A2',
      plates: [{ mat: '5083', t: 2 }], tapMat: '5083', hcLen: 1.5, DA: 6, rough: 'fine', friction: 'ss-paste',
      method: 'tw-test', mode: 'nu', nu: 0.9, FAmax: 0.03, FAmin: 0, FQ: 0, muT: 0.15 } },
    { id: 'def-m3-bracket', label: 'M3 A2-70, 6 mm 6061 module bracket, Heli-Coil 2d, no washer', s: {
      joint: 'helicoil', thread: 'M3', cls: 'A2-70', head: 'shcs', washer: 'none',
      plates: [{ mat: '6061T6', t: 6 }], tapMat: '6061T6', hcLen: 2, DA: 8, rough: 'fine', friction: 'ss-paste',
      method: 'tw-test', mode: 'nu', nu: 0.9, FAmax: 0.03, FAmin: 0, FQ: 0.02, muT: 0.15 } },
    { id: 'def-m4-lru', label: 'M4 A4-80 LRU flange into 5083 tray, Heli-Coil 1.5d, −55 K', s: {
      joint: 'helicoil', thread: 'M4', cls: 'A4-80', head: 'shcs', washer: '7089', washerGrade: 'A2',
      plates: [{ mat: '6061T6', t: 6 }], tapMat: '5083', hcLen: 1.5, DA: 10, rough: 'fine', friction: 'ss-paste',
      method: 'tw-test', mode: 'nu', nu: 0.9, FAmax: 0.1, FAmin: 0, FQ: 0.05, muT: 0.15, dT: -55 } },
    { id: 'def-m4-sleeve', label: 'M4 A2-70 with 10 mm spacer sleeve (lK/d > 3), 6061, −55 K', s: {
      joint: 'helicoil', thread: 'M4', cls: 'A2-70', head: 'shcs', washer: '7089', washerGrade: 'A2',
      plates: [{ mat: '6061T6', t: 3 }, { mat: '1.4301', t: 10 }], tapMat: '6061T6', hcLen: 2, DA: 10, rough: 'fine', friction: 'ss-paste',
      method: 'tw-test', mode: 'nu', nu: 0.9, FAmax: 0.1, FAmin: 0, FQ: 0.05, muT: 0.15, dT: -55 } },
    // Bolt patterns: loads on the whole flange, distributed with the rigid-flange model.
    { id: 'pat-stacks', label: 'M10 8.8 cover, middle row through a 45 mm boss (different clamped parts in one pattern)', s: {
      joint: 'nut', thread: 'M10', cls: '8.8', head: 'hex', washer: '7089', washerGrade: '300HV', washerNut: true,
      plates: [{ mat: 'S235', t: 10 }, { mat: 'S235', t: 15 }], rough: 'medium', friction: 'zn-flake', method: 'tw-test',
      nu: 0.9, FQ: 0, n: 0.5,
      patOn: true, patType: 'custom', patStacks: 'boss: S235 10, S235 45',
      patPts: '0, 0\n100, 0\n0, 60, @boss\n100, 60, @boss\n0, 120\n100, 120', patEdge: 15,
      patFz: 30, patXF: 50, patYF: 60, patMx: 1500, patFy: 4, patR: 0.5 } },
    { id: 'pat-joints', label: 'M10 10.9 bracket: through-bolts with nuts + screws tapped into the frame (mixed joint types)', s: {
      joint: 'nut', thread: 'M10', cls: '10.9', head: 'hex', washer: '7089', washerGrade: '300HV', washerNut: true,
      plates: [{ mat: 'S235', t: 12 }, { mat: 'S235', t: 25 }], rough: 'medium', friction: 'zn-flake', method: 'tw-test',
      nu: 0.9, FQ: 0, n: 0.5,
      patOn: true, patType: 'custom', patPts: '0, 0\n120, 0\n0, 60, tapped\n120, 60, tapped\n0, 120\n120, 120', patEdge: 15,
      patFz: 30, patXF: 60, patYF: 60, patMx: 600, patFy: 4, patR: 0.5 } },
    { id: 'pat-classes', label: 'M10 8.8 bracket, top row upgraded to 12.9 (mixed property classes)', s: {
      joint: 'nut', thread: 'M10', cls: '8.8', head: 'hex', washer: '7089', washerGrade: '300HV', washerNut: true,
      plates: [{ mat: 'S235', t: 15 }, { mat: 'S235', t: 20 }], rough: 'medium', friction: 'zn-flake', method: 'tw-test',
      nu: 0.9, FQ: 0, n: 0.5,
      patOn: true, patType: 'custom', patPts: '0, 0\n100, 0\n200, 0\n0, 80, 12.9\n100, 80, 12.9\n200, 80, 12.9', patEdge: 15,
      patFz: 30, patXF: 100, patYF: 40, patMx: 3000, patFy: 6, patR: 0.6 } },
    { id: 'pat-flange', label: 'M8 10.9, 6-bolt circular flange (Ø80 PCD), bending + torsion', s: {
      joint: 'tapped', thread: 'M8', cls: '10.9', head: 'shcs', washer: 'none', plates: [{ mat: '42CrMo4', t: 12 }],
      tapMat: 'C45', engage: 12, rough: 'medium', friction: 'oxide-oil', method: 'tw-test', nu: 0.9, muT: 0.15, n: 0.5,
      patOn: true, patType: 'circle', patN: 6, patPCD: 80, patAngle: 90, patDf: 104,
      patFz: 4, patMx: 250, patMz: 150, patFx: 2, patR: 0 } },
    { id: 'pat-custom', label: 'M8 10.9, 5 bolts at custom positions, offset load with shear and torsion', s: {
      joint: 'nut', thread: 'M8', cls: '10.9', head: 'hex', washer: '7089', washerGrade: '300HV', washerNut: true,
      plates: [{ mat: 'S235', t: 12 }, { mat: 'S235', t: 15 }], rough: 'medium', friction: 'zn-flake', method: 'tw-test',
      nu: 0.9, FQ: 0, n: 0.5,
      patOn: true, patType: 'custom', patPts: '0, 0\n70, 0\n140, 10\n0, 60\n100, 80', patEdge: 15,
      patFz: 6, patXF: 130, patYF: 70, patFy: 2, patMz: 60, patR: 0 } },
    { id: 'pat-mixed', label: 'M10 + M6 10.9, 6-bolt base with mixed bolt sizes (load shared by stiffness)', s: {
      joint: 'nut', thread: 'M10', cls: '10.9', head: 'hex', washer: '7089', washerGrade: '300HV', washerNut: true,
      plates: [{ mat: 'S235', t: 15 }, { mat: 'S235', t: 20 }], rough: 'medium', friction: 'zn-flake', method: 'tw-test',
      nu: 0.9, FQ: 0, n: 0.5,
      patOn: true, patType: 'custom', patPts: '0, 0\n160, 0\n0, 100\n160, 100\n80, 0, M6\n80, 100, M6', patEdge: 15,
      patFz: 12, patXF: 80, patYF: 50, patMx: 400, patFy: 3, patMz: 120, patR: 0 } },
    { id: 'pat-strip', label: 'M8 8.8, 5 bolts in a row, 10 mm flange with a local load (flexible flange)', s: {
      joint: 'nut', thread: 'M8', cls: '8.8', head: 'hex', washer: '7089', washerGrade: '200HV', washerNut: true,
      plates: [{ mat: 'S235', t: 10 }, { mat: 'S235', t: 20 }], rough: 'medium', friction: 'zn-flake', method: 'tw-test',
      nu: 0.9, FQ: 0, n: 0.5,
      patOn: true, patType: 'rect', patNx: 5, patNy: 1, patSx: 60, patSy: 0, patLx: 280, patLy: 40, patPerimeter: false,
      patFz: 12, patXF: 90, patR: 0, patFlex: true } },
    { id: 'pat-bracket', label: 'M6 8.8, 4-bolt bracket into aluminium (Heli-Coil), overhanging load', s: {
      joint: 'helicoil', thread: 'M6', cls: '8.8', head: 'shcs', washer: '7089', washerGrade: '300HV',
      plates: [{ mat: 'S235', t: 8 }], tapMat: '6061T6', hcLen: 1.5, rough: 'fine', friction: 'oxide-oil', method: 'tw-test',
      nu: 0.9, muT: 0.15, n: 0.5,
      patOn: true, patType: 'rect', patNx: 2, patNy: 2, patSx: 60, patSy: 40, patLx: 80, patLy: 60,
      patFy: -1.2, patMx: -100, patR: 0 } },
    { id: 'ecc-bracket', label: 'M10 10.9 eccentric bracket: bolt off-centre, load further out', s: {
      joint: 'nut', thread: 'M10', cls: '10.9', head: 'hex', washer: '7089', washerGrade: '300HV', washerNut: true,
      plates: [{ mat: 'S235', t: 15 }, { mat: 'S235', t: 15 }], rough: 'medium', friction: 'zn-flake', method: 'tw-test',
      nu: 0.9, FAmax: 4, FAmin: 0, FQ: 0, n: 0.5, eccOn: true, eccC: 60, eccB: 40, eccS: 5, eccA: 12 } },
    { id: 'ecc-open', label: 'M10 10.9 eccentric bracket, rare 30 kN overload opens the joint (opening allowed)', s: {
      joint: 'nut', thread: 'M10', cls: '10.9', head: 'hex', washer: '7089', washerGrade: '300HV', washerNut: true,
      plates: [{ mat: 'S235', t: 15 }, { mat: 'S235', t: 15 }], rough: 'medium', friction: 'zn-flake', method: 'tw-test',
      nu: 0.9, FAmax: 30, FAmin: 30, FQ: 0, n: 0.5, eccOn: true, eccC: 60, eccB: 40, eccS: 5, eccA: 12, eccOpen: true } },
    { id: 'pry-angle', label: 'M10 8.8 hanger: 10 mm angle leg in tension with prying', s: {
      joint: 'nut', thread: 'M10', cls: '8.8', head: 'hex', washer: '7089', washerGrade: '200HV', washerNut: true,
      plates: [{ mat: 'S235', t: 10 }, { mat: 'S235', t: 15 }], rough: 'medium', friction: 'zn-flake', method: 'tw-test',
      nu: 0.9, FAmax: 8, FAmin: 0, FQ: 0, n: 0.5, pryOn: true, pryA: 30, pryB: 25, pryW: 60 } },
  ];
  // List from the smallest bolt to the largest (stable sort: same size keeps the order above).
  const size = p => parseFloat(String(p.s.thread || DEFAULT.thread).replace(/^M/, ''));
  PRESETS.sort((a, b) => size(a) - size(b));

  root.BJ_PRESETS = { DEFAULT, PRESETS };
})(window);
