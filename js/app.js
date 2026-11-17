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
    opt($('#friction'), Object.entries(D.FRICTION).map(([k, v]) => [k, v.label]));
    opt($('#method'), Object.entries(D.TIGHTENING).map(([k, v]) => [k, v.label + ' · α<sub>A</sub> ' + v.range]));
    $$('#method option').forEach(o => { o.textContent = o.textContent.replace(/<\/?sub>/g, ''); });
    $('#muT-list').innerHTML = D.INTERFACE_FRICTION.map(([t, v]) => `<option value="${v}">${t}</option>`).join('');
    opt($('#preset'), [['', 'Load application example…']].concat(PR.PRESETS.map(p => [p.id, p.label])));

    $$('[data-key]', $('#form')).forEach(el => {
      el.addEventListener(el.tagName === 'SELECT' || el.type === 'checkbox' ? 'change' : 'input', () => {
        const k = el.dataset.key;
        if (el.type === 'checkbox') state[k] = el.checked;
        else if (el.tagName === 'SELECT') state[k] = el.value;
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
    $('#add-plate').addEventListener('click', () => {
      if (state.plates.length >= 5) return;
      const last = state.plates[state.plates.length - 1] || { mat: 'S235', t: 10 };
      state.plates.push({ mat: last.mat, t: last.t });
      update();
    });
    $('#preset').addEventListener('change', e => {
      const p = PR.PRESETS.find(x => x.id === e.target.value);
      if (!p) return;
      state = Object.assign(clone(PR.DEFAULT), clone(p.s));
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
      try { localStorage.setItem('bolt.theme', next); } catch (e) { /* ignore */ }
    });
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
      ['Embedding f<sub>Z</sub>', f(r.emb.fZum, 1) + ' µm', 'F<sub>Z</sub> = ' + f(r.FZ / 1000, 2) + ' kN'],
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
      ['<b>δ<sub>S</sub></b> = Σ δ<sub>i</sub>', '', '<b>' + sci(res.deltaS) + ' mm/N</b>'],
      ['l<sub>K</sub> = Σ l<sub>i</sub>; E<sub>P</sub> = l<sub>K</sub> / Σ(l<sub>i</sub>/E<sub>i</sub>)', 'l/E (mm/GPa): ' + lay, N(r.lK, 2) + ' mm; ' + N(r.EP / 1000, 1) + ' GPa'],
      ['tan φ<sub>' + (r.esv ? 'E' : 'D') + '</sub> = ' + (r.esv ? '0.348 + 0.013 ln β<sub>L</sub> + 0.193 ln y' : '0.362 + 0.032 ln(β<sub>L</sub>/2) + 0.153 ln y'), 'β<sub>L</sub> = l<sub>K</sub>/d<sub>W</sub> = ' + N(r.lK / r.dW, 3), N(res.pr.tanPhi, 3) + ' (φ = ' + N(res.pr.phi, 1) + '°)'],
      ['D<sub>A,Gr</sub> = d<sub>W</sub> + w·l<sub>K</sub>·tan φ', N(r.dW, 2) + ' + ' + res.pr.w + '·' + N(r.lK, 1) + '·' + N(res.pr.tanPhi, 3), N(res.pr.DAGr, 1) + ' mm → ' + res.pr.model],
      ['<b>δ<sub>P</sub></b> (cone' + (res.pr.model !== 'cone' ? ' + sleeve' : '') + ' model, d<sub>h</sub> = ' + N(r.dh, 1) + ')', 'VDI 2230 eq. 5.1/' + (res.pr.model === 'cone' ? '40' : '44'), '<b>' + sci(res.deltaP) + ' mm/N</b>'],
      ['Φ<sub>K</sub> = δ<sub>P</sub> / (δ<sub>S</sub> + δ<sub>P</sub>)', '', N(r.PhiK, 4)],
      ['Φ<sub>n</sub> = n·Φ<sub>K</sub>', N(r.n, 2) + '·' + N(r.PhiK, 4), N(r.Phi, 4)],
    ].filter(Boolean));
    const ev = r.emb.values;
    step('R4', 'Preload changes: embedding and temperature', [
      ['f<sub>Z</sub> = n<sub>thr</sub>·f<sub>thr</sub> + n<sub>bear</sub>·f<sub>bear</sub> + n<sub>int</sub>·f<sub>int</sub>', r.emb.nThread + '·' + ev[0] + ' + ' + r.emb.nBear + '·' + ev[1] + ' + ' + r.emb.nInter + '·' + ev[2] + ' µm (' + (r.emb.shear ? 'transverse' : 'axial') + ' load)', N(r.emb.fZum, 1) + ' µm'],
      ['F<sub>Z</sub> = f<sub>Z</sub> / (δ<sub>S</sub> + δ<sub>P</sub>)', N(r.fZ, 4) + ' / ' + sci(res.deltaS + res.deltaP), kN(r.FZ)],
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
      ['σ<sub>a</sub> = Φ<sub>n</sub>·(F<sub>A,max</sub> − F<sub>A,min</sub>) / (2·A<sub>S</sub>)', N(r.Phi, 4) + '·(' + kN(r.FAmax) + ' − ' + kN(r.FAmin) + ') / (2·' + N(g.As, 1) + ')', N(r.sigA, 1) + ' MPa'],
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
    return S.join('');
  }

  // ---------------- libraries ----------------
  function renderLibs() {
    const tbl = (head, rows) => `<div class="table-wrap lib-scroll"><table class="data"><thead><tr>${head.map((h, i) => `<th${i === 0 ? ' class="left"' : ''}>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map((c, i) => `<td${i === 0 ? ' class="left"' : ''}>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    const th = D.threadList().map(t => { const g = C.threadGeometry(t.d, t.P); const s = D.SIZES[t.d]; return [t.label, f(g.d2, 3), f(g.d3, 3), f(g.As, 1), f(s.hex.s, 1), f(s.hex.dw, 2), f(s.shcs.dw, 2), s.hole.join(' / ')]; });
    const cls = Object.entries(D.BOLT_CLASSES).map(([k, c]) => [c.label, c.Rm + (c.RmBig ? ' (' + c.RmBig + ')' : ''), c.Rp + (c.RpBig ? ' (' + c.RpBig + ')' : ''), f(c.E / 1000, 0), f(c.alpha * 1e6, 1)]);
    const mats = Object.values(D.MATERIALS).map(m => [m.label + (m.est ? ' ~' : ''), f(m.E / 1000, 1), f(m.alpha * 1e6, 1), m.Rm, m.pG, f(m.ftau * m.Rm, 0)]);
    const fr = Object.values(D.FRICTION).filter(x => !x.custom).map(x => [x.label + (x.est ? ' ~' : ''), x.muG.join(' – '), x.muK.join(' – '), x.cls]);
    const tg = Object.values(D.TIGHTENING).map(x => [x.label, x.range, f(x.aA, 2)]);
    const em = Object.values(D.EMBEDDING).map(x => [x.label, x.axial.join(' / '), x.shear.join(' / ')]);
    $('#libs').innerHTML =
      '<h3>Metric threads (ISO 261 / 724), heads and holes</h3>' + tbl(['Thread', 'd₂', 'd₃', 'A<sub>S</sub> mm²', 'Hex s', 'Hex d<sub>W</sub>', 'Socket d<sub>W</sub>', 'Hole f / m / c'], th) +
      '<h3>Property classes (ISO 898-1, ISO 3506-1)</h3>' + tbl(['Class', 'R<sub>m</sub> MPa', 'R<sub>p0.2</sub> MPa', 'E GPa', 'α 10⁻⁶/K'], cls) + '<p class="hint">Values in brackets for 8.8 apply to d &gt; 16 mm.</p>' +
      '<h3>Materials of clamped and tapped parts</h3>' + tbl(['Material', 'E GPa', 'α 10⁻⁶/K', 'R<sub>m</sub> MPa', 'p<sub>G</sub> MPa', 'τ<sub>B</sub> MPa'], mats) + '<p class="hint">p<sub>G</sub>: limiting surface pressure (VDI 2230 table A9). ~ marks typical estimates; use supplier data where it matters.</p>' +
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
