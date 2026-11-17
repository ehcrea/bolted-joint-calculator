/* Bolted Joint Calculator: SVG drawings.
 * jointSection: cross-section of the joint with deformation cone, resilience zones and engagement
 * jointDiagram: force / elongation diagram (joint triangle)
 * threadDetail: ISO basic thread profile and stress cross-section
 * frictionChart: preload against thread friction for the tightening torque
 * torqueBar: how the tightening torque is split
 */
(function (root) {
  'use strict';
  const f = (x, d) => root.BJ_CALC.fmtN(x, d);
  const r1 = x => Math.round(x * 10) / 10;
  let uid = 0;

  function matClass(l) {
    if (l.kind === 'washer') return 'm-washer';
    const g = (l.m && l.m.group) || 'Steel';
    return 'm-' + g.toLowerCase().replace(/\s+/g, '');
  }

  function hatchDefs(id) {
    const pat = (name, angle, gap) =>
      `<pattern id="${id}-${name}" patternUnits="userSpaceOnUse" width="${gap}" height="${gap}" patternTransform="rotate(${angle})"><line x1="0" y1="0" x2="0" y2="${gap}" class="hatch-line"/></pattern>`;
    return `<defs>${pat('h45', 45, 6)}${pat('h135', 135, 6)}${pat('h45w', 45, 10)}${pat('h135w', 135, 3.5)}
      <marker id="${id}-arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 1L10 5L0 9z" class="arrow-head"/></marker>
      <marker id="${id}-arrF" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 1L10 5L0 9z" class="force-head"/></marker></defs>`;
  }

  function dimV(x, y1, y2, label, id, side) {
    const tx = side === 'left' ? x - 6 : x + 6;
    const anchor = side === 'left' ? 'end' : 'start';
    return `<line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}" class="dim" marker-start="url(#${id}-arr)" marker-end="url(#${id}-arr)"/>
      <text x="${tx}" y="${(y1 + y2) / 2 + 4}" class="dim-text" text-anchor="${anchor}">${label}</text>`;
  }
  function dimH(y, x1, x2, label, id, above) {
    return `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" class="dim" marker-start="url(#${id}-arr)" marker-end="url(#${id}-arr)"/>
      <text x="${(x1 + x2) / 2}" y="${above ? y - 5 : y + 14}" class="dim-text" text-anchor="middle">${label}</text>`;
  }

  // ------------------------------------------------------------------
  function jointSection(r, opts) {
    opts = opts || {};
    const id = 'js' + (++uid);
    const g = r.g, d = g.d;
    const head = r.head;
    const headW = r.esv || true ? (head.s || head.dk) : 0;
    const k = head.k;
    const lK = r.lK;
    const pr = r.res.pr;
    const DAgr = pr.DAGr;
    const W = Math.max(r.DA > 0 ? r.DA : Math.min(DAgr * 1.25, Math.max(DAgr, 3.2 * r.dW)), r.dW * 1.8, (r.washer ? r.washer[1] : 0) * 1.2, headW * 1.4);
    let lower, tapDepth = 0, blockH = 0;
    if (!r.esv) lower = r.nut.m + 2 * g.P + 0.6 * d;
    else { tapDepth = r.Le + Math.max(1.5 * g.P, 0.3 * d); blockH = tapDepth + 0.45 * d + 0.3 * d; lower = blockH; }
    const Htot = k + lK + lower;
    const VW = 760, left = 150, right = 270;
    const sc = Math.min((VW - left - right) / W, 520 / Htot);
    const cx = left + (VW - left - right) / 2;
    const top = 34;
    const X = mm => cx + mm * sc;
    const Y = mm => top + mm * sc;     // mm measured from the top of the head
    const yH = k;                       // head bearing face
    const yK = k + lK;                  // end of clamp length
    const VH = Math.ceil(Y(Htot) + 46);
    const out = [];
    out.push(`<svg viewBox="0 0 ${VW} ${VH}" role="img" aria-label="Cross-section of the bolted joint">${hatchDefs(id)}`);

    // ---- clamped layers ----
    let y = yH;
    const labels = [];
    r.layers.forEach((l, i) => {
      const w = l.kind === 'washer' ? l.D : W;
      const hole = l.kind === 'washer' ? l.d1 : r.dh;
      const y1 = Y(y), y2 = Y(y + l.t);
      const cls = matClass(l);
      const hatch = i % 2 ? 'h135' : 'h45';
      for (const s of [-1, 1]) {
        const xa = X(s * hole / 2), xb = X(s * w / 2);
        const xl = Math.min(xa, xb), wpx = Math.abs(xb - xa);
        out.push(`<rect x="${r1(xl)}" y="${r1(y1)}" width="${r1(wpx)}" height="${r1(y2 - y1)}" class="layer ${cls}"/>`);
        out.push(`<rect x="${r1(xl)}" y="${r1(y1)}" width="${r1(wpx)}" height="${r1(y2 - y1)}" fill="url(#${id}-${hatch})" class="hatch-fill"/>`);
      }
      labels.push({ y: (y1 + y2) / 2, x: X(w / 2), text: (l.kind === 'washer' ? l.label : (l.m ? l.m.label : l.label)) + ' · ' + f(l.t) + ' mm' });
      y += l.t;
    });

    // ---- tapped part / nut ----
    if (r.esv) {
      const yb1 = Y(yK), yb2 = Y(yK + blockH);
      const tapMat = r.strip.parent;
      const holeR = r.joint === 'tapped' ? d / 2 : (r.strip.dO || d) / 2;
      const drillR = r.joint === 'tapped' ? g.D1 / 2 : holeR - 0.6 * (r.strip.PO || g.P);
      const yT = yK + tapDepth;
      const cone = drillR * Math.tan(31 * Math.PI / 180);
      const blockCls = 'layer m-' + (tapMat.group || 'Steel').toLowerCase().replace(/\s+/g, '');
      const pathBlock = (s) => `M${X(s * W / 2)} ${yb1} H${X(s * holeR)} V${Y(yT)} L${X(s * drillR)} ${Y(yT)} L${X(0)} ${Y(yT + cone)} V${yb2} H${X(s * W / 2)} Z`;
      for (const s of [-1, 1]) {
        out.push(`<path d="${pathBlock(s)}" class="${blockCls}"/>`);
        out.push(`<path d="${pathBlock(s)}" fill="url(#${id}-h45w)" class="hatch-fill"/>`);
      }
      labels.push({ y: (yb1 + Y(yT)) / 2, x: X(W / 2), text: 'Tapped part: ' + tapMat.label });
      // insert visuals
      if (r.joint === 'helicoil') {
        const P = g.P, n = Math.floor(r.Le / P);
        for (let i = 0; i < n; i++) {
          const yy = yK + (i + 0.5) * P;
          for (const s of [-1, 1]) {
            const xi = X(s * d / 2), xo = X(s * holeR);
            out.push(`<path d="M${r1(xi)} ${r1(Y(yy - P * 0.32))} L${r1(xo)} ${r1(Y(yy))} L${r1(xi)} ${r1(Y(yy + P * 0.32))} Z" class="coil"/>`);
          }
        }
        labels.push({ y: Y(yK + r.Le / 2), x: X(W / 2), text: 'Heli-Coil insert · ' + f(r.Le) + ' mm (STI Ø' + f(r.strip.dO, 1) + ')' });
      } else if (r.joint === 'insert') {
        for (const s of [-1, 1]) {
          const xa = X(s * d / 2), xb = X(s * holeR);
          out.push(`<rect x="${r1(Math.min(xa, xb))}" y="${r1(Y(yK))}" width="${r1(Math.abs(xb - xa))}" height="${r1(r.Le * sc)}" class="insert"/>`);
          out.push(`<rect x="${r1(Math.min(xa, xb))}" y="${r1(Y(yK))}" width="${r1(Math.abs(xb - xa))}" height="${r1(r.Le * sc)}" fill="url(#${id}-h135w)" class="hatch-fill"/>`);
        }
        labels.push({ y: Y(yK + r.Le / 2), x: X(W / 2), text: 'Threaded insert M' + f(r.strip.dO) + '×' + f(r.strip.PO) + ' · ' + f(r.Le) + ' mm' });
      }
    } else {
      // nut (hex, section through flats)
      const yn1 = Y(yK), yn2 = Y(yK + r.nut.m);
      for (const s of [-1, 1]) {
        const xa = X(s * d / 2), xb = X(s * r.nut.s / 2);
        out.push(`<rect x="${r1(Math.min(xa, xb))}" y="${r1(yn1)}" width="${r1(Math.abs(xb - xa))}" height="${r1(yn2 - yn1)}" class="layer m-nut"/>`);
        out.push(`<rect x="${r1(Math.min(xa, xb))}" y="${r1(yn1)}" width="${r1(Math.abs(xb - xa))}" height="${r1(yn2 - yn1)}" fill="url(#${id}-h135w)" class="hatch-fill"/>`);
      }
      labels.push({ y: (yn1 + yn2) / 2, x: X(r.nut.s / 2), text: 'Nut ISO 4032 · m = ' + f(r.nut.m) + ' mm' });
    }

    // ---- deformation cone ----
    const tp = pr.tanPhi;
    const capR = r.DA > 0 ? r.DA / 2 : Infinity;
    const coneSide = (s) => {
      const pts = [];
      const rAt = (z) => {
        // z: depth from head bearing face, 0..lK
        const zz = r.esv ? z : Math.min(z, lK - z);
        return Math.min(capR, r.dW / 2 + zz * tp);
      };
      const N = 24;
      for (let i = 0; i <= N; i++) { const z = lK * i / N; pts.push([X(s * rAt(z)), Y(yH + z)]); }
      for (let i = N; i >= 0; i--) { const z = lK * i / N; pts.push([X(s * r.dh / 2), Y(yH + z)]); }
      return 'M' + pts.map(p => r1(p[0]) + ' ' + r1(p[1])).join('L') + 'Z';
    };
    out.push(`<path d="${coneSide(-1)}" class="cone"/><path d="${coneSide(1)}" class="cone"/>`);

    // ---- bolt ----
    const yEnd = r.esv ? yK + r.Le : yK + r.nut.m + 2 * g.P;
    const yShankEnd = yH + r.res.ls;
    out.push(`<rect x="${r1(X(-d / 2))}" y="${r1(Y(yH))}" width="${r1(d * sc)}" height="${r1((yEnd - yH) * sc)}" class="bolt"/>`);
    // chamfered end
    out.push(`<path d="M${r1(X(-d / 2))} ${r1(Y(yEnd))} L${r1(X(-g.d3 / 2))} ${r1(Y(yEnd + 0.6 * g.P))} H${r1(X(g.d3 / 2))} L${r1(X(d / 2))} ${r1(Y(yEnd))}Z" class="bolt"/>`);
    // thread minor diameter lines (drawing convention)
    out.push(`<line x1="${r1(X(-g.d3 / 2))}" y1="${r1(Y(yShankEnd))}" x2="${r1(X(-g.d3 / 2))}" y2="${r1(Y(yEnd))}" class="thread-line"/>`);
    out.push(`<line x1="${r1(X(g.d3 / 2))}" y1="${r1(Y(yShankEnd))}" x2="${r1(X(g.d3 / 2))}" y2="${r1(Y(yEnd))}" class="thread-line"/>`);
    if (r.res.ls > 0) out.push(`<line x1="${r1(X(-d / 2))}" y1="${r1(Y(yShankEnd))}" x2="${r1(X(d / 2))}" y2="${r1(Y(yShankEnd))}" class="thread-line"/>`);
    // engaged thread zone
    const engR = r.joint === 'helicoil' || r.joint === 'insert' ? d / 2 : d / 2;
    const engLen = r.esv ? r.Le : r.nut.m;
    for (const s of [-1, 1]) {
      const xa = X(s * g.d3 / 2), xb = X(s * engR);
      out.push(`<rect x="${r1(Math.min(xa, xb))}" y="${r1(Y(yK))}" width="${r1(Math.abs(xb - xa))}" height="${r1(engLen * sc)}" class="engaged"/>`);
    }
    // head
    if (opts.headType === 'shcs' || head.dk) {
      const hw = head.dk;
      out.push(`<path d="M${r1(X(-hw / 2))} ${r1(Y(yH))} V${r1(Y(0.08 * k))} Q${r1(X(-hw / 2))} ${r1(Y(0))} ${r1(X(-hw / 2 + 0.08 * k))} ${r1(Y(0))} H${r1(X(hw / 2 - 0.08 * k))} Q${r1(X(hw / 2))} ${r1(Y(0))} ${r1(X(hw / 2))} ${r1(Y(0.08 * k))} V${r1(Y(yH))}Z" class="bolt"/>`);
      const sock = 0.5 * d * 0.85, depth = 0.55 * k;
      out.push(`<path d="M${r1(X(-sock))} ${r1(Y(0))} V${r1(Y(depth))} L${r1(X(0))} ${r1(Y(depth + sock * 0.5))} L${r1(X(sock))} ${r1(Y(depth))} V${r1(Y(0))}" class="socket"/>`);
    } else {
      const hw = head.s;
      out.push(`<path d="M${r1(X(-hw / 2))} ${r1(Y(yH))} V${r1(Y(0.15 * k))} L${r1(X(-hw / 2 + 0.15 * k))} ${r1(Y(0))} H${r1(X(hw / 2 - 0.15 * k))} L${r1(X(hw / 2))} ${r1(Y(0.15 * k))} V${r1(Y(yH))}Z" class="bolt"/>`);
      out.push(`<line x1="${r1(X(-hw / 4))}" y1="${r1(Y(0.05 * k))}" x2="${r1(X(-hw / 4))}" y2="${r1(Y(yH))}" class="thread-line"/><line x1="${r1(X(hw / 4))}" y1="${r1(Y(0.05 * k))}" x2="${r1(X(hw / 4))}" y2="${r1(Y(yH))}" class="thread-line"/>`);
    }
    // axis
    out.push(`<line x1="${cx}" y1="${Y(-0.25 * k) - 6}" x2="${cx}" y2="${r1(Y(Htot) + 8)}" class="axis"/>`);

    // ---- resilience zones (left) ----
    const zx = 58;
    const zones = [
      { a: yH - r.res.lSK, b: yH, k: 'δ<tspan baseline-shift="sub" font-size="9">SK</tspan>', c: 'z1', t: 'head' },
      r.res.ls > 0 ? { a: yH, b: yShankEnd, k: 'δ<tspan baseline-shift="sub" font-size="9">1</tspan>', c: 'z2', t: 'shank' } : null,
      r.res.lGew > 0 ? { a: yShankEnd, b: yK, k: 'δ<tspan baseline-shift="sub" font-size="9">Gew</tspan>', c: 'z3', t: 'free thread' } : null,
      { a: yK, b: yK + r.res.lG, k: 'δ<tspan baseline-shift="sub" font-size="9">G</tspan>', c: 'z4', t: 'engaged' },
    ].filter(Boolean);
    zones.forEach(z => {
      out.push(`<rect x="${zx}" y="${r1(Y(z.a))}" width="7" height="${r1(Math.max(1.5, (z.b - z.a) * sc))}" class="zone ${z.c}"/>`);
      out.push(`<text x="${zx - 5}" y="${r1(Y((z.a + z.b) / 2) + 4)}" class="zone-text" text-anchor="end">${z.k}</text>`);
    });
    out.push(`<rect x="${zx + 9}" y="${r1(Y(yK))}" width="7" height="${r1(r.res.lM * sc)}" class="zone z5"/>`);
    out.push(`<text x="${zx + 20}" y="${r1(Y(yK + r.res.lM) + 12)}" class="zone-text">δ<tspan baseline-shift="sub" font-size="9">M</tspan></text>`);
    out.push(`<text x="${zx - 46}" y="${top - 14}" class="zone-title">Bolt zones</text>`);

    // ---- dimensions ----
    const xDim = X(-W / 2) - 14;
    out.push(dimV(xDim, Y(yH), Y(yK), 'l<tspan baseline-shift="sub" font-size="9">K</tspan> = ' + f(lK), id, 'left'));
    if (r.esv) out.push(dimV(xDim, Y(yK), Y(yK + r.Le), 'l<tspan baseline-shift="sub" font-size="9">e</tspan> = ' + f(r.Le), id, 'left'));
    out.push(dimH(Y(-0.25 * k) - 2, X(-r.dW / 2), X(r.dW / 2), 'd<tspan baseline-shift="sub" font-size="9">W</tspan> = ' + f(r.dW, 1), id, true));
    const yB = Y(Htot) + 22;
    const DAshow = r.DA > 0 ? r.DA : DAgr;
    out.push(dimH(yB, X(-Math.min(DAshow, W) / 2), X(Math.min(DAshow, W) / 2), (r.DA > 0 ? 'D<tspan baseline-shift="sub" font-size="9">A</tspan> = ' : 'D<tspan baseline-shift="sub" font-size="9">A,Gr</tspan> = ') + f(DAshow, 1), id, false));
    // cone angle label
    const zc = r.esv ? lK * 0.55 : lK * 0.3;
    const rc = Math.min(capR, r.dW / 2 + zc * tp);
    out.push(`<text x="${r1(X(rc) + 6)}" y="${r1(Y(yH + zc))}" class="cone-text">φ = ${f(pr.phi, 1)}°</text>`);

    // ---- layer labels (right) ----
    const lx = VW - right + 12;
    let lastY = -99;
    labels.sort((a, b) => a.y - b.y).forEach(L => {
      let ty = Math.max(L.y + 4, lastY + 16);
      lastY = ty;
      out.push(`<line x1="${r1(L.x + 2)}" y1="${r1(L.y)}" x2="${lx - 4}" y2="${r1(ty - 4)}" class="leader"/>`);
      out.push(`<text x="${lx}" y="${r1(ty)}" class="lbl">${esc(L.text)}</text>`);
    });
    // force arrows
    if (r.FAmax > 0) {
      const fx = r1(X((head.s || head.dk) / 2) + 22);
      out.push(`<line x1="${fx}" y1="${r1(Y(yH * 0.6))}" x2="${fx}" y2="${r1(Y(yH * 0.6) - 30)}" class="force" marker-end="url(#${id}-arrF)"/><text x="${fx + 6}" y="${r1(Y(yH * 0.6) - 14)}" class="force-text">F<tspan baseline-shift="sub" font-size="9">A</tspan></text>`);
    }
    out.push('</svg>');
    return out.join('');
  }

  // ------------------------------------------------------------------
  function jointDiagram(r) {
    const id = 'jd' + (++uid);
    const VW = 560, VH = 330, L = 56, R = 150, T = 20, B = 40;
    const dS = r.res.deltaS, dP = r.res.deltaP;
    const FV = Math.max(r.FVmin, 1);
    const FMx = r.FMmax;
    const fS = FMx * dS * 1000, fP = FMx * dP * 1000; // µm at FMmax
    const fmax = fS + fP;
    const Fmax = Math.max(FMx, r.FVmin + r.FSA, r.FSmax) * 1.12;
    const X = u => L + u / fmax * (VW - L - R);
    const Yf = F => VH - B - F / Fmax * (VH - T - B);
    const o = [];
    o.push(`<svg viewBox="0 0 ${VW} ${VH}" role="img" aria-label="Joint diagram">${hatchDefs(id)}`);
    o.push(`<line x1="${L}" y1="${VH - B}" x2="${VW - R + 20}" y2="${VH - B}" class="ax"/><line x1="${L}" y1="${VH - B}" x2="${L}" y2="${T - 6}" class="ax"/>`);
    o.push(`<text x="${VW - R + 20}" y="${VH - B + 26}" class="ax-text" text-anchor="end">elongation f (µm)</text>`);
    o.push(`<text x="${L - 8}" y="${T}" class="ax-text" text-anchor="end">F (kN)</text>`);
    // FMmax triangle (dashed)
    o.push(`<path d="M${X(0)} ${Yf(0)} L${X(fS)} ${Yf(FMx)} L${X(fS + fP)} ${Yf(0)}" class="tri-max"/>`);
    // service triangle at FVmin
    const fSV = FV * dS * 1000, fPV = FV * dP * 1000;
    const x0 = fS - fSV; // keep the same apex x-position family: shift so the bolt line passes through the origin
    o.push(`<path d="M${X(0)} ${Yf(0)} L${X(fSV)} ${Yf(FV)}" class="bolt-line"/>`);
    o.push(`<path d="M${X(fSV)} ${Yf(FV)} L${X(fSV + fPV)} ${Yf(0)}" class="plate-line"/>`);
    // load
    const df = r.FSA * dS * 1000;
    const xl = X(fSV + df);
    const FS = FV + r.FSA, FK = FV - r.FPA;
    if (r.FAmax > 0) {
      o.push(`<line x1="${X(fSV)}" y1="${Yf(FV)}" x2="${xl}" y2="${Yf(FS)}" class="bolt-line"/>`);
      o.push(`<line x1="${xl}" y1="${Yf(FS)}" x2="${xl}" y2="${Yf(Math.max(0, FK))}" class="fa-line"/>`);
      o.push(`<line x1="${xl}" y1="${Yf(Math.max(0, FK))}" x2="${xl}" y2="${Yf(0)}" class="fkr-line"/>`);
    }
    o.push(`<circle cx="${X(fSV)}" cy="${Yf(FV)}" r="3" class="pt"/>`);
    // annotations right
    const ax = VW - R + 28;
    const lab = (F, t, cls) => `<line x1="${X(0)}" y1="${Yf(F)}" x2="${ax - 4}" y2="${Yf(F)}" class="guide"/><text x="${ax}" y="${Yf(F) + 4}" class="ann ${cls || ''}">${t}</text>`;
    const items = [
      [FMx, 'F<tspan baseline-shift="sub" font-size="9">M,max</tspan> ' + f(FMx / 1000, 1) + ' kN', 'muted'],
      [FV, 'F<tspan baseline-shift="sub" font-size="9">V,min</tspan> ' + f(FV / 1000, 1) + ' kN', ''],
    ];
    if (r.FAmax > 0) {
      items.push([FS, 'F<tspan baseline-shift="sub" font-size="9">V</tspan> + F<tspan baseline-shift="sub" font-size="9">SA</tspan> ' + f(FS / 1000, 1) + ' kN', 'bolt']);
      items.push([Math.max(0, FK), 'F<tspan baseline-shift="sub" font-size="9">KR,min</tspan> ' + f(FK / 1000, 1) + ' kN', FK > 0 ? 'ok' : 'err']);
    }
    items.sort((a, b) => b[0] - a[0]);
    let lastY = -99;
    items.forEach(([F, t, c]) => {
      let yy = Yf(F);
      if (yy - lastY < 17) yy = lastY + 17;
      lastY = yy;
      o.push(`<line x1="${X(0)}" y1="${Yf(F)}" x2="${ax - 4}" y2="${yy}" class="guide"/><text x="${ax}" y="${yy + 4}" class="ann ${c}">${t}</text>`);
    });
    // labels on the lines
    o.push(`<text x="${X(fSV * 0.45) - 8}" y="${Yf(FV * 0.45) - 6}" class="ann bolt" text-anchor="end">bolt</text>`);
    o.push(`<text x="${X(fSV + fPV * 0.55) + 6}" y="${Yf(FV * 0.45) - 6}" class="ann plate">clamped parts</text>`);
    if (r.FAmax > 0) o.push(`<text x="${xl + 5}" y="${(Yf(FS) + Yf(Math.max(0, FK))) / 2 + 4}" class="ann fa">F<tspan baseline-shift="sub" font-size="9">A</tspan></text>`);
    // embedding loss
    if (r.FZ > 0) o.push(`<text x="${L + 6}" y="${VH - B + 26}" class="ann muted">F<tspan baseline-shift="sub" font-size="9">Z</tspan> = ${f(r.FZ / 1000, 2)} kN embedding · Φ<tspan baseline-shift="sub" font-size="9">n</tspan> = ${f(r.Phi, 3)}</text>`);
    // ticks
    for (let i = 1; i <= 4; i++) {
      const F = Fmax / 4.6 * i;
      const val = F / 1000;
      o.push(`<text x="${L - 6}" y="${Yf(F) + 4}" class="tick" text-anchor="end">${f(val, val < 10 ? 1 : 0)}</text><line x1="${L - 3}" y1="${Yf(F)}" x2="${L}" y2="${Yf(F)}" class="ax"/>`);
      const u = fmax / 4.6 * i;
      o.push(`<text x="${X(u)}" y="${VH - B + 13}" class="tick" text-anchor="middle">${f(u, 0)}</text>`);
    }
    void x0;
    o.push('</svg>');
    return o.join('');
  }

  // ------------------------------------------------------------------
  function threadDetail(r) {
    const g = r.g;
    const VW = 560, VH = 230;
    const o = [];
    const id = 'td' + (++uid);
    o.push(`<svg viewBox="0 0 ${VW} ${VH}" role="img" aria-label="Thread profile and stress area">${hatchDefs(id)}`);
    // left: ISO basic profile over two pitches; the scale follows P so the 60° geometry is true
    const P = g.P;
    const yTop = 34, yBot = 222;
    const rLo = g.d3 / 2 - 0.45 * P, rHi = g.d / 2 + 0.45 * P;
    const sc = (yBot - yTop) / (rHi - rLo);
    const x0 = 24;
    const Yr = rad => yBot - (rad - rLo) * sc;
    const yAxis = yBot - 8;
    const fw = (g.d / 2 - g.d3 / 2) * Math.tan(Math.PI / 6);
    const crest = P / 8, root = Math.max(0, P - 2 * fw - crest);
    const xEnd = x0 + 2 * P * sc;
    const clip = (x) => r1(Math.min(Math.max(x, x0), xEnd));
    const prof = [];
    for (let i = 0; i < 3; i++) {
      const xs = x0 + i * P * sc;
      prof.push([xs, g.d3 / 2], [xs + root * sc, g.d3 / 2], [xs + (root + fw) * sc, g.d / 2], [xs + (root + fw + crest) * sc, g.d / 2], [xs + P * sc, g.d3 / 2]);
    }
    o.push(`<path d="M${x0} ${yAxis + 8} L${prof.map(p => clip(p[0]) + ' ' + r1(Yr(p[1]))).join(' L')} L${r1(xEnd)} ${yAxis + 8}Z" class="bolt"/>`);
    const fwN = (g.d / 2 - g.D1 / 2) * Math.tan(Math.PI / 6);
    const prof2 = [];
    for (let i = -1; i < 3; i++) {
      const xs = x0 + (i * P + root / 2 - P / 8) * sc;
      prof2.push([xs, g.D1 / 2], [xs + (P / 4) * sc, g.D1 / 2], [xs + (P / 4 + fwN) * sc, g.d / 2], [xs + (P / 4 + fwN + P / 8) * sc, g.d / 2]);
    }
    o.push(`<path d="M${x0} ${yTop} L${prof2.map(p => clip(p[0]) + ' ' + r1(Yr(p[1]))).join(' L')} L${r1(xEnd)} ${yTop}Z" class="nut-prof"/>`);
    o.push(`<text x="${x0 + 6}" y="${yTop + 14}" class="lbl">nut</text><text x="${x0 + 6}" y="${yBot - 6}" class="lbl">bolt</text>`);
    // pitch dimension
    const xp1 = x0 + (root + fw + crest / 2) * sc, xp2 = xp1 + P * sc, yp = Yr(g.d / 2) - 10;
    o.push(`<line x1="${r1(xp1)}" y1="${r1(yp)}" x2="${r1(xp2)}" y2="${r1(yp)}" class="dim" marker-start="url(#${id}-arr)" marker-end="url(#${id}-arr)"/><text x="${r1((xp1 + xp2) / 2)}" y="${r1(yp - 4)}" class="dim-text" text-anchor="middle">P</text>`);
    // diameter lines with labels spread to avoid overlap
    const dls = [
      [g.d / 2, 'd = ' + f(g.d, 3), 'dl'],
      [g.d2 / 2, 'd₂ = ' + f(g.d2, 3), 'dl pitch'],
      [g.ds / 2, 'd<tspan baseline-shift="sub" font-size="9">S</tspan> = ' + f(g.ds, 3) + ' (A<tspan baseline-shift="sub" font-size="9">S</tspan>)', 'dl stress'],
      [g.d3 / 2, 'd₃ = ' + f(g.d3, 3), 'dl'],
    ];
    let lastLY = -99;
    for (const [rad, t, cls] of dls) {
      const yl = Yr(rad);
      const ty = Math.max(yl + 4, lastLY + 18);
      lastLY = ty;
      o.push(`<line x1="${x0}" y1="${r1(yl)}" x2="${r1(xEnd + 8)}" y2="${r1(yl)}" class="${cls}"/><line x1="${r1(xEnd + 8)}" y1="${r1(yl)}" x2="${r1(xEnd + 16)}" y2="${r1(ty - 4)}" class="leader"/><text x="${r1(xEnd + 19)}" y="${r1(ty)}" class="dim-text">${t}</text>`);
    }
    o.push(`<text x="${x0}" y="16" class="lbl">ISO basic profile · P = ${f(P, 2)} mm · 60°</text>`);
    // right: cross-section circles
    const cx = 470, cy = 122, R = 78;
    const s2 = R / (g.d / 2);
    o.push(`<circle cx="${cx}" cy="${cy}" r="${r1(R)}" class="c-nom"/>`);
    o.push(`<circle cx="${cx}" cy="${cy}" r="${r1(g.ds / 2 * s2)}" class="c-as"/>`);
    o.push(`<circle cx="${cx}" cy="${cy}" r="${r1(g.d3 / 2 * s2)}" class="c-d3"/>`);
    o.push(`<text x="${cx}" y="${cy - 6}" class="lbl" text-anchor="middle">A<tspan baseline-shift="sub" font-size="9">S</tspan> = ${f(g.As, 1)} mm²</text>`);
    o.push(`<text x="${cx}" y="${cy + 10}" class="dim-text" text-anchor="middle">A<tspan baseline-shift="sub" font-size="9">d3</tspan> = ${f(g.Ad3, 1)} mm²</text>`);
    o.push(`<text x="${cx}" y="${cy + R + 18}" class="dim-text" text-anchor="middle">A<tspan baseline-shift="sub" font-size="9">N</tspan> = ${f(g.AN, 1)} mm² (nominal)</text>`);
    o.push(`<text x="${cx}" y="16" class="lbl" text-anchor="middle">Section through the thread</text>`);
    o.push('</svg>');
    return o.join('');
  }

  // ------------------------------------------------------------------
  function frictionChart(r) {
    const VW = 560, VH = 260, L = 50, R = 20, T = 16, B = 38;
    const muA = 0.05, muB = Math.max(0.3, r.muGmax + 0.06);
    const C = root.BJ_CALC;
    const pts = C.preloadVsFriction(r, muA, muB, 60);
    const yieldPts = pts.map(p => ({ mu: p.mu, F: C.FMzul(r.g, r.bc.Rp, 1.0, p.mu) }));
    const Fmax = Math.max(...pts.map(p => p.F), ...yieldPts.map(p => p.F), r.FMerf) * 1.08;
    const X = mu => L + (mu - muA) / (muB - muA) * (VW - L - R);
    const Yf = F => VH - B - Math.min(F, Fmax) / Fmax * (VH - T - B);
    const o = [];
    o.push(`<svg viewBox="0 0 ${VW} ${VH}" role="img" aria-label="Preload against thread friction">`);
    o.push(`<rect x="${X(r.muGmin)}" y="${T}" width="${Math.max(1, X(r.muGmax) - X(r.muGmin))}" height="${VH - T - B}" class="band"/>`);
    o.push(`<line x1="${L}" y1="${VH - B}" x2="${VW - R}" y2="${VH - B}" class="ax"/><line x1="${L}" y1="${VH - B}" x2="${L}" y2="${T}" class="ax"/>`);
    for (let i = 0; i <= 4; i++) {
      const F = Fmax / 4 * i;
      o.push(`<line x1="${L}" y1="${Yf(F)}" x2="${VW - R}" y2="${Yf(F)}" class="grid"/><text x="${L - 6}" y="${Yf(F) + 4}" class="tick" text-anchor="end">${f(F / 1000, F / 1000 < 10 ? 1 : 0)}</text>`);
    }
    for (let mu = 0.05; mu <= muB + 1e-9; mu += 0.05) o.push(`<text x="${X(mu)}" y="${VH - B + 14}" class="tick" text-anchor="middle">${mu.toFixed(2)}</text>`);
    o.push(`<text x="${VW - R}" y="${VH - 6}" class="ax-text" text-anchor="end">thread friction μ<tspan baseline-shift="sub" font-size="9">G</tspan> (μ<tspan baseline-shift="sub" font-size="9">K</tspan> scaled)</text>`);
    o.push(`<text x="${L + 4}" y="${T + 10}" class="ax-text">F<tspan baseline-shift="sub" font-size="9">M</tspan> (kN)</text>`);
    const line = (arr, cls) => `<path d="M${arr.map(p => r1(X(p.mu)) + ' ' + r1(Yf(p.F))).join('L')}" class="${cls}"/>`;
    o.push(line(yieldPts, 'yield-line'));
    o.push(`<line x1="${L}" y1="${Yf(r.FMerf)}" x2="${VW - R}" y2="${Yf(r.FMerf)}" class="req-line"/>`);
    o.push(line(pts, 'fm-line'));
    const lbl = (x, y, t, cls) => `<text x="${x}" y="${y}" class="ann ${cls}">${t}</text>`;
    o.push(`<text x="${VW - R - 4}" y="${Yf(yieldPts[yieldPts.length - 1].F) - 6}" class="ann err" text-anchor="end">yield point (ν = 100 %)</text>`);
    o.push(lbl(L + 6, Yf(r.FMerf) + 14, 'F<tspan baseline-shift="sub" font-size="9">M,erf</tspan> required ' + f(r.FMerf / 1000, 1) + ' kN', 'warn'));
    const pMin = { mu: r.muGmin, F: r.MA / r.Kmin }, pMax = { mu: r.muGmax, F: r.MA / r.Kmax };
    o.push(`<circle cx="${X(pMin.mu)}" cy="${Yf(pMin.F)}" r="4" class="pt"/><circle cx="${X(pMax.mu)}" cy="${Yf(pMax.F)}" r="4" class="pt"/>`);
    o.push(lbl(X(pMin.mu) + 7, Yf(pMin.F) - 7, f(pMin.F / 1000, 1) + ' kN', 'bolt'));
    o.push(lbl(X(pMax.mu) + 7, Yf(pMax.F) - 7, f(pMax.F / 1000, 1) + ' kN', 'bolt'));
    o.push(lbl(X(muB) - 190, Yf(pts[pts.length - 1].F) + 16, 'preload at M<tspan baseline-shift="sub" font-size="9">A</tspan> = ' + f(r.MA / 1000, 1) + ' N·m', 'bolt'));
    o.push('</svg>');
    return o.join('');
  }

  function torqueBar(r) {
    const t = r.torqueParts;
    const parts = [['Pitch (useful preload)', t.pitch, 's3'], ['Thread friction', t.thread, 's2'], ['Head friction', t.head, 's4']];
    return `<div class="tbar">${parts.map(p => `<div class="tseg ${p[2]}" style="flex:${p[1]}" title="${p[0]}: ${f(p[1] * 100, 0)} %"><span>${f(p[1] * 100, 0)} %</span></div>`).join('')}</div>
      <div class="tlegend">${parts.map(p => `<span><i class="${p[2]}"></i>${p[0]}</span>`).join('')}</div>`;
  }

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }

  root.BJ_DRAW = { jointSection, jointDiagram, threadDetail, frictionChart, torqueBar };
})(window);
