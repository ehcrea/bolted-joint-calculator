/* Bolted Joint Calculator: reference data.
 * Sources: ISO 261 / ISO 724 (thread geometry), ISO 898-1 and ISO 3506-1 (property classes),
 * ISO 4762 / ISO 4017 / ISO 4032 (head and nut dimensions), ISO 273 (clearance holes),
 * ISO 7089 / ISO 7093-1 (washers), VDI 2230 Part 1:2015 tables A5, A6, A8, A9 and table 5
 * (friction, tightening factor, limiting surface pressure, embedding).
 * Values marked est: true are typical estimates, not taken from VDI 2230.
 */
(function (root) {
  'use strict';

  // Metric threads: [d, P]
  const THREADS_COARSE = [
    [2, 0.4], [2.5, 0.45], [3, 0.5], [4, 0.7], [5, 0.8], [6, 1.0], [8, 1.25], [10, 1.5], [12, 1.75],
    [14, 2.0], [16, 2.0], [18, 2.5], [20, 2.5], [22, 2.5], [24, 3.0], [27, 3.0], [30, 3.5], [36, 4.0],
  ];
  const THREADS_FINE = [
    [8, 1.0], [10, 1.25], [10, 1.0], [12, 1.5], [12, 1.25], [14, 1.5], [16, 1.5], [18, 1.5], [20, 1.5],
    [22, 1.5], [24, 2.0], [27, 2.0], [30, 2.0], [36, 3.0],
  ];

  // Per nominal diameter d:
  //  hex: ISO 4017 / 4032 width across flats s, bearing diameter dw,min, head height k, nut height m
  //  shcs: ISO 4762 head diameter dk, bearing diameter dw,min, head height k
  //  hole: ISO 273 clearance hole [fine, medium, coarse]
  //  w7089 / w7093: washer [d1, d2, h]
  const SIZES = {
    2:   { hex: { s: 4,   dw: 3.07,  k: 1.4,  m: 1.6 },  shcs: { dk: 3.8, dw: 3.48,  k: 2 },   hole: [2.2, 2.4, 2.6],  w7089: [2.2, 5, 0.3],  w7093: [2.2, 6, 0.5] },
    2.5: { hex: { s: 5,   dw: 4.07,  k: 1.7,  m: 2.0 },  shcs: { dk: 4.5, dw: 4.18,  k: 2.5 }, hole: [2.7, 2.9, 3.1],  w7089: [2.7, 6, 0.5],  w7093: [2.7, 8, 0.6] },
    3:   { hex: { s: 5.5, dw: 4.57,  k: 2.0,  m: 2.4 },  shcs: { dk: 5.5, dw: 5.07,  k: 3 },   hole: [3.2, 3.4, 3.6],  w7089: [3.2, 7, 0.5],  w7093: [3.2, 9, 0.8] },
    4:   { hex: { s: 7,   dw: 5.88,  k: 2.8,  m: 3.2 },  shcs: { dk: 7,   dw: 6.53,  k: 4 },   hole: [4.3, 4.5, 4.8],  w7089: [4.3, 9, 0.8],  w7093: [4.3, 12, 1.0] },
    5:   { hex: { s: 8,   dw: 6.88,  k: 3.5,  m: 4.7 },  shcs: { dk: 8.5, dw: 8.03,  k: 5 },   hole: [5.3, 5.5, 5.8],  w7089: [5.3, 10, 1.0], w7093: [5.3, 15, 1.2] },
    6:   { hex: { s: 10,  dw: 8.88,  k: 4.0,  m: 5.2 },  shcs: { dk: 10,  dw: 9.38,  k: 6 },   hole: [6.4, 6.6, 7.0],  w7089: [6.4, 12, 1.6], w7093: [6.4, 18, 1.6] },
    8:   { hex: { s: 13,  dw: 11.63, k: 5.3,  m: 6.8 },  shcs: { dk: 13,  dw: 12.33, k: 8 },   hole: [8.4, 9.0, 10.0], w7089: [8.4, 16, 1.6], w7093: [8.4, 24, 2.0] },
    10:  { hex: { s: 16,  dw: 14.63, k: 6.4,  m: 8.4 },  shcs: { dk: 16,  dw: 15.33, k: 10 },  hole: [10.5, 11, 12],   w7089: [10.5, 20, 2],  w7093: [10.5, 30, 2.5] },
    12:  { hex: { s: 18,  dw: 16.63, k: 7.5,  m: 10.8 }, shcs: { dk: 18,  dw: 17.23, k: 12 },  hole: [13, 13.5, 14.5], w7089: [13, 24, 2.5],  w7093: [13, 37, 3] },
    14:  { hex: { s: 21,  dw: 19.64, k: 8.8,  m: 12.8 }, shcs: { dk: 21,  dw: 20.17, k: 14 },  hole: [15, 15.5, 16.5], w7089: [15, 28, 2.5],  w7093: [15, 44, 3] },
    16:  { hex: { s: 24,  dw: 22.49, k: 10,   m: 14.8 }, shcs: { dk: 24,  dw: 23.17, k: 16 },  hole: [17, 17.5, 18.5], w7089: [17, 30, 3],    w7093: [17, 50, 3] },
    18:  { hex: { s: 27,  dw: 25.34, k: 11.5, m: 15.8 }, shcs: { dk: 27,  dw: 25.9,  k: 18 },  hole: [19, 20, 21],     w7089: [19, 34, 3],    w7093: [20, 56, 4] },
    20:  { hex: { s: 30,  dw: 28.19, k: 12.5, m: 18 },   shcs: { dk: 30,  dw: 28.87, k: 20 },  hole: [21, 22, 24],     w7089: [21, 37, 3],    w7093: [22, 60, 4] },
    22:  { hex: { s: 34,  dw: 31.71, k: 14,   m: 19.4 }, shcs: { dk: 33,  dw: 31.9,  k: 22 },  hole: [23, 24, 26],     w7089: [23, 39, 3],    w7093: [23, 66, 5] },
    24:  { hex: { s: 36,  dw: 33.61, k: 15,   m: 21.5 }, shcs: { dk: 36,  dw: 34.81, k: 24 },  hole: [25, 26, 28],     w7089: [25, 44, 4],    w7093: [26, 72, 5] },
    27:  { hex: { s: 41,  dw: 38.0,  k: 17,   m: 23.8 }, shcs: { dk: 40,  dw: 38.4,  k: 27 },  hole: [28, 30, 32],     w7089: [28, 50, 4],    w7093: [30, 85, 6] },
    30:  { hex: { s: 46,  dw: 42.75, k: 18.7, m: 25.6 }, shcs: { dk: 45,  dw: 43.61, k: 30 },  hole: [31, 33, 35],     w7089: [31, 56, 4],    w7093: [33, 92, 6] },
    36:  { hex: { s: 55,  dw: 51.11, k: 22.5, m: 31 },   shcs: { dk: 54,  dw: 52.54, k: 36 },  hole: [37, 39, 42],     w7089: [37, 66, 5],    w7093: [39, 110, 8] },
  };

  // Bolt property classes. Rm, Rp0.2 minimum (MPa). rpBig/rmBig apply for d > 16 (8.8 only).
  // E in MPa, alpha in 1/K.
  const BOLT_CLASSES = {
    '4.6':   { label: '4.6 (steel)',            Rm: 400,  Rp: 240,  E: 205000, alpha: 11.5e-6, steel: true },
    '5.6':   { label: '5.6 (steel)',            Rm: 500,  Rp: 300,  E: 205000, alpha: 11.5e-6, steel: true },
    '5.8':   { label: '5.8 (steel)',            Rm: 520,  Rp: 420,  E: 205000, alpha: 11.5e-6, steel: true },
    '8.8':   { label: '8.8 (steel)',            Rm: 800,  Rp: 640,  RmBig: 830, RpBig: 660, E: 205000, alpha: 11.5e-6, steel: true },
    '10.9':  { label: '10.9 (steel)',           Rm: 1040, Rp: 940,  E: 205000, alpha: 11.5e-6, steel: true },
    '12.9':  { label: '12.9 (steel)',           Rm: 1220, Rp: 1100, E: 205000, alpha: 11.5e-6, steel: true },
    'A2-50': { label: 'A2-50 / A4-50 (stainless)', Rm: 500, Rp: 210, E: 193000, alpha: 16e-6, stainless: true },
    'A2-70': { label: 'A2-70 / A4-70 (stainless)', Rm: 700, Rp: 450, E: 193000, alpha: 16e-6, stainless: true },
    'A4-80': { label: 'A2-80 / A4-80 (stainless)', Rm: 800, Rp: 600, E: 193000, alpha: 16e-6, stainless: true },
    'Ti5':   { label: 'Titanium Grade 5 (Ti-6Al-4V)', Rm: 900, Rp: 830, E: 114000, alpha: 9e-6, titanium: true },
  };

  // Materials of clamped parts and tapped parts.
  // E MPa, alpha 1/K, Rm MPa, pG limiting surface pressure MPa (VDI 2230 table A9 where available),
  // ftau = tauB / Rm (shear strength ratio for thread stripping).
  const MATERIALS = {
    'S235':     { label: 'Steel S235JR',                  group: 'Steel',     E: 210000, alpha: 11.5e-6, Rm: 360,  pG: 490,  ftau: 0.6 },
    'E295':     { label: 'Steel E295',                    group: 'Steel',     E: 210000, alpha: 11.5e-6, Rm: 470,  pG: 710,  ftau: 0.6 },
    'C45':      { label: 'Steel C45 (normalised)',        group: 'Steel',     E: 210000, alpha: 11.5e-6, Rm: 700,  pG: 770,  ftau: 0.6 },
    '42CrMo4':  { label: 'Steel 42CrMo4 (QT)',            group: 'Steel',     E: 210000, alpha: 11.5e-6, Rm: 1000, pG: 850,  ftau: 0.6 },
    '1.4301':   { label: 'Stainless 1.4301 (304)',        group: 'Stainless', E: 200000, alpha: 16e-6,   Rm: 520,  pG: 630,  ftau: 0.65 },
    '1.4404':   { label: 'Stainless 1.4404 (316L)',       group: 'Stainless', E: 200000, alpha: 16e-6,   Rm: 500,  pG: 600,  ftau: 0.65, est: true },
    'GJL250':   { label: 'Grey cast iron EN-GJL-250',     group: 'Cast iron', E: 110000, alpha: 10e-6,   Rm: 250,  pG: 850,  ftau: 1.15 },
    'GJS400':   { label: 'Ductile iron EN-GJS-400-15',    group: 'Cast iron', E: 169000, alpha: 12.5e-6, Rm: 400,  pG: 600,  ftau: 0.9 },
    '6082T6':   { label: 'Aluminium EN AW-6082-T6',       group: 'Aluminium', E: 70000,  alpha: 23.4e-6, Rm: 310,  pG: 360,  ftau: 0.6 },
    '6061T6':   { label: 'Aluminium EN AW-6061-T6',       group: 'Aluminium', E: 69000,  alpha: 23.6e-6, Rm: 290,  pG: 340,  ftau: 0.6, est: true },
    '7075T6':   { label: 'Aluminium EN AW-7075-T6',       group: 'Aluminium', E: 71000,  alpha: 23.4e-6, Rm: 540,  pG: 550,  ftau: 0.6 },
    '5083':     { label: 'Aluminium EN AW-5083-H111',     group: 'Aluminium', E: 71000,  alpha: 24e-6,   Rm: 275,  pG: 230,  ftau: 0.6 },
    'AlSi9Cu3': { label: 'Die-cast Al EN AC-46000',       group: 'Aluminium', E: 75000,  alpha: 21e-6,   Rm: 240,  pG: 220,  ftau: 0.6 },
    'AZ91':     { label: 'Magnesium AZ91 (die cast)',     group: 'Magnesium', E: 45000,  alpha: 26e-6,   Rm: 240,  pG: 220,  ftau: 0.55, est: true },
    'Ti64':     { label: 'Titanium Ti-6Al-4V',            group: 'Titanium',  E: 114000, alpha: 9e-6,    Rm: 950,  pG: 1000, ftau: 0.6, est: true },
    'CuZn39':   { label: 'Brass CuZn39Pb3',               group: 'Copper',    E: 96000,  alpha: 20e-6,   Rm: 430,  pG: 400,  ftau: 0.6, est: true },
    'POM':      { label: 'POM-C (acetal)',                group: 'Polymer',   E: 2800,   alpha: 110e-6,  Rm: 65,   pG: 60,   ftau: 0.8, est: true, polymer: true },
    'PA6GF30':  { label: 'PA6-GF30 (conditioned)',        group: 'Polymer',   E: 6500,   alpha: 30e-6,   Rm: 110,  pG: 90,   ftau: 0.6, est: true, polymer: true },
    // FR-4 printed circuit board, values through the thickness (z): E_z and z-CTE below Tg. No pG standard exists;
    // 100 MPa is a conservative estimate (flatwise compressive strength ~400 MPa) to limit creep of laminate and solder mask.
    'FR4':      { label: 'PCB FR-4 (through thickness)',  group: 'PCB',       E: 10000,  alpha: 60e-6,   Rm: 310,  pG: 100,  ftau: 0.15, est: true, pcb: true },
  };

  // Washer hardness classes: limiting surface pressure on the washer itself (estimate from hardness).
  const WASHER_GRADES = {
    '200HV': { label: '200 HV (steel)',            pG: 700,  E: 210000, alpha: 11.5e-6, est: true },
    '300HV': { label: '300 HV (hardened steel)',   pG: 1000, E: 210000, alpha: 11.5e-6, est: true },
    'A2':    { label: 'A2 / A4 stainless (200 HV)', pG: 600, E: 200000, alpha: 16e-6,  est: true },
  };

  // Friction coefficients (thread muG, head bearing muK) as [min, max].
  // Based on VDI 2230-1 table A5 friction classes and ISO 16047 / supplier data for coatings.
  const FRICTION = {
    'oxide-oil':   { label: 'Steel, black oxide or phosphated, lightly oiled', muG: [0.12, 0.18], muK: [0.10, 0.18], cls: 'B' },
    'zn-dry':      { label: 'Steel, electro-zinc plated, dry',                muG: [0.14, 0.24], muK: [0.12, 0.22], cls: 'C' },
    'zn-flake':    { label: 'Zinc flake coating with lubricant (ISO 10683)',   muG: [0.09, 0.14], muK: [0.09, 0.14], cls: 'B' },
    'mos2':        { label: 'MoS₂ paste or solid lubricant',                  muG: [0.08, 0.12], muK: [0.08, 0.12], cls: 'A' },
    'ss-dry':      { label: 'Stainless A2/A4, dry (galling risk)',            muG: [0.23, 0.50], muK: [0.15, 0.40], cls: 'D–E' },
    'ss-paste':    { label: 'Stainless A2/A4 with anti-seize paste',          muG: [0.10, 0.16], muK: [0.08, 0.16], cls: 'A–B' },
    'al-oil':      { label: 'Steel bolt, aluminium parts, lightly oiled',     muG: [0.12, 0.18], muK: [0.10, 0.20], cls: 'B' },
    'ti-paste':    { label: 'Titanium bolt with anti-seize paste',            muG: [0.12, 0.20], muK: [0.10, 0.18], cls: 'B', est: true },
    'custom':      { label: 'Custom values', custom: true },
  };

  // Tightening factor alphaA = FMmax / FMmin (VDI 2230-1 table A8, mid values).
  const TIGHTENING = {
    'yield':     { label: 'Yield-controlled (electronic)',                  aA: 1.0,  range: '1.0' },
    'angle':     { label: 'Angle-controlled (torque + turn)',               aA: 1.0,  range: '1.0' },
    'ultra':     { label: 'Elongation measured (ultrasonic)',               aA: 1.15, range: '1.1–1.2' },
    'tension':   { label: 'Hydraulic tensioner',                            aA: 1.4,  range: '1.2–1.6' },
    'tw-test':   { label: 'Torque wrench, friction tested on the part',     aA: 1.5,  range: '1.4–1.6' },
    'tw-table':  { label: 'Torque wrench, friction from tables',            aA: 1.7,  range: '1.6–1.8' },
    'power':     { label: 'Power screwdriver, torque-calibrated',           aA: 2.0,  range: '1.7–2.5' },
    'impact':    { label: 'Impact wrench or by hand (no torque tool)',      aA: 3.0,  range: '2.5–4.0' },
  };

  // Embedding per VDI 2230-1 table 5 (micrometres), by mean roughness Rz class and load type.
  //   [thread, per head or nut bearing, per inner interface]
  const EMBEDDING = {
    fine:   { label: 'Rz < 10 µm (ground, fine turned)', axial: [3, 2.5, 1.5], shear: [3, 3, 2] },
    medium: { label: 'Rz 10–40 µm (turned, milled)',     axial: [3, 3, 2],     shear: [3, 4.5, 2.5] },
    rough:  { label: 'Rz 40–160 µm (rough machined, cast)', axial: [3, 4, 3],  shear: [3, 6.5, 3.5] },
  };

  // Static friction coefficient in the interface between clamped parts (VDI 2230-1 table A6, lower values).
  const INTERFACE_FRICTION = [
    ['Steel / steel, dry, clean', 0.15],
    ['Steel / steel, oiled', 0.10],
    ['Steel / cast iron, dry', 0.15],
    ['Aluminium / aluminium, dry', 0.15],
    ['Steel / aluminium, dry', 0.12],
    ['Steel / steel, grit-blasted', 0.35],
    ['Anodised aluminium', 0.10],
  ];

  // Helical coil insert (DIN 8140 / ISO 8140 style): standard nominal lengths as multiples of d.
  const HELICOIL_LENGTHS = [1, 1.5, 2, 2.5, 3];

  function threadList() {
    const list = [];
    for (const [d, P] of THREADS_COARSE) list.push({ id: 'M' + d, d, P, fine: false, label: 'M' + d + ' × ' + P });
    for (const [d, P] of THREADS_FINE) list.push({ id: 'M' + d + 'x' + P, d, P, fine: true, label: 'M' + d + ' × ' + P + ' (fine)' });
    return list;
  }

  const DATA = {
    THREADS_COARSE, THREADS_FINE, SIZES, BOLT_CLASSES, MATERIALS, WASHER_GRADES, FRICTION,
    TIGHTENING, EMBEDDING, INTERFACE_FRICTION, HELICOIL_LENGTHS, threadList,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = DATA;
  else root.BJ_DATA = DATA;
})(typeof window !== 'undefined' ? window : globalThis);
