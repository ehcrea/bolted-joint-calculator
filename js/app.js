/* Bolted Joint Calculator: user interface. */
(function () {
  'use strict';
  const D = window.BJ_DATA, C = window.BJ_CALC, DR = window.BJ_DRAW, PR = window.BJ_PRESETS;
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const f = (x, d) => C.fmtN(x, d);
  const STORE = 'bolt.state';
  const clone = o => JSON.parse(JSON.stringify(o));

  let state = loadState();

  // ---------------- state ----------------
  function loadState() {
    const fromHash = decodeHash();
    if (fromHash) return Object.assign(clone(PR.DEFAULT), fromHash);
    try {
      const s = JSON.parse(localStorage.getItem(STORE) || 'null');
      if (s && typeof s === 'object') return Object.assign(clone(PR.DEFAULT), s);
    } catch (e) { /* ignore */ }
    return clone(PR.DEFAULT);
  }
  function save() { try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) { /* ignore */ } }
  function encodeHash() { return '#s=' + btoa(unescape(encodeURIComponent(JSON.stringify(state)))); }
  function decodeHash() {
    const m = location.hash.match(/#s=([^&]+)/);
    if (!m) return null;
    try { return JSON.parse(decodeURIComponent(escape(atob(m[1])))); } catch (e) { return null; }
  }

  // ---------------- setup ----------------
  function opt(sel, items) { sel.innerHTML = items.map(([v, t]) => `<option value="${v}">${t}</option>`).join(''); }
  function setup() {
    opt($('#thread'), D.threadList().map(t => [t.id, t.label]));
    opt($('#cls'), Object.entries(D.BOLT_CLASSES).map(([k, v]) => [k, v.label]));
    opt($('#washerGrade'), Object.entries(D.WASHER_GRADES).map(([k, v]) => [k, v.label]));
    opt($('#rough'), Object.entries(D.EMBEDDING).map(([k, v]) => [k, v.label]));
    opt($('#tapMat'), matOptions());
    opt($('#hcLen'), D.HELICOIL_LENGTHS.map(x => [x, x + ' × d']));
    opt($('#friction'), Object.entries(D.FRICTION).map(([k, v]) => [k, v.label + (v.est ? ' ~' : '')]));
    opt($('#lock'), Object.entries(D.LOCKING).map(([k, v]) => [k, v.label]));
    opt($('#method'), Object.entries(D.TIGHTENING).map(([k, v]) => [k, v.label + ' · α<sub>A</sub> ' + v.range]));
    $$('#method option').forEach(o => { o.textContent = o.textContent.replace(/<\/?sub>/g, ''); });
    $('#muT-list').innerHTML = D.INTERFACE_FRICTION.map(([t, v]) => `<option value="${v}">${t}</option>`).join('');
    opt($('#preset'), [['', 'Load application example…']].concat(PR.PRESETS.map(p => [p.id, p.label])));

    $$('[data-key]', $('#form')).forEach(el => {
      el.addEventListener(el.tagName === 'SELECT' || el.type === 'checkbox' ? 'change' : 'input', () => {
        const k = el.dataset.key;
        if (el.type === 'checkbox') state[k] = el.checked;
        else if (el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') state[k] = el.value;
        else state[k] = el.value === '' ? '' : parseFloat(el.value);
        if (/^mu[GK](min|max)$/.test(k) && state.friction !== 'custom') { copyFriction(); state.friction = 'custom'; state[k] = el.value === '' ? '' : parseFloat(el.value); }
        if (k === 'friction') copyFriction();
        if (k === 'thread') adaptToThread();
        if (k === 'hcLen') state.hcLen = parseFloat(el.value);
        update(el);
      });
    });
    bindSeg('#joint-picker', 'joint');
    bindSeg('#head', 'head');
    bindSeg('#mode', 'mode', () => {
      if (state.mode === 'torque' && lastResult && lastResult.valid) state.MA = Math.round(lastResult.MA / 100) / 10;
    });
    // custom bolt pattern: fill the list from the circular or rectangular inputs
    $$('[data-fill]').forEach(b => b.addEventListener('click', () => {
      const pts = C.patternBolts(Object.assign({}, state, { patType: b.dataset.fill }));
      const r2 = x => Math.round(x * 100) / 100 + 0;
      state.patPts = pts.map(p => r2(p.x) + ', ' + r2(p.y)).join('\n');
      update();
    }));
    $('#add-plate').addEventListener('click', () => {
      if (state.plates.length >= 5) return;
      const last = state.plates[state.plates.length - 1] || { mat: 'S235', t: 10 };
      state.plates.push({ mat: last.mat, t: last.t });
      update();
    });
    $('#preset').addEventListener('change', e => {
      const p = PR.PRESETS.find(x => x.id === e.target.value);
      if (!p) return;
      // keep the aerospace check settings (section 6) when switching examples
      const keepNasa = Object.fromEntries(Object.keys(PR.DEFAULT).filter(k => /^n[A-Z]|^nasa$/.test(k)).map(k => [k, state[k]]));
      state = Object.assign(clone(PR.DEFAULT), clone(p.s), keepNasa);
      e.target.value = '';
      update();
      toast('Loaded: ' + p.label);
    });
    $('#share').addEventListener('click', () => {
      const url = location.origin + location.pathname + encodeHash();
      history.replaceState(null, '', encodeHash());
      (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(() => toast('Link copied'), () => toast('Link is in the address bar'));
    });
    $('#print').addEventListener('click', () => { $('#steps-card').open = true; window.print(); });
    $('#theme').addEventListener('click', () => {
      const cur = document.documentElement.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      const next = cur === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('ehcrea.theme', next); } catch (e) { /* ignore */ }
    });
    $$('[data-load-preset]').forEach(btn => btn.addEventListener('click', () => {
      const sel = $('#preset');
      sel.value = btn.dataset.loadPreset;
      sel.dispatchEvent(new Event('change'));
      btn.closest('dialog').close();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }));
    $('#help-open').addEventListener('click', renderPcbHelp);
    const dlg = (btn, id) => $(btn).addEventListener('click', e => { e.preventDefault(); $(id).showModal(); });
    dlg('#about-open', '#about'); dlg('#about-link', '#about'); dlg('#help-open', '#help');
    renderLibs();
  }

  function matOptions() {
    const groups = {};
    for (const [k, m] of Object.entries(D.MATERIALS)) (groups[m.group] = groups[m.group] || []).push([k, m.label + (m.est ? ' ~' : '')]);
    return Object.values(groups).flat();
  }

  function bindSeg(sel, key, after) {
    $$(sel + ' button').forEach(b => b.addEventListener('click', () => {
      state[key] = b.dataset[key];
      if (after) after();
      update();
    }));
  }

  function copyFriction() {
    const fr = D.FRICTION[state.friction];
    if (!fr || fr.custom) return;
    state.muGmin = fr.muG[0]; state.muGmax = fr.muG[1]; state.muKmin = fr.muK[0]; state.muKmax = fr.muK[1];
  }

  function adaptToThread() {
    const t = C.findThread(state.thread);
    if (state.joint === 'insert') {
      // sensible default outer thread for a solid insert
      const table = { 3: [6, 0.75], 4: [8, 1.25], 5: [8, 1.25], 6: [10, 1.5], 8: [12, 1.5], 10: [14, 1.5], 12: [16, 1.5], 14: [18, 1.5], 16: [20, 1.5], 20: [27, 2] };
      const e = table[t.d];
      if (e) { state.insD = e[0]; state.insP = e[1]; }
    }
  }

  // ---------------- form sync ----------------
  function syncForm(skipPlates) {
    $$('[data-key]', $('#form')).forEach(el => {
      const v = state[el.dataset.key];
      if (el.type === 'checkbox') el.checked = !!v;
      else if (document.activeElement !== el) el.value = v === undefined || v === null ? '' : v;
    });
    const fr = D.FRICTION[state.friction];
    $$('[data-key^="muG"],[data-key^="muK"]').forEach(el => { el.classList.toggle('derived', !!(fr && !fr.custom)); });
    for (const [sel, key] of [['#joint-picker', 'joint'], ['#head', 'head'], ['#mode', 'mode']]) {
      $$(sel + ' button').forEach(b => b.setAttribute('aria-checked', String(b.dataset[key] === state[key])));
    }
    const esv = state.joint !== 'nut';
    const show = {
      washer: state.washer !== 'none',
      'washer-nut': state.washer !== 'none' && !esv,
      'dh-custom': state.holeFit === 'custom',
      esv, 'engage-input': state.joint === 'tapped' || state.joint === 'insert',
      helicoil: state.joint === 'helicoil', insert: state.joint === 'insert',
      'mode-nu': state.mode !== 'torque', 'mode-torque': state.mode === 'torque',
      nasa: !!state.nasa,
      pry: !!state.pryOn,
      ecc: !!state.eccOn,
      pat: !!state.patOn, 'no-pat': !state.patOn,
      'pat-circle': state.patType === 'circle' || !state.patType, 'pat-rect': state.patType === 'rect', 'pat-custom': state.patType === 'custom',
      'pat-flex': !!state.patOn && state.patType === 'rect' && !!state.patFlex,
    };
    $$('[data-show]').forEach(el => { el.hidden = !el.dataset.show.split(' ').some(t => show[t]); });
    $('#engage-title').textContent = { tapped: 'Tapped part', helicoil: 'Heli-Coil (wire thread insert)', insert: 'Solid threaded insert' }[state.joint] || '';
    $('#engage-label').firstChild.textContent = state.joint === 'insert' ? 'Insert length ' : 'Engagement length ';
    $('#joint-hint').innerHTML = {
      nut: 'Through-bolted joint (DSV): bolt, clamped parts and a nut ISO 4032 of the same property class.',
      tapped: 'Tapped thread joint (ESV): the bolt is screwed into a threaded hole in the last part.',
      helicoil: 'A helical wire insert (DIN 8140) in an STI-tapped hole: the parent material is sheared at the larger STI diameter and the thread is wear resistant.',
      insert: 'A solid steel insert (e.g. key-locked or self-tapping bush) with a coarse outer thread spreads the load over a larger diameter in soft materials.',
    }[state.joint];
    if (!skipPlates) renderPlates();
  }

  function renderPlates() {
    const box = $('#plates');
    const mats = matOptions();
    box.innerHTML = state.plates.map((p, i) => `
      <div class="plate-row" data-i="${i}">
        <span class="plate-no">${i + 1}</span>
        <label><span class="sr-only">Material of part ${i + 1}</span><select data-p="mat">${mats.map(([k, t]) => `<option value="${k}"${k === p.mat ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
        <label class="t"><span class="sr-only">Thickness of part ${i + 1} (mm)</span><input type="number" step="any" min="0" data-p="t" value="${p.t}"></label>
        <span class="u">mm</span>
        <button type="button" class="btn btn-icon" data-p="del" title="Remove part" aria-label="Remove part ${i + 1}"${state.plates.length <= 1 ? ' disabled' : ''}>✕</button>
      </div>`).join('');
    $$('.plate-row', box).forEach(row => {
      const i = +row.dataset.i;
      $('[data-p="mat"]', row).addEventListener('change', e => { state.plates[i].mat = e.target.value; update(); });
      $('[data-p="t"]', row).addEventListener('input', e => { state.plates[i].t = parseFloat(e.target.value) || 0; update(e.target); });
      $('[data-p="del"]', row).addEventListener('click', () => { state.plates.splice(i, 1); update(); });
    });
  }

  // ---------------- update ----------------
  let lastResult = null;
  function calcInput() {
    const s = clone(state);
    if (s.joint === 'helicoil') s.engage = (parseFloat(s.hcLen) || 1.5) * C.findThread(s.thread).d;
    return s;
  }
  function update(focusEl) {
    syncForm(!!(focusEl && focusEl.dataset && focusEl.dataset.p));
    let r;
    try { r = C.calculate(calcInput()); } catch (e) { console.error(e); r = { valid: false, issues: [{ level: 'error', text: 'Calculation error: ' + e.message }] }; }
    lastResult = r;
    render(r);
    save();
    if (location.hash) history.replaceState(null, '', location.pathname);
  }
  // ---------------- render ----------------
  function render(r) {
    const hero = $('#hero');
    if (!r.valid) {
      $('#hero-value').textContent = '—';
      $('#hero-sub').textContent = '';
      $('#hero-side').innerHTML = '';
      setChip('error');
      renderIssues(r.issues);
      ['#section', '#diagram', '#thread-detail', '#friction-chart', '#torque-bar', '#steps', '#checks', '#strip', '#diag-metrics', '#thread-metrics'].forEach(s => { $(s).innerHTML = ''; });
      $('#nasa-card').hidden = true;
      $('#pat-card').hidden = true;
      $('#pry-card').hidden = true;
      $('#ecc-card').hidden = true;
      return;
    }
    hero.classList.remove('invalid');
    $('#hero-value').innerHTML = f(r.MA / 1000, r.MA < 10000 ? 2 : 1) + ' <span class="unit">N·m</span>';
    $('#hero-sub').innerHTML = (state.mode === 'torque' ? 'Given torque' : 'Torque for ν = ' + f(r.nu * 100, 0) + ' % at μ<sub>G,min</sub> = ' + f(r.muGmin, 2) + ', μ<sub>K,min</sub> = ' + f(r.muKmin, 2)) +
      ' · ' + r.thread.label + ' ' + r.bc.key + ' · ' + r.meth.label + ' (α<sub>A</sub> = ' + f(r.aA, 2) + ')';
    const side = [
      ['F<sub>M,max</sub>', f(r.FMmax / 1000, 1) + ' kN'],
      ['F<sub>M,min</sub>', f(r.FMmin / 1000, 1) + ' kN'],
      ['F<sub>KR,min</sub>', f(r.FKRmin / 1000, 1) + ' kN', r.FKRmin > 0 && r.FKRmin >= r.FKerf ? '' : 'error'],
      ['Utilisation ν', f(r.nuActual * 100, 0) + ' %', r.nuActual > 1 ? 'error' : ''],
      ['Load factor Φ<sub>n</sub>', f(r.Phi, 3)],
      ['S<sub>F</sub> / S<sub>D</sub>', f(r.SF, 2) + ' / ' + (isFinite(r.SD) ? f(r.SD, 2) : 'static')],
    ];
    $('#hero-side').innerHTML = side.map(([k, v, c]) => `<div><dt>${k}</dt><dd class="${c || ''}">${v}</dd></div>`).join('');
    setChip(r.status);
    renderIssues(r.issues);

    $('#section').innerHTML = DR.jointSection(r, { headType: state.head });
    $('#diagram').innerHTML = DR.jointDiagram(r);
    $('#diag-metrics').innerHTML = metrics([
      ['δ<sub>S</sub> bolt', sci(r.res.deltaS) + ' mm/N', 'stiffness ' + f(1 / r.res.deltaS / 1000, 0) + ' kN/mm'],
      ['δ<sub>P</sub> parts', sci(r.res.deltaP) + ' mm/N', 'stiffness ' + f(1 / r.res.deltaP / 1000, 0) + ' kN/mm'],
      ['Φ<sub>K</sub> / Φ<sub>n</sub>', f(r.PhiK, 3) + ' / ' + f(r.Phi, 3), 'n = ' + f(r.n, 2)],
      ['F<sub>SA</sub> / F<sub>PA</sub>', f(r.FSA / 1000, 2) + ' / ' + f(r.FPA / 1000, 2) + ' kN', 'of F<sub>A</sub> = ' + f(r.FAmax / 1000, 2) + ' kN'],
      ['Clamp ratio l<sub>K</sub>/d', f(r.lKd, 2), r.lKd >= 3 ? 'long enough (≥ 3)' : r.lKd < 1 ? '<span class="status warn">very short (&lt; 1): aim for ≥ 3</span>' : 'short (&lt; 3): sensitive to settling'],
      ['Embedding f<sub>Z</sub>', f(r.emb.fZum, 1) + ' µm', 'F<sub>Z</sub> = ' + f(r.FZ / 1000, 2) + ' kN (' + f(Math.min(r.FZ / r.FMmin, 1) * 100, 0) + ' % of F<sub>M,min</sub>)'],
      ['Thermal ΔF<sub>Vth</sub>', f(r.dFth / 1000, 2) + ' kN', 'ΔT = ' + f(r.dT, 0) + ' K'],
    ]);
    $('#thread-detail').innerHTML = DR.threadDetail(r);
    $('#thread-metrics').innerHTML = metrics([
      ['Pitch Ø d<sub>2</sub>', f(r.g.d2, 3) + ' mm'], ['Minor Ø d<sub>3</sub>', f(r.g.d3, 3) + ' mm'],
      ['Stress area A<sub>S</sub>', f(r.g.As, 1) + ' mm²'], ['Head bearing Ø d<sub>W</sub>', f(r.dW, 2) + ' mm'],
      ['Clearance hole d<sub>h</sub>', f(r.dh, 1) + ' mm'], ['Bolt length', (r.lenInfo.lStd ? r.lenInfo.lStd + ' mm' : '—'), 'needs ' + f(r.lenInfo.lReq, 1) + ' mm'],
    ]);
    $('#friction-chart').innerHTML = DR.frictionChart(r);
    $('#torque-bar').innerHTML = DR.torqueBar(r);
    renderChecks(r);
    renderPattern(r);
    renderPry(r);
    renderEcc(r);
    renderNasa(r);
    renderStrip(r);
    $('#steps').innerHTML = steps(r);
  }

  function setChip(status) {
    const chip = $('#status-chip');
    chip.className = 'status-chip ' + status;
    chip.textContent = { ok: 'OK', warn: 'Check', error: 'Problem' }[status] || '';
    $('#hero-value').className = 'hero-value ' + (status === 'error' ? 'error' : '');
  }
  function renderIssues(list) {
    const box = $('#issues');
    box.hidden = !list.length;
    const order = { error: 0, warn: 1, info: 2 };
    box.innerHTML = list.slice().sort((a, b) => order[a.level] - order[b.level])
      .map(i => `<div class="issue ${i.level}"><span class="tag">${{ error: 'Error', warn: 'Warning', info: 'Note' }[i.level]}</span><span>${i.text}</span></div>`).join('');
  }
  function metrics(items) {
    return items.map(([k, v, s]) => `<div class="metric"><div class="k">${k}</div><div class="v">${v}</div>${s ? `<div class="s">${s}</div>` : ''}</div>`).join('');
  }
  function sci(x) {
    if (!isFinite(x) || x === 0) return '0';
    const e = Math.floor(Math.log10(Math.abs(x)));
    const m = x / Math.pow(10, e);
    return m.toFixed(3) + '·10<sup>' + e + '</sup>';
  }
  function renderChecks(r) {
    const head = '<thead><tr><th class="left">Step</th><th class="left">Check</th><th>Value</th><th>Limit</th><th>Safety</th><th>Status</th></tr></thead>';
    const rows = r.checks.map(c => `<tr><td class="left">${c.id}</td><td class="left">${c.label}</td><td class="strong">${fmtVal(c.value, c.unit)}</td><td>${c.limit}</td><td>${c.safety !== undefined ? f(c.safety, 2) : ''}</td><td><span class="status ${c.status}">${{ ok: '✓ OK', warn: '! Check', error: '✕ Fail' }[c.status]}</span></td></tr>`).join('');
    $('#checks').innerHTML = head + '<tbody>' + rows + '</tbody>';
  }
  function renderPry(r) {
    const card = $('#pry-card'), p = r.pry;
    card.hidden = !p;
    if (!p) return;
    $('#pry-view').innerHTML = DR.pryView(r);
    $('#pry-badge').textContent = p.ratio > 0 ? '+' + f(p.ratio * 100, 0) + ' % bolt load' : 'no prying';
    const st = (sig) => sig <= p.fAllow ? '' : '<span class="status error">above ' + (p.brittle ? 'R<sub>m</sub>' : 'R<sub>p</sub>') + '</span>';
    $('#pry-metrics').innerHTML = metrics([
      ['Prying ratio Q/T', f(p.ratio, 3), p.raw < 0 ? 'flange stiff enough (formula < 0)' : ''],
      ['Prying force Q', f(p.Q / 1000, 2) + ' kN', 'on T = ' + f(p.T / 1000, 2) + ' kN'],
      ['Bolt load B = T + Q', f((p.T + p.Q) / 1000, 2) + ' kN', 'used as F<sub>A,max</sub>'],
      ['Stiffness term w·t⁴/(a·b²·A<sub>b</sub>)', f(p.X, 2), 'prying ends above 15'],
      ['Flange bending, web face', f(p.sigWeb, 0) + ' MPa', (st(p.sigWeb) || '≤ ' + f(p.fAllow, 0) + ' MPa')],
      ['Flange bending, bolt line', f(p.sigBolt, 0) + ' MPa', (st(p.sigBolt) || 'net width ' + f(p.wNet, 1) + ' mm')],
    ]);
  }
  function renderEcc(r) {
    const card = $('#ecc-card'), e = r.ecc;
    card.hidden = !e;
    if (!e) return;
    $('#ecc-view').innerHTML = DR.eccView(r);
    const open = isFinite(e.FKA) && r.FKRmin < e.FKA;
    const badge = $('#ecc-badge');
    badge.textContent = open ? 'opens on one side' : 'stays closed';
    badge.className = 'badge' + (open ? ' bad' : '');
    $('#ecc-metrics').innerHTML = metrics([
      ['Load factor Φ<sub>en</sub>*', f(e.PhiEn, 4), 'concentric Φ<sub>n</sub> = ' + f(e.PhiCon, 4)],
      ['Resilience δ<sub>P</sub>* / δ<sub>P</sub>', f(e.dPstar / e.dP, 3), 'eccentric clamping'],
      ['Bending inertia Ī<sub>Bers</sub>', f(e.IBers, 0) + ' mm⁴', e.IBauto ? (e.IBers < e.Iers ? 'limited to I<sub>BT</sub>' : 'auto estimate') : 'entered'],
      ['Clamp load against opening F<sub>KA</sub>', isFinite(e.FKA) ? f(e.FKA / 1000, 2) + ' kN' : '∞', 'F<sub>KR,min</sub> = ' + f(r.FKRmin / 1000, 2) + ' kN'],
      ['Bending factor on σ<sub>a</sub>', e.bendFactor !== undefined ? f(e.bendFactor, 2) : '–', 'σ<sub>SAb</sub> / σ<sub>SA</sub>'],
      ['Interface A<sub>D</sub>, I<sub>BT</sub>', f(e.AD, 0) + ' mm², ' + sci(e.IBT) + ' mm⁴', ''],
    ]);
  }
  function renderPattern(r) {
    const card = $('#pat-card'), P = r.pat;
    card.hidden = !P;
    if (!P) return;
    $('#pat-view').innerHTML = DR.patternView(r, state);
    const FX = P.flex;
    $('#pat-badge').textContent = P.n + ' bolts · ' + (FX ? 'flexible flange' : P.method === 'heel' ? 'heel model' : 'centroid model');
    $('#pat-note').innerHTML = (FX ? 'Flexible-flange model along x (beam on elastic bolt supports), rigid along y' : 'Rigid-flange (bolt group) model') +
      ': tension from F<sub>z</sub> and bending, shear from F<sub>x</sub>, F<sub>y</sub> and torsion. The most loaded bolt (red ring) is checked in all results below.';
    const head = '<thead><tr><th class="left">Bolt</th><th>x (mm)</th><th>y (mm)</th><th>Tension F<sub>A</sub> (kN)</th>' + (FX ? '<th>Rigid model (kN)</th>' : '') + '<th>Shear F<sub>Q</sub> (kN)</th></tr></thead>';
    const rows = P.bolts.map(b => `<tr class="${b === P.critA && P.FAmax > 0 ? 'hl' : ''}"><td class="left">${b.i}${b === P.critA && P.FAmax > 0 ? ' <span class="badge">max tension</span>' : ''}${b === P.critQ && P.FQmax > 0 ? ' <span class="badge">max shear</span>' : ''}</td>` +
      `<td>${f(b.xu, 1)}</td><td>${f(b.yu, 1)}</td><td class="strong">${f(b.FA / 1000, 3)}${b.FA < 0 ? ' <span class="hint">(less clamp)</span>' : ''}</td>${FX ? `<td>${f(b.FArigid / 1000, 3)}</td>` : ''}<td>${f(b.FQ / 1000, 3)}</td></tr>`).join('');
    $('#pat-table').innerHTML = head + '<tbody>' + rows + '</tbody>';
    $('#pat-pts-info').innerHTML = P.custom ? P.n + ' bolts read' + (P.bad.length ? ', line ' + P.bad.join(', ') + ' ignored' : '') + '. Centroid C at (' + f(P.cx0, 1) + ', ' + f(P.cy0, 1) + ') mm.' : '';
    $('#pat-flex').hidden = !FX;
    if (FX) {
      $('#pat-flex-view').innerHTML = DR.flexView(r);
      const inc = P.rigidMax > 0 ? P.FAmax / P.rigidMax : NaN;
      $('#pat-flex-metrics').innerHTML = metrics([
        ['Most loaded bolt', f(P.FAmax / 1000, 2) + ' kN', isFinite(inc) ? f(inc, 2) + '× the rigid model (' + f(P.rigidMax / 1000, 2) + ' kN)' : ''],
        ['Joint stiffness per bolt k', f(FX.k / 1000, 0) + ' kN/mm', '1/δ<sub>S</sub> + 1/δ<sub>P</sub> (joint closed)'],
        ['Flange bending stiffness EI', sci(FX.EI) + ' N·mm²', 'b = ' + f(FX.b, 0) + ' mm, t = ' + f(FX.t, 1) + ' mm, E = ' + f(FX.E, 0) + ' MPa'],
        ['Flange bending stress', f(FX.sig, 0) + ' MPa', FX.sig <= FX.fAllow ? '≤ ' + f(FX.fAllow, 0) + ' MPa (' + FX.mat.label + ')' : '<span class="status error">above ' + (FX.brittle ? 'R<sub>m</sub>' : 'R<sub>p</sub>') + ' ' + f(FX.fAllow, 0) + ' MPa</span>'],
        ['Max flange deflection', f(Math.max(...FX.line.map(p => Math.abs(p.w))) * 1000, 1) + ' µm', 'at the load F<sub>z</sub> = ' + f(P.Fz / 1000, 2) + ' kN'],
      ]);
    }
  }
  function renderNasa(r) {
    const card = $('#nasa-card'), N = r.nasa;
    card.hidden = !N;
    if (!N) return;
    const kN = x => f(x / 1000, 2);
    $('#nasa-metrics').innerHTML = metrics([
      ['Nut factor K', f(N.K, 3), 'at mean friction'],
      ['Preload uncertainty Γ', '±' + f(N.Gamma * 100, 0) + ' %', N.Gamma === N.GammaAuto ? 'auto: ' + (N.dry ? 'dry / thread-locker' : 'lubricated') : 'user value'],
      ['Torque range', f(N.Tmin / 1000, 2) + '–' + f(N.Tmax / 1000, 2) + ' N·m', '± ' + f(N.tol * 100, 0) + ' % on M<sub>A</sub>'],
      ['Initial preload P<sub>pi</sub>', kN(N.Ppimin) + '–' + kN(N.Ppimax) + ' kN', N.TpvMax > 0 ? (N.tpvAdded ? 'running torque already excluded' : 'running torque subtracted') : ''],
      ['Service preload P<sub>p</sub>', '<span class="' + (N.Ppmin <= 0 ? 'status error' : '') + '">' + kN(N.Ppmin) + '</span>–' + kN(N.Ppmax) + ' kN', 'relaxation ' + kN(N.Prelax) + ' kN' + (N.relaxFromVDI ? ' (VDI embedding)' : ' (' + f(N.relax * 100, 0) + ' %)')],
      ['Load factor nφ', f(N.nphi, 3), 'from the VDI 2230 stiffness'],
    ]);
    const head = '<thead><tr><th class="left">Check</th><th>Allowable</th><th>Factored load</th><th>MS</th><th>Status</th></tr></thead>';
    const fmtF = (x, k) => k === 'inter' ? f(x, 3) : (isFinite(x) ? kN(x) + ' kN' : '—');
    const rows = N.margins.map(m => {
      const st = m.MS < 0 ? 'error' : 'ok';
      return `<tr><td class="left">${m.label}<div class="hint">${m.formula}</div></td><td>${fmtF(m.allow, m.key)}</td><td>${fmtF(m.load, m.key)}</td>` +
        `<td class="strong">${isFinite(m.MS) ? f(m.MS, 2) : '∞'}</td><td><span class="status ${st}">${st === 'ok' ? '✓ MS ≥ 0' : '✕ MS < 0'}</span></td></tr>`;
    }).join('');
    $('#nasa-table').innerHTML = head + '<tbody>' + rows + '</tbody>';
    $('#nasa-badge').textContent = 'lowest MS ' + (isFinite(N.worstMS) ? f(N.worstMS, 2) : '∞');
    $('#nasa-badge').className = 'badge ' + (N.worstMS < 0 ? 'bad' : '');
  }
  function fmtVal(v, u) { return (isFinite(v) ? f(v, u === '%' ? 0 : (Math.abs(v) < 10 ? 2 : 1)) : '∞') + (u ? ' ' + u : ''); }

  function renderStrip(r) {
    const s = r.strip;
    const head = '<thead><tr><th class="left">Failure mode</th><th>τ<sub>B</sub> (MPa)</th><th>Shear area (mm²)</th><th>Strength (kN)</th><th>vs. bolt break</th></tr></thead>';
    const rows = s.modes.map(m => `<tr class="${m === s.weakest ? 'hl' : ''}"><td class="left">${m.label}${m === s.weakest ? ' <span class="badge">weakest</span>' : ''}</td><td>${f(m.tau, 0)}</td><td>${f(m.A, 0)}</td><td class="strong">${f(m.F / 1000, 1)}</td><td>${f(m.F / s.Fbreak * 100, 0)} %</td></tr>`).join('') +
      `<tr><td class="left">Bolt tensile break A<sub>S</sub>·R<sub>m</sub></td><td></td><td>${f(r.g.As, 1)}</td><td class="strong">${f(s.Fbreak / 1000, 1)}</td><td>100 %</td></tr>`;
    $('#strip').innerHTML = head + '<tbody>' + rows + '</tbody>';
    $('#strip-badge').textContent = 'engagement ' + f(r.Le, 1) + ' mm = ' + f(r.Le / r.g.d, 2) + ' d';
    $('#strip-hint').innerHTML = (s.LeReq ? 'Engagement length for the parent thread to be as strong as the bolt: <b>' + f(s.LeReq, 1) + ' mm</b> (' + f(s.LeReq / r.g.d, 2) + ' d). ' : '') +
      'Bolt length: ' + r.lenInfo.note + ' = ' + f(r.lenInfo.lReq, 1) + ' mm' + (r.lenInfo.lStd ? ' → standard length ' + r.lenInfo.lStd + ' mm.' : '.');
  }

  // ---------------- formula derivation ----------------
  function steps(r) {
    const g = r.g, kN = x => f(x / 1000, 2) + ' kN', N = (x, d) => f(x, d);
    const S = [];
    const step = (id, title, rows, note) => S.push(`<section class="calc-step"><h3><span class="sid">${id}</span>${title}</h3><table class="ftable">${rows.map(([a, b, c]) => `<tr><td class="fl">${a}</td><td class="fs">${b || ''}</td><td class="fr">${c || ''}</td></tr>`).join('')}</table>${note ? `<p class="hint">${note}</p>` : ''}</section>`);

    const PT = r.pat;
    if (PT) {
      const cb = PT.critA, mm = x => N(x / 1000, 0);
      const rows = [
        ['Σx² , Σy² , Σr² = Σ(x² + y²)' + (PT.custom ? ', Σxy' : ''), PT.n + ' bolts' + (PT.custom ? ', x, y from the centroid C' : ''), N(PT.Sx2, 0) + ', ' + N(PT.Sy2, 0) + ', ' + N(PT.Sr2, 0) + (PT.custom ? ', ' + N(PT.Sxy, 0) : '') + ' mm²'],
        PT.method === 'heel'
          ? ['F<sub>A,i</sub> = F<sub>z</sub>/n + M·h<sub>i</sub>/Σh² (heel at ' + N(PT.c, 1) + ' mm from the centre)', 'bolt ' + cb.i + ': ' + kN(PT.Fz) + '/' + PT.n + ' + ' + mm(PT.Mb) + ' N·m·' + N(cb.h, 1) + '/' + N(PT.Sh2, 0), kN(cb.FA)]
          : (Math.abs(PT.Sxy) > 1e-9 * PT.Sr2 || PT.lineDir)
            ? ['F<sub>A,i</sub> = F<sub>z</sub>/n + b·x<sub>i</sub> + c·y<sub>i</sub>, with Σx²·b + Σxy·c = −M<sub>y</sub>, Σxy·b + Σy²·c = M<sub>x</sub>' + (PT.lineDir ? ' (bolts on one line: moment along the line only)' : ''),
              'b = ' + sci(PT.bx) + ', c = ' + sci(PT.cy) + ' N/mm; bolt ' + cb.i + ': ' + kN(PT.Fz) + '/' + PT.n + ' + b·' + N(cb.x, 1) + ' + c·' + N(cb.y, 1), kN(cb.FA)]
          : ['F<sub>A,i</sub> = F<sub>z</sub>/n + M<sub>x</sub>·y<sub>i</sub>/Σy² − M<sub>y</sub>·x<sub>i</sub>/Σx²', 'bolt ' + cb.i + ': ' + kN(PT.Fz) + '/' + PT.n + ' + ' + mm(PT.Mx) + '·' + N(cb.y, 1) + '/' + N(PT.Sy2, 0) + ' − ' + mm(PT.My) + '·' + N(cb.x, 1) + '/' + N(PT.Sx2, 0) + ' (N·m, mm)', kN(cb.FA)],
        ['F<sub>Q,i</sub> = |(F<sub>x</sub>/n − M<sub>z</sub>·y<sub>i</sub>/Σr², F<sub>y</sub>/n + M<sub>z</sub>·x<sub>i</sub>/Σr²)|', 'bolt ' + PT.critQ.i, kN(PT.FQmax)],
        ['F<sub>A,max</sub>, F<sub>A,min</sub> = R·F<sub>A,max</sub>, F<sub>Q</sub> → single-bolt check', 'R = ' + N(PT.ratio, 2), kN(PT.FAmax) + ', ' + kN(PT.ratio * PT.FAmax) + ', ' + kN(PT.FQmax)],
      ];
      if (PT.flex) {
        const FX = PT.flex, cc = FX.cols.find(c => c.idx.includes(cb.i - 1));
        rows.splice(1, 1,
          ['k = 1/δ<sub>S</sub> + 1/δ<sub>P</sub> (per bolt, joint closed)', '1/' + sci(PT.stiff.deltaS) + ' + 1/' + sci(PT.stiff.deltaP), N(FX.k / 1000, 0) + ' kN/mm'],
          ['EI = E·L<sub>y</sub>·t³/12 (flange as a beam along x)', N(FX.E, 0) + '·' + N(FX.b, 0) + '·' + N(FX.t, 1) + '³/12', sci(FX.EI) + ' N·mm²'],
          ['Beam on ' + FX.cols.length + ' spring supports (n<sub>col</sub>·k), F<sub>z</sub> at x<sub>F</sub> = ' + N(PT.xF, 1) + ' mm, M<sub>y</sub> = ' + mm(PT.My0) + ' N·m', 'column x = ' + N(cc.x, 1) + ' mm: R = k<sub>col</sub>·w = ' + N(cc.k / 1000, 0) + '·' + N(cc.w * 1000, 2) + ' µm', kN(cc.R)],
          ['F<sub>A,i</sub> = R<sub>col</sub>/n<sub>col</sub> + M<sub>x</sub>·y<sub>i</sub>/Σy²', 'bolt ' + cb.i + ': ' + kN(cc.R) + '/' + cc.idx.length + ' + ' + mm(PT.Mx) + '·' + N(cb.y, 1) + '/' + N(PT.Sy2, 0), kN(cb.FA) + ' (rigid ' + kN(cb.FArigid) + ')'],
          ['σ = M<sub>max</sub> / (L<sub>y</sub>·t²/6)', N(FX.Mmax / 1000, 1) + ' N·m at x = ' + N(FX.xM, 1) + ' mm', N(FX.sig, 0) + ' MPa']);
      }
      if (PT.custom && !PT.flex) rows.splice(1, 0, ['Centroid C = mean of the bolt positions; F<sub>z</sub> offset → M<sub>x</sub> += F<sub>z</sub>·y<sub>F</sub>, M<sub>y</sub> −= F<sub>z</sub>·x<sub>F</sub> (from C)', 'x<sub>F</sub>, y<sub>F</sub> = ' + N(PT.xF, 1) + ', ' + N(PT.yF, 1) + ' mm', '(' + N(PT.cx0, 1) + ', ' + N(PT.cy0, 1) + ') mm']);
      step('Pattern', 'Bolt pattern load distribution (' + (PT.flex ? 'flexible flange' : 'rigid flange') + ')', rows, PT.flex
        ? 'Flexible flange: the flange is an Euler–Bernoulli beam along x on one spring per bolt column; the base is rigid and the joint must stay closed. Along y the flange is taken as rigid.'
        : PT.method === 'heel'
        ? 'Heel model: the joint has opened and the flange tips about its edge. Prying forces are not included.'
        : 'Centroid model: valid while the joint stays closed. Negative values mean the bending reduces the clamp load at that bolt.');
    }
    const PY = r.pry;
    if (PY) step('Prying', 'Flange prying (Douty & McGuire)', [
      ['a<sub>eff</sub> = min(a, 1.25·b)', 'min(' + N(PY.a, 1) + ', 1.25·' + N(PY.b, 1) + ')', N(PY.aEff, 1) + ' mm'],
      ['X = w·t⁴ / (a·b²·A<sub>b</sub>)', N(PY.w, 1) + '·' + N(PY.t, 1) + '⁴ / (' + N(PY.aEff, 1) + '·' + N(PY.b, 1) + '²·' + N(PY.Ab, 1) + ')', N(PY.X, 3)],
      ['Q/T = (1/2 − X/30) / ((a/b)·(a/(3b) + 1) + X/6)', '', N(PY.ratio, 3) + (PY.raw < 0 ? ' (negative → 0)' : '')],
      ['Q = (Q/T)·T; F<sub>A</sub> → T + Q', N(PY.ratio, 3) + '·' + kN(PY.T), kN(PY.Q) + ' → ' + kN(PY.T + PY.Q)],
      ['σ<sub>web</sub> = 6·|T·b − Q·a| / (w·t²)', '6·' + N(PY.Mweb / 1000, 1) + ' N·m / (' + N(PY.w, 1) + '·' + N(PY.t, 1) + '²)', N(PY.sigWeb, 0) + ' MPa'],
      ['σ<sub>bolt</sub> = 6·Q·a / ((w − d<sub>h</sub>)·t²)', '6·' + N(PY.Mbolt / 1000, 1) + ' N·m / (' + N(PY.wNet, 1) + '·' + N(PY.t, 1) + '²)', N(PY.sigBolt, 0) + ' MPa'],
    ], 'Flange checked against ' + (PY.brittle ? 'R<sub>m</sub>' : 'R<sub>p</sub>') + ' = ' + N(PY.fAllow, 0) + ' MPa of ' + PY.mat.label + '. A<sub>b</sub> is the stress area.');
    const EC = r.ecc;
    if (EC) step('Eccentric', 'Eccentric clamping and loading (VDI 2230 Part 1)', [
      ['A<sub>D</sub> = b<sub>T</sub>·c<sub>T</sub> − π/4·d<sub>h</sub>²', N(EC.bT, 1) + '·' + N(EC.cT, 1) + ' − π/4·' + N(r.dh, 1) + '²', N(EC.AD, 0) + ' mm²'],
      ['I<sub>BT</sub> = b<sub>T</sub>·c<sub>T</sub>³/12 − π/64·d<sub>h</sub>⁴', '', N(EC.IBT, 0) + ' mm⁴'],
      EC.IBauto
        ? ['Ī<sub>Bers</sub> = min(π/64·(D<sub>ers</sub>⁴ − d<sub>h</sub>⁴), I<sub>BT</sub>), D<sub>ers</sub> from l<sub>K</sub>/(E<sub>P</sub>·δ<sub>P</sub>)', 'D<sub>ers</sub> = ' + N(EC.Ders, 2) + ' mm', N(EC.IBers, 0) + ' mm⁴']
        : ['Ī<sub>Bers</sub> (entered)', '', N(EC.IBers, 0) + ' mm⁴'],
      ['β<sub>P</sub> = l<sub>K</sub> / (E<sub>P</sub>·Ī<sub>Bers</sub>)', N(r.lK, 2) + ' / (' + N(r.EP, 0) + '·' + N(EC.IBers, 0) + ')', sci(EC.betaP) + ' 1/(N·mm)'],
      ['δ<sub>P</sub>* = δ<sub>P</sub> + s<sub>sym</sub>²·β<sub>P</sub>', sci(EC.dP) + ' + ' + N(EC.ssym, 1) + '²·β<sub>P</sub>', sci(EC.dPstar) + ' mm/N'],
      ['δ<sub>P</sub>** = δ<sub>P</sub> + s<sub>sym</sub>·a·β<sub>P</sub>', sci(EC.dP) + ' + ' + N(EC.ssym, 1) + '·' + N(EC.a, 1) + '·β<sub>P</sub>', sci(EC.dPss) + ' mm/N'],
      ['Φ<sub>en</sub>* = n·δ<sub>P</sub>** / (δ<sub>S</sub> + δ<sub>P</sub>*)', N(r.n, 2) + '·' + sci(EC.dPss) + ' / (' + sci(r.res.deltaS) + ' + ' + sci(EC.dPstar) + ')', N(EC.PhiEn, 4)],
      ['F<sub>KA</sub> = (F<sub>A,max</sub>·(a·u − s<sub>sym</sub>·u) + M<sub>B</sub>·u) / (I<sub>BT</sub>/A<sub>D</sub> + s<sub>sym</sub>·u)', 'u = ' + N(EC.u, 1) + ' mm' + (EC.uAuto ? ' (c<sub>T</sub>/2)' : '') + ', M<sub>B</sub> = ' + N(EC.MB / 1000, 1) + ' N·m', isFinite(EC.FKA) ? kN(EC.FKA) : '∞'],
      ['σ<sub>SAb</sub>/σ<sub>SA</sub> = 1 + (a/Φ<sub>en</sub>* − s<sub>sym</sub>)·(l<sub>K</sub>/l<sub>ers</sub>)·(E<sub>S</sub>/E<sub>P</sub>)·π·d<sub>S</sub>³/(8·Ī<sub>Bers</sub>)', 'l<sub>ers</sub> = ' + N(EC.lers, 1) + ' mm', EC.bendFactor !== undefined ? N(EC.bendFactor, 2) : '—'],
    ], 'Φ<sub>en</sub>* replaces Φ<sub>n</sub> in R7 to R9, δ<sub>P</sub>* is used for embedding and temperature, F<sub>KA</sub> enters F<sub>K,erf</sub>, and σ<sub>a</sub> in R9 includes the bending factor. Valid only while the joint stays closed (F<sub>KR,min</sub> ≥ F<sub>KA</sub>).');
    step('R0', 'Thread geometry and stress area', [
      ['d<sub>2</sub> = d − 0.6495·P', N(g.d) + ' − 0.6495·' + N(g.P), N(g.d2, 3) + ' mm'],
      ['d<sub>3</sub> = d − 1.2269·P', N(g.d) + ' − 1.2269·' + N(g.P), N(g.d3, 3) + ' mm'],
      ['d<sub>S</sub> = (d<sub>2</sub> + d<sub>3</sub>) / 2', '(' + N(g.d2, 3) + ' + ' + N(g.d3, 3) + ') / 2', N(g.ds, 3) + ' mm'],
      ['A<sub>S</sub> = π/4 · d<sub>S</sub>²', 'π/4 · ' + N(g.ds, 3) + '²', N(g.As, 2) + ' mm²'],
      ['A<sub>d3</sub> = π/4 · d<sub>3</sub>²', '', N(g.Ad3, 2) + ' mm²'],
      ['R<sub>p0.2</sub>, R<sub>m</sub> (' + r.bc.key + ')', '', N(r.bc.Rp, 0) + ', ' + N(r.bc.Rm, 0) + ' MPa'],
    ]);
    step('R1', 'Tightening factor', [
      ['α<sub>A</sub> = F<sub>M,max</sub> / F<sub>M,min</sub>', r.meth.label + ' (VDI 2230 table A8: ' + r.meth.range + ')', N(r.aA, 2)],
    ]);
    step('R2', 'Required clamp load', [
      ['F<sub>KQ</sub> = F<sub>Q</sub>·S<sub>G</sub> / (q<sub>F</sub>·μ<sub>T</sub>)', N(r.FQ / 1000, 2) + '·' + N(r.SGreq, 2) + ' / (' + r.qF + '·' + N(r.muT, 2) + ')', kN(r.FKQ)],
      ['F<sub>K,erf</sub> = max(F<sub>KQ</sub>, F<sub>K,min</sub>)', 'max(' + kN(r.FKQ) + ', ' + kN(r.FKextra) + ')', kN(r.FKerf)],
    ]);
    const res = r.res;
    const lay = r.layers.map(l => f(l.t) + '/' + f(l.E / 1000, 0)).join(' + ');
    step('R3', 'Resilience of bolt and clamped parts, load factor', [
      ['δ<sub>SK</sub> = l<sub>SK</sub> / (E<sub>S</sub>·A<sub>N</sub>)', N(res.lSK, 2) + ' / (' + N(r.bc.E, 0) + '·' + N(g.AN, 2) + ')', sci(res.dSK) + ' mm/N'],
      res.ls > 0 ? ['δ<sub>1</sub> = l<sub>1</sub> / (E<sub>S</sub>·A<sub>N</sub>)', N(res.ls, 2) + ' / (' + N(r.bc.E, 0) + '·' + N(g.AN, 2) + ')', sci(res.dShank) + ' mm/N'] : null,
      ['δ<sub>Gew</sub> = l<sub>Gew</sub> / (E<sub>S</sub>·A<sub>d3</sub>)', N(res.lGew, 2) + ' / (' + N(r.bc.E, 0) + '·' + N(g.Ad3, 2) + ')', sci(res.dGew) + ' mm/N'],
      ['δ<sub>G</sub> = 0.5d / (E<sub>S</sub>·A<sub>d3</sub>)', N(res.lG, 2) + ' / (' + N(r.bc.E, 0) + '·' + N(g.Ad3, 2) + ')', sci(res.dG) + ' mm/N'],
      ['δ<sub>M</sub> = l<sub>M</sub> / (E<sub>M</sub>·A<sub>N</sub>)', N(res.lM, 2) + ' / (' + N(res.EM, 0) + '·' + N(g.AN, 2) + ')', sci(res.dM) + ' mm/N'],
      res.dC > 0 ? ['δ<sub>C</sub> = (h − s) / F<sub>flat</sub> conical spring washer', '(' + N(r.lock.h, 2) + ' − ' + N(r.lock.t, 2) + ') / ' + N(r.lock.Fflat, 0), sci(res.dC) + ' mm/N' + (res.springAlways ? ' (in δ<sub>S</sub>)' : ' (only after settling to F<sub>flat</sub>)')] : null,
      ['<b>δ<sub>S</sub></b> = Σ δ<sub>i</sub>', '', '<b>' + sci(res.deltaS) + ' mm/N</b>'],
      ['l<sub>K</sub> = Σ l<sub>i</sub>; E<sub>P</sub> = l<sub>K</sub> / Σ(l<sub>i</sub>/E<sub>i</sub>)', 'l/E (mm/GPa): ' + lay, N(r.lK, 2) + ' mm; ' + N(r.EP / 1000, 1) + ' GPa'],
      ['l<sub>K</sub>/d (aim for ≥ 3)', N(r.lK, 2) + ' / ' + N(r.thread.d, 0), N(r.lKd, 2)],
      ['tan φ<sub>' + (r.esv ? 'E' : 'D') + '</sub> = ' + (r.esv ? '0.348 + 0.013 ln β<sub>L</sub> + 0.193 ln y' : '0.362 + 0.032 ln(β<sub>L</sub>/2) + 0.153 ln y'), 'β<sub>L</sub> = l<sub>K</sub>/d<sub>W</sub> = ' + N(r.lK / r.dW, 3), N(res.pr.tanPhi, 3) + ' (φ = ' + N(res.pr.phi, 1) + '°)'],
      ['D<sub>A,Gr</sub> = d<sub>W</sub> + w·l<sub>K</sub>·tan φ', N(r.dW, 2) + ' + ' + res.pr.w + '·' + N(r.lK, 1) + '·' + N(res.pr.tanPhi, 3), N(res.pr.DAGr, 1) + ' mm → ' + res.pr.model],
      ['<b>δ<sub>P</sub></b> (cone' + (res.pr.model !== 'cone' ? ' + sleeve' : '') + ' model, d<sub>h</sub> = ' + N(r.dh, 1) + ')', 'VDI 2230 eq. 5.1/' + (res.pr.model === 'cone' ? '40' : '44'), '<b>' + sci(res.deltaP) + ' mm/N</b>'],
      ['Φ<sub>K</sub> = δ<sub>P</sub> / (δ<sub>S</sub> + δ<sub>P</sub>)', '', N(r.PhiK, 4)],
      ['Φ<sub>n</sub> = n·Φ<sub>K</sub>', N(r.n, 2) + '·' + N(r.PhiK, 4), N(r.Phi, 4)],
    ].filter(Boolean));
    const ev = r.emb.values;
    step('R4', 'Preload changes: embedding and temperature', [
      ['f<sub>Z</sub> = n<sub>thr</sub>·f<sub>thr</sub> + n<sub>bear</sub>·f<sub>bear</sub> + n<sub>int</sub>·f<sub>int</sub>', r.emb.nThread + '·' + ev[0] + ' + ' + r.emb.nBear + '·' + ev[1] + ' + ' + r.emb.nInter + '·' + ev[2] + ' µm (' + (r.emb.shear ? 'transverse' : 'axial') + ' load)', N(r.emb.fZum, 1) + ' µm'],
      r.springStage
        ? ['F<sub>Z</sub> = (F<sub>M,min</sub> − F<sub>flat</sub>) + (f<sub>Z</sub> − f<sub>flat</sub>) / (δ<sub>S</sub> + δ<sub>C</sub> + δ<sub>P</sub>)', 'stiff until F<sub>flat</sub> (f<sub>flat</sub> = ' + N(r.springStage.fToFlat * 1000, 1) + ' µm), then with the spring; plain washer: ' + kN(r.FZ0), kN(r.FZ)]
        : ['F<sub>Z</sub> = f<sub>Z</sub> / (δ<sub>S</sub> + δ<sub>P</sub>)', N(r.fZ, 4) + ' / ' + sci(res.deltaS + res.deltaP), kN(r.FZ)],
      ['ΔF<sub>Vth</sub> = l<sub>K</sub>·(α<sub>P</sub> − α<sub>S</sub>)·ΔT / (δ<sub>S</sub> + δ<sub>P</sub>)', N(r.lK, 1) + '·(' + N(r.alphaP * 1e6, 1) + ' − ' + N(r.bc.alpha * 1e6, 1) + ')·10⁻⁶·' + N(r.dT, 0), kN(r.dFth)],
    ]);
    step('R5', 'Minimum and maximum assembly preload', [
      ['F<sub>M,erf</sub> = F<sub>K,erf</sub> + (1 − Φ<sub>n</sub>)·F<sub>A</sub> + F<sub>Z</sub> + ΔF<sub>Vth,loss</sub>', kN(r.FKerf) + ' + ' + N(1 - r.Phi, 3) + '·' + kN(r.FAmax) + ' + ' + kN(r.FZ) + ' + ' + kN(r.thLoss), '<b>' + kN(r.FMerf) + '</b>'],
      ['F<sub>M,zul</sub> = A<sub>S</sub>·ν·R<sub>p0.2</sub> / √(1 + 3[1.5·(d<sub>2</sub>/d<sub>S</sub>)·(P/(π d<sub>2</sub>) + 1.155 μ<sub>G,min</sub>)]²)', N(g.As, 1) + '·' + N(r.nu, 2) + '·' + N(r.bc.Rp, 0) + ' / √(…), μ<sub>G,min</sub> = ' + N(r.muGmin, 2), kN(r.FMzulNu)],
      ['F<sub>M,max</sub>', state.mode === 'torque' ? 'M<sub>A</sub> / K(μ<sub>min</sub>)' : '= F<sub>M,zul</sub>', '<b>' + kN(r.FMmax) + '</b>'],
      ['F<sub>M,min</sub> = F<sub>M,max</sub> / α<sub>A</sub>' + (r.torqueMethod ? ' (≤ M<sub>A</sub>/K(μ<sub>max</sub>))' : ''), kN(r.FMmax) + ' / ' + N(r.aA, 2) + (r.torqueMethod ? '; M<sub>A</sub>/K(μ<sub>max</sub>) = ' + kN(r.FMatMuMax) : ''), '<b>' + kN(r.FMmin) + '</b>'],
      ['Check F<sub>M,min</sub> ≥ F<sub>M,erf</sub>', kN(r.FMmin) + ' vs ' + kN(r.FMerf), r.FMmin >= r.FMerf ? '<span class="status ok">✓</span>' : '<span class="status error">✕</span>'],
    ]);
    step('R8', 'Working stress', [
      ['F<sub>S,max</sub> = F<sub>M,max</sub> + Φ<sub>n</sub>·F<sub>A</sub> + ΔF<sub>Vth,gain</sub>', kN(r.FMmax) + ' + ' + N(r.Phi, 4) + '·' + kN(r.FAmax) + ' + ' + kN(r.thGain), kN(r.FSmax)],
      ['σ<sub>z,max</sub> = F<sub>S,max</sub> / A<sub>S</sub>', '', N(r.sigZ, 0) + ' MPa'],
      ['M<sub>G</sub> = F<sub>M</sub>·d<sub>2</sub>/2·(P/(π d<sub>2</sub>) + 1.155 μ<sub>G,min</sub>)', '', N(r.MG / 1000, 2) + ' N·m'],
      ['τ = M<sub>G</sub> / W<sub>p</sub>, W<sub>p</sub> = π d<sub>S</sub>³/16', N(r.MG, 0) + ' / ' + N(r.Wp, 1), N(r.tauM, 0) + ' MPa'],
      ['ν = F<sub>M,max</sub> / F<sub>M,zul</sub>(ν = 1) (assembly, VDI R5)', kN(r.FMmax) + ' / ' + kN(r.FMmax / r.nuActual), N(r.nuActual * 100, 1) + ' % → σ<sub>red,M</sub> = ' + N(r.sigRedM, 0) + ' MPa'],
      ['σ<sub>red,B</sub> = √(σ<sub>z</sub>² + 3(k<sub>τ</sub>τ)²), k<sub>τ</sub> = 0.5', '√(' + N(r.sigZ, 0) + '² + 3·(0.5·' + N(r.tauM, 0) + ')²)', N(r.sigRedB, 0) + ' MPa'],
      ['S<sub>F</sub> = R<sub>p0.2</sub> / σ<sub>red,B</sub> ≥ 1.0', N(r.bc.Rp, 0) + ' / ' + N(r.sigRedB, 0), '<b>' + N(r.SF, 2) + '</b>'],
    ]);
    step('R9', 'Alternating stress (fatigue)', [
      [(r.ecc && r.bendFactor !== 1 ? 'σ<sub>a</sub> = k<sub>b</sub>·' : 'σ<sub>a</sub> = ') + 'Φ<sub>n</sub>·(F<sub>A,max</sub> − F<sub>A,min</sub>) / (2·A<sub>S</sub>)', (r.ecc && r.bendFactor !== 1 ? N(r.bendFactor, 2) + '·' : '') + N(r.Phi, 4) + '·(' + kN(r.FAmax) + ' − ' + kN(r.FAmin) + ') / (2·' + N(g.As, 1) + ')', N(r.sigA, 1) + ' MPa'],
      ['σ<sub>ASV</sub> = 0.85·(150/d + 45)', '0.85·(150/' + N(g.d) + ' + 45)', N(r.sigASV, 1) + ' MPa'],
      state.rolledAfter ? ['σ<sub>ASG</sub> = (2 − F<sub>Sm</sub>/F<sub>0.2min</sub>)·σ<sub>ASV</sub>', '(2 − ' + kN(r.FSm) + '/' + kN(r.F02) + ')·' + N(r.sigASV, 1), N(r.sigASG, 1) + ' MPa'] : null,
      ['S<sub>D</sub> = σ<sub>AS</sub> / σ<sub>a</sub> ≥ 1.2', r.sigA > 0 ? N(r.sigAS, 1) + ' / ' + N(r.sigA, 1) : 'static load', '<b>' + (isFinite(r.SD) ? N(r.SD, 2) : '—') + '</b>'],
    ].filter(Boolean));
    step('R7', 'Surface pressure under head and nut', r.pressures.map(p => [
      'p = max(F<sub>M,max</sub>, F<sub>S,max</sub>) / A<sub>p</sub>; ' + p.where, 'A<sub>p</sub> = π/4·(' + N(p.dOut, 2) + '² − ' + N(p.dIn, 2) + '²) = ' + N(p.Ap, 1) + ' mm²', N(p.p, 0) + ' MPa ≤ ' + N(p.pG, 0) + (p.est ? ' ~' : '') + ' → S<sub>p</sub> = ' + N(p.Sp, 2)]));
    step('R10–R12', 'Residual clamp load and slipping', [
      ['F<sub>KR,min</sub> = F<sub>M,min</sub> − (1 − Φ<sub>n</sub>)·F<sub>A</sub> − F<sub>Z</sub> − ΔF<sub>Vth,loss</sub>', kN(r.FMmin) + ' − ' + kN(r.FPA) + ' − ' + kN(r.FZ) + ' − ' + kN(r.thLoss), '<b>' + kN(r.FKRmin) + '</b>'],
      r.FQ > 0 ? ['S<sub>G</sub> = F<sub>KR,min</sub>·q<sub>F</sub>·μ<sub>T</sub> / F<sub>Q</sub>', kN(r.FKRmin) + '·' + r.qF + '·' + N(r.muT, 2) + ' / ' + kN(r.FQ), '<b>' + N(r.SG, 2) + '</b>'] : null,
    ].filter(Boolean));
    step('R13', 'Tightening torque', [
      ['D<sub>Km</sub> = (d<sub>W</sub> + d<sub>h,bearing</sub>) / 2', '(' + N(r.dW, 2) + ' + ' + N(r.dhb, 2) + ') / 2', N(r.DKm, 2) + ' mm'],
      ['K = 0.16·P + 0.58·d<sub>2</sub>·μ<sub>G</sub> + μ<sub>K</sub>·D<sub>Km</sub>/2', '0.16·' + N(g.P) + ' + 0.58·' + N(g.d2, 3) + '·' + N(r.muGmin, 2) + ' + ' + N(r.muKmin, 2) + '·' + N(r.DKm, 2) + '/2', N(r.Kmin, 3) + ' mm'],
      ['<b>M<sub>A</sub> = F<sub>M,max</sub>·K</b>', kN(r.FMmax) + '·' + N(r.Kmin, 3) + ' mm', '<b>' + N(r.MA / 1000, 2) + ' N·m</b>'],
    ]);
    const s = r.strip;
    const stripRows = [
      ['A<sub>SG,M</sub>/m = π·D·(0.5 + (D − D<sub>2</sub>)·tan30°/P) (internal thread)', '', ''],
      ['A<sub>SG,S</sub>/m = π·D<sub>1</sub>·(0.5 + (d<sub>2</sub> − D<sub>1</sub>)·tan30°/P) (bolt thread)', '', ''],
      ['m<sub>eff</sub> = engagement − chamfer', N(r.Le, 2) + ' mm', N(s.meff, 2) + ' mm'],
    ];
    if (s.C1 !== undefined) stripRows.push(['C<sub>1</sub> = 3.8(s/d) − (s/d)² − 2.61 (nut dilation)', 's/d = ' + N(r.nut.s / g.d, 3), N(s.C1, 3)]);
    s.modes.forEach(m => stripRows.push(['F = τ<sub>B</sub>·A<sub>SG</sub>·C<sub>3</sub>: ' + m.label, N(m.tau, 0) + '·' + N(m.A, 0) + '·0.9' + (m.key === 'nut' ? '·C<sub>1</sub>' : ''), kN(m.F)]));
    stripRows.push(['F<sub>B</sub> = A<sub>S</sub>·R<sub>m</sub> (bolt breaks)', N(g.As, 1) + '·' + N(r.bc.Rm, 0), kN(s.Fbreak)]);
    step('Thread', 'Thread stripping', stripRows, 'The joint should fail by bolt fracture (visible, ductile), not by stripping: weakest thread ≥ F<sub>B</sub>.');
    const NS = r.nasa;
    if (NS) {
      const sub = NS.tpvAdded ? '' : ' − T<sub>pv</sub>';
      step('NASA', 'NASA-STD-5020 preload and margins of safety', [
        ['K = M<sub>A</sub>(μ<sub>mean</sub>) / (F·d)', 'nominal nut factor at the mean friction', N(NS.K, 3)],
        ['T<sub>max</sub>, T<sub>min</sub> = M<sub>A</sub>·(1 ± tol)', N(NS.Tnom / 1000, 2) + '·(1 ± ' + N(NS.tol, 2) + ')', N(NS.Tmax / 1000, 2) + ', ' + N(NS.Tmin / 1000, 2) + ' N·m'],
        ['P<sub>pi,max</sub> = (1 + Γ)·(T<sub>max</sub>' + sub + '<sub>,min</sub>) / (K·d)', '(1 + ' + N(NS.Gamma, 2) + ')·(' + N(NS.Tmax / 1000, 3) + (NS.tpvAdded ? '' : ' − ' + N(NS.TpvMin / 1000, 3)) + ') / (' + N(NS.K, 3) + '·' + N(g.d) + ')', kN(NS.Ppimax)],
        ['P<sub>pi,min</sub> = (1 − Γ)·(T<sub>min</sub>' + sub + '<sub>,max</sub>) / (K·d)', '(1 − ' + N(NS.Gamma, 2) + ')·(' + N(NS.Tmin / 1000, 3) + (NS.tpvAdded ? '' : ' − ' + N(NS.TpvMax / 1000, 3)) + ') / (' + N(NS.K, 3) + '·' + N(g.d) + ')', kN(NS.Ppimin)],
        ['P<sub>relax</sub> = max(relax·P<sub>pi,min</sub>, F<sub>Z</sub>)', 'max(' + kN(NS.relax * NS.Ppimin) + ', ' + kN(r.FZ) + ')', kN(NS.Prelax)],
        ['P<sub>p,max</sub> = P<sub>pi,max</sub> + ΔP<sub>T+</sub>', kN(NS.Ppimax) + ' + ' + kN(r.thGain), kN(NS.Ppmax)],
        ['P<sub>p,min</sub> = P<sub>pi,min</sub> − P<sub>relax</sub> − ΔP<sub>T−</sub>', kN(NS.Ppimin) + ' − ' + kN(NS.Prelax) + ' − ' + kN(r.thLoss), kN(NS.Ppmin)],
      ].concat(NS.margins.map(m => ['MS ' + m.label.toLowerCase() + ' = ' + m.formula + ' − 1', (m.key === 'inter' ? N(m.allow, 0) + ' / ' + N(m.load, 3) : kN(m.allow) + ' / ' + kN(m.load)), isFinite(m.MS) ? N(m.MS, 2) : '∞'])),
      'FS<sub>y</sub> = ' + N(NS.FSy, 2) + ', FS<sub>u</sub> = ' + N(NS.FSu, 2) + ', FS<sub>sep</sub> = ' + N(NS.FSsep, 2) + ', FS<sub>slip</sub> = ' + N(NS.FSslip, 2) + ', FF = ' + N(NS.FF, 2) + '; P<sub>t</sub> = ' + kN(NS.Pt) + ', P<sub>s</sub> = ' + kN(NS.Ps) + ' (limit loads per bolt). Margins of safety must be ≥ 0.');
    }
    return S.join('');
  }

  // ---------------- PCB section of the Help dialog (calculated from the standoff example) ----------------
  // Recommended torque window: the lowest torque that keeps >= 25 % of the preload after settling,
  // and the highest that keeps the board pressure within 2/3 of its limit p_G.
  const PCB_KEEP = 0.25, PCB_PFRAC = 2 / 3;
  function pcbCase(overrides) {
    const p = PR.PRESETS.find(x => x.id === 'm3-pcb-standoff');
    const s = Object.assign(clone(PR.DEFAULT), clone(p.s), overrides || {});
    const fr = D.FRICTION[s.friction];
    if (fr && !fr.custom) { s.muGmin = fr.muG[0]; s.muGmax = fr.muG[1]; s.muKmin = fr.muK[0]; s.muKmax = fr.muK[1]; }
    return C.calculate(s);
  }
  function boardPressure(r) { return r.pressures.find(p => /FR-4/.test(p.mat)); }
  function pcbWindow() {
    let lo = null, hi = null;
    for (let i = 2; i <= 40; i++) {
      const MA = Math.round(i * 5) / 100, r = pcbCase({ mode: 'torque', MA }), bp = boardPressure(r);
      if (lo === null && r.FVmin / r.FMmin >= PCB_KEEP) lo = MA;
      if (bp && bp.p <= PCB_PFRAC * bp.pG) hi = MA;
    }
    return { lo, hi, ok: lo !== null && hi !== null && lo <= hi };
  }
  function renderPcbHelp() {
    const body = $('#pcb-table');
    if (!body) return;
    try {
      const set = (k, v) => $$(`[data-pcb="${k}"]`).forEach(el => { el.textContent = v; });
      const win = pcbWindow();
      const MAref = win.hi !== null ? win.hi : 0.6;
      const torques = [0.3, win.lo, win.hi, 1.0].filter(x => x !== null)
        .filter((x, i, a) => a.indexOf(x) === i).sort((x, y) => x - y);
      body.innerHTML = torques.map(MA => {
        const r = pcbCase({ mode: 'torque', MA });
        const bp = boardPressure(r);
        const over = bp && bp.p > bp.pG;
        const left = r.FVmin <= 0 ? '<span class="status error">none: can loosen</span>'
          : f(r.FVmin / 1000, 2) + ' kN' + (over ? ', <span class="status error">board overloaded</span>' : '');
        return `<tr><td class="left">${f(MA, 2)} N·m</td><td>${f(r.FMmin / 1000, 2)}–${f(r.FMmax / 1000, 2)} kN</td>` +
          `<td${over ? ' class="status error"' : ''}>${bp ? f(bp.p, 0) : '—'} MPa</td><td>${left}</td></tr>`;
      }).join('');

      const ref = pcbCase({ mode: 'torque', MA: MAref });
      const bare = pcbCase({ mode: 'torque', MA: MAref, washer: 'none' });
      const steel = pcbCase({ mode: 'torque', MA: MAref, plates: [{ mat: 'S235', t: 1.6 }] });
      const thin = pcbCase({ mode: 'torque', MA: MAref, plates: [{ mat: 'FR4', t: 0.8 }] });
      const thick = pcbCase({ mode: 'torque', MA: MAref, plates: [{ mat: 'FR4', t: 2.4 }] });
      const fr4 = D.MATERIALS.FR4, steelE = D.MATERIALS.S235.E, screw = D.BOLT_CLASSES['8.8'];
      const bp = boardPressure(ref);

      // stiffness
      set('ez', f(fr4.E / 1000, 0));
      set('eratio', '1/' + f(steelE / fr4.E, 0));
      const FM = (ref.FMmin + ref.FMmax) / 2, dP = FM * ref.res.deltaP * 1000, dS = FM * ref.res.deltaS * 1000;
      set('dp', f(dP, 1));
      set('cmp', (dP > dS ? 'more than' : 'less than') + ` the screw stretches (${f(dS, 1)} µm)`);
      set('share', ref.PhiK > 0.5 ? 'a large share' : ref.PhiK > 0.25 ? 'a moderate share' : 'only a small share');
      set('phi', f(ref.PhiK, 2));

      // settling
      const fzFrac = ref.FZ / ref.FMmin, steelFrac = steel.FZ / steel.FMmin;
      set('settle-head', fzFrac < steelFrac ? 'That softness helps against settling.' : 'Settling still costs preload.');
      set('fz', f(ref.emb.fZum, 1));
      set('fzpct', f(Math.min(fzFrac, 1) * 100, 0));
      set('steelcmp', steelFrac >= 1 ? 'against all of it in a 1.6 mm steel plate, which can then come loose'
        : `against ${f(steelFrac * 100, 0)} % in a 1.6 mm steel plate`);
      const keep = r => Math.max(r.FVmin, 0) / r.FMmin;
      set('thick', keep(thick) > keep(thin)
        ? `Thicker boards keep more preload: ${f(keep(thin) * 100, 0)} % at 0.8 mm, ${f(keep(thick) * 100, 0)} % at 2.4 mm.`
        : `Board thickness changes little here: ${f(keep(thin) * 100, 0)} % kept at 0.8 mm, ${f(keep(thick) * 100, 0)} % at 2.4 mm.`);

      // torque
      set('hi', f(MAref, 2));
      set('nu', f(ref.nuActual * 100, 0));
      set('nowasher', f(boardPressure(bare).p, 0));
      set('pg', f(bp ? bp.pG : fr4.pG, 0));
      set('range', win.ok ? `Use about ${f(win.lo, 2)}–${f(win.hi, 2)} N·m for M3`
        : 'No torque meets both limits for this M3 example: use a thicker board, a larger washer or a stiffer standoff, and tighten');
      set('range-why', `The lower end keeps at least ${f(PCB_KEEP * 100, 0)} % of the preload after settling, the upper end keeps the board pressure within 2/3 of its limit.`);

      // temperature
      set('alpha', f(fr4.alpha * 1e6, 0));
      set('aratio', f(fr4.alpha / screw.alpha, 0));
    } catch (e) {
      console.error(e);
      body.innerHTML = '<tr><td class="left" colspan="4">Could not calculate the table.</td></tr>';
    }
  }

  // ---------------- libraries ----------------
  function renderLibs() {
    const tbl = (head, rows) => `<div class="table-wrap lib-scroll"><table class="data"><thead><tr>${head.map((h, i) => `<th${i === 0 ? ' class="left"' : ''}>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map((c, i) => `<td${i === 0 ? ' class="left"' : ''}>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    const th = D.threadList().map(t => { const g = C.threadGeometry(t.d, t.P); const s = D.SIZES[t.d]; return [t.label, f(g.d2, 3), f(g.d3, 3), f(g.As, 1), f(s.hex.s, 1), f(s.hex.dw, 2), f(s.shcs.dw, 2), s.hole.join(' / ')]; });
    const cls = Object.entries(D.BOLT_CLASSES).map(([k, c]) => [c.label, c.Rm + (c.RmBig ? ' (' + c.RmBig + ')' : ''), c.Rp + (c.RpBig ? ' (' + c.RpBig + ')' : ''), f(c.E / 1000, 0), f(c.alpha * 1e6, 1)]);
    const mats = Object.values(D.MATERIALS).map(m => [m.label + (m.est ? ' ~' : ''), f(m.E / 1000, 1), f(m.alpha * 1e6, 1), m.Rm, m.Rp === null || m.Rp === undefined ? '—' : m.Rp, m.pG, f(m.ftau * m.Rm, 0)]);
    const fr = Object.values(D.FRICTION).filter(x => !x.custom).map(x => [x.label + (x.est ? ' ~' : ''), x.muG.join(' – '), x.muK.join(' – '), x.cls]);
    const tg = Object.values(D.TIGHTENING).map(x => [x.label, x.range, f(x.aA, 2)]);
    const em = Object.values(D.EMBEDDING).map(x => [x.label, x.axial.join(' / '), x.shear.join(' / ')]);
    $('#libs').innerHTML =
      '<h3>Metric threads (ISO 261 / 724), heads and holes</h3>' + tbl(['Thread', 'd₂', 'd₃', 'A<sub>S</sub> mm²', 'Hex s', 'Hex d<sub>W</sub>', 'Socket d<sub>W</sub>', 'Hole f / m / c'], th) +
      '<h3>Property classes (ISO 898-1, ISO 3506-1)</h3>' + tbl(['Class', 'R<sub>m</sub> MPa', 'R<sub>p0.2</sub> MPa', 'E GPa', 'α 10⁻⁶/K'], cls) + '<p class="hint">Values in brackets for 8.8 apply to d &gt; 16 mm.</p>' +
      '<h3>Materials of clamped and tapped parts</h3>' + tbl(['Material', 'E GPa', 'α 10⁻⁶/K', 'R<sub>m</sub> MPa', 'R<sub>p</sub> MPa', 'p<sub>G</sub> MPa', 'τ<sub>B</sub> MPa'], mats) + '<p class="hint">p<sub>G</sub>: limiting surface pressure (VDI 2230 table A9). ~ marks typical estimates; use supplier data where it matters.</p>' +
      '<h3>Friction coefficients</h3>' + tbl(['Surface / lubrication', 'μ<sub>G</sub>', 'μ<sub>K</sub>', 'VDI class'], fr) +
      '<h3>Tightening factor α<sub>A</sub> (VDI 2230 table A8)</h3>' + tbl(['Method', 'Range', 'Used'], tg) +
      '<h3>Embedding (VDI 2230 table 5), µm: thread / per bearing / per interface</h3>' + tbl(['Roughness', 'Axial load', 'Transverse load'], em);
  }

  // ---------------- misc ----------------
  let toastT;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 2200);
  }

  setup();
  if (state.friction !== 'custom') copyFriction();
  update();
})();

// Offline support: register the service worker (sw.js, next to the web manifest) so the
// calculator keeps working without a connection and can be installed as an app.
(function () {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  var local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (location.protocol !== 'https:' && !local) return;
  var link = document.querySelector('link[rel="manifest"]');
  var sw = new URL('sw.js', link ? link.href : location.href).href;
  function register() { navigator.serviceWorker.register(sw).catch(function () {}); }
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register);
})();

// "Install app": a toolbar button (where the browser can install directly, e.g. Chrome/Edge)
// and an "Install as an app" section on the About page with an install button or, where the
// browser has no install prompt (Safari, Firefox), short instructions. Texts in EN/DE/NL/TR/ES.
(function () {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  var TEXT = {
    en: { title: 'Install as an app', body: 'This calculator also works offline. Install it as an app to open it in its own window from the Dock, Start menu or home screen, with or without an internet connection. Updates arrive automatically when you are online.', button: 'Install app', installed: 'You are using the installed app.', done: 'Installed. You can now open it from your apps.', mac: 'In Safari on a Mac: choose File › Add to Dock.', ios: 'On iPhone or iPad: tap Share, then Add to Home Screen.', other: 'In Chrome or Edge: click the install icon in the address bar, or open the browser menu and choose Install. In Safari on a Mac: File › Add to Dock. On iPhone or iPad: Share › Add to Home Screen.' },
    de: { title: 'Als App installieren', body: 'Dieser Rechner funktioniert auch offline. Installieren Sie ihn als App, um ihn in einem eigenen Fenster aus dem Dock, dem Startmenü oder vom Startbildschirm zu öffnen, mit oder ohne Internetverbindung. Updates kommen automatisch, sobald Sie online sind.', button: 'App installieren', installed: 'Sie verwenden die installierte App.', done: 'Installiert. Sie können sie jetzt aus Ihren Apps öffnen.', mac: 'In Safari auf dem Mac: Ablage › Zum Dock hinzufügen.', ios: 'Auf iPhone oder iPad: Teilen tippen, dann Zum Home-Bildschirm.', other: 'In Chrome oder Edge: auf das Installationssymbol in der Adressleiste klicken oder im Browsermenü Installieren wählen. In Safari auf dem Mac: Ablage › Zum Dock hinzufügen. Auf iPhone oder iPad: Teilen › Zum Home-Bildschirm.' },
    nl: { title: 'Installeren als app', body: 'Deze calculator werkt ook offline. Installeer hem als app om hem in een eigen venster te openen vanuit het Dock, het Startmenu of het beginscherm, met of zonder internetverbinding. Updates komen automatisch binnen zodra je online bent.', button: 'App installeren', installed: 'Je gebruikt de geïnstalleerde app.', done: 'Geïnstalleerd. Je kunt hem nu openen vanuit je apps.', mac: 'In Safari op een Mac: kies Archief › Voeg toe aan Dock.', ios: 'Op iPhone of iPad: tik op Deel en daarna op Zet op beginscherm.', other: 'In Chrome of Edge: klik op het installatiepictogram in de adresbalk of kies Installeren in het browsermenu. In Safari op een Mac: Archief › Voeg toe aan Dock. Op iPhone of iPad: Deel › Zet op beginscherm.' },
    tr: { title: 'Uygulama olarak yükle', body: 'Bu hesaplayıcı çevrimdışı da çalışır. Dock, Başlat menüsü veya ana ekrandan kendi penceresinde, internet bağlantısı olsun ya da olmasın açmak için uygulama olarak yükleyin. Çevrimiçi olduğunuzda güncellemeler otomatik olarak gelir.', button: 'Uygulamayı yükle', installed: 'Yüklü uygulamayı kullanıyorsunuz.', done: 'Yüklendi. Artık uygulamalarınızdan açabilirsiniz.', mac: 'Mac’te Safari’de: Dosya › Dock’a Ekle.', ios: 'iPhone veya iPad’de: Paylaş’a, ardından Ana Ekrana Ekle’ye dokunun.', other: 'Chrome veya Edge’de: adres çubuğundaki yükleme simgesine tıklayın ya da tarayıcı menüsünden Yükle’yi seçin. Mac’te Safari’de: Dosya › Dock’a Ekle. iPhone veya iPad’de: Paylaş › Ana Ekrana Ekle.' },
    es: { title: 'Instalar como aplicación', body: 'Esta calculadora también funciona sin conexión. Instálala como aplicación para abrirla en su propia ventana desde el Dock, el menú Inicio o la pantalla de inicio, con o sin conexión a internet. Las actualizaciones llegan solas cuando estás en línea.', button: 'Instalar aplicación', installed: 'Estás usando la aplicación instalada.', done: 'Instalada. Ya puedes abrirla desde tus aplicaciones.', mac: 'En Safari en un Mac: Archivo › Añadir al Dock.', ios: 'En iPhone o iPad: toca Compartir y luego Añadir a pantalla de inicio.', other: 'En Chrome o Edge: haz clic en el icono de instalación de la barra de direcciones o elige Instalar en el menú del navegador. En Safari en un Mac: Archivo › Añadir al Dock. En iPhone o iPad: Compartir › Añadir a pantalla de inicio.' }
  };
  var ABOUT_BUTTONS = '#btnAbout, #about-open, #aboutOpen, [data-dialog="about"]';
  var ICON = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M8 2v8M4.5 6.8 8 10.3l3.5-3.5M3 13.5h10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var prompt = null, justInstalled = false;

  function lang() { var l = (document.documentElement.lang || 'en').slice(0, 2).toLowerCase(); return TEXT[l] ? l : 'en'; }
  function tx(k) { return TEXT[lang()][k]; }
  function installed() {
    return justInstalled || window.navigator.standalone === true ||
      (window.matchMedia && (matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: window-controls-overlay)').matches));
  }
  function platform() {
    var ua = navigator.userAgent;
    if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
    if (/Macintosh/.test(ua) && /Safari\//.test(ua) && !/Chrome|Chromium|CriOS|Edg|Firefox|OPR/.test(ua)) return 'mac';
    return 'other';
  }
  function install() {
    if (!prompt) return;
    var p = prompt; prompt = null;
    p.prompt();
    (p.userChoice || Promise.resolve({})).then(function (c) { if (c && c.outcome !== 'accepted') prompt = p; render(); });
    render();
  }

  function addStyle() {
    if (document.getElementById('pwa-install-style')) return;
    var s = document.createElement('style');
    s.id = 'pwa-install-style';
    s.textContent =
      '.pwa-install{margin:1rem 0;padding:.85rem 1rem;border:1px solid var(--border, var(--line, #c9ced6));border-radius:var(--radius, 10px)}' +
      '.pwa-install h3{margin:0 0 .4rem;font-size:1rem}.pwa-install p{margin:.35rem 0}' +
      '.pwa-install .pwa-install-cta{display:inline-flex;align-items:center;gap:.45rem;margin-top:.35rem;padding:.5rem .95rem;border:0;border-radius:999px;font:inherit;font-weight:600;cursor:pointer;background:var(--accent);color:var(--accent-ink, var(--bg, #fff))}' +
      '.pwa-install .pwa-install-cta:hover{filter:brightness(1.08)}.pwa-install .pwa-install-cta:focus-visible{outline:2px solid var(--accent);outline-offset:2px}' +
      '.pwa-install-btn{display:inline-flex;align-items:center;gap:.35rem}.pwa-install-btn svg{flex:none}' +
      '@media (max-width:760px){.pwa-install-btn .pwa-label{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}}';
    document.head.appendChild(s);
  }

  function renderToolbar() {
    var btn = document.querySelector('.pwa-install-btn');
    if (!prompt || installed()) { if (btn) btn.remove(); return; }
    var about = document.querySelector(ABOUT_BUTTONS);
    if (!about) return;
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = (about.className + ' pwa-install-btn').trim();
      btn.addEventListener('click', install);
      about.parentNode.insertBefore(btn, about);
    }
    if (btn.dataset.lang !== lang()) {
      btn.dataset.lang = lang();
      btn.innerHTML = ICON + '<span class="pwa-label">' + tx('button') + '</span>';
      btn.title = tx('button');
      btn.setAttribute('aria-label', tx('button'));
    }
  }

  function renderAbout() {
    var anchor = document.querySelector('.about-support');
    if (!anchor) return;
    var state = lang() + '|' + (installed() ? 'installed' : prompt ? 'prompt' : platform());
    var box = anchor.parentNode.querySelector(':scope > .pwa-install');
    if (box && box.dataset.state === state) return;
    if (!box) { box = document.createElement('section'); box.className = 'pwa-install'; anchor.parentNode.insertBefore(box, anchor); }
    box.dataset.state = state;
    var html = '<h3>' + tx('title') + '</h3><p>' + tx('body') + '</p>';
    if (installed()) html += '<p><strong>' + tx(justInstalled ? 'done' : 'installed') + '</strong></p>';
    else if (prompt) html += '<button type="button" class="pwa-install-cta">' + ICON + '<span>' + tx('button') + '</span></button>';
    else html += '<p>' + tx(platform()) + '</p>';
    box.innerHTML = html;
    var cta = box.querySelector('.pwa-install-cta');
    if (cta) cta.addEventListener('click', install);
  }

  var busy = false;
  function render() {
    if (busy) return;
    busy = true;
    try { addStyle(); renderToolbar(); renderAbout(); } finally { busy = false; }
  }

  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); prompt = e; render(); });
  window.addEventListener('appinstalled', function () { prompt = null; justInstalled = true; render(); });
  function start() {
    render();
    // The About content and the page language are re-rendered by the app: keep up with it.
    new MutationObserver(function () { if (!busy) render(); })
      .observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['lang'] });
    new MutationObserver(render).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
