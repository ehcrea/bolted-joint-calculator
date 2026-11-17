/* Bolted Joint Calculator: default state and application examples. */
(function (root) {
  'use strict';
  const DEFAULT = {
    joint: 'nut', thread: 'M10', cls: '10.9', head: 'hex', shank: 0,
    washer: '7089', washerGrade: '300HV', washerNut: true, rolledAfter: false,
    plates: [{ mat: 'S235', t: 12 }, { mat: 'S235', t: 12 }],
    holeFit: 'medium', dhCustom: 11, DA: 0, rough: 'medium',
    tapMat: '6082T6', engage: 15, hcLen: 1.5, insD: 14, insP: 1.5,
    friction: 'oxide-oil', muGmin: 0.12, muGmax: 0.18, muKmin: 0.10, muKmax: 0.18,
    method: 'tw-table', aA: '', mode: 'nu', nu: 0.9, MA: 60,
    FAmax: 8, FAmin: 0, FQ: 1.5, muT: 0.15, qF: 1, SGreq: 1.2, FKmin: 0, dT: 0, n: 0.5,
  };

  const PRESETS = [
    { id: 'flange', label: 'Steel flange, M10 10.9 bolt + nut', s: {} },
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
  ];

  root.BJ_PRESETS = { DEFAULT, PRESETS };
})(window);
