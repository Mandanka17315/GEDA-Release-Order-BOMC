/* =========================================================================
   Screens
   ========================================================================= */
function setStatus(msg, cls = 'ok') {
  $('#fileDot').className = 'dot ' + cls;
  $('#fileName').textContent = msg;
}
function statusLine() {
  if (S.mode === 'admin') setStatus(`Admin · ${S.email} · ${S.mRows.length} records`);
  else setStatus(`Field office · ${S.mRows.length} pending`);
}
function refreshAll() {
  if (S.mode === 'admin') { buildDatalists(); renderDash(); }
  buildPendFilters(); renderPend(); updateBadge(); statusLine();
}
function isAdmin() { return S.mode === 'admin'; }

/* ---------- start-up / login ---------- */
async function boot() {
  let ok = false;
  try {
    if (typeof supabase === 'undefined') throw new Error('lib/supabase.js did not load. Check that the lib folder (with supabase.js) is uploaded next to index.html.');
    if (!window.GEDA_CONFIG) throw new Error('config.js did not load or has a typing mistake. Check that config.js is next to index.html.');
    ok = DB.init();
  } catch (e) {
    console.error(e); setStatus('Not connected', 'bad'); $('#tabs').style.display = 'none'; $('#btnLogin').style.display = 'none'; $('#btnRefresh').style.display = 'none';
    $('#setupCard').style.display = ''; $('#setupCard').insertAdjacentHTML('afterbegin', `<div class="note bad"><b>Problem:</b> ${esc(e.message)}</div>`); return;
  }
  if (!ok) { $('#setupCard').style.display = ''; setStatus('Not connected – check config.js', 'bad'); $('#tabs').style.display = 'none'; $('#btnLogin').style.display = 'none'; $('#btnRefresh').style.display = 'none'; return; }
  busy(true, 'Loading…');
  try {
    const s = await DB.session();
    if (s.admin) { S.mode = 'admin'; S.email = s.email; } else S.mode = 'field';
    await loadData();
    if (!s.admin && s.email) toast(`${esc(s.email)} is not in the admins list – working in field mode.`, 'bad', 8000);
  } catch (e) { console.error(e); setStatus('Server error', 'bad'); toast('Could not reach the server: ' + esc(e.message), 'bad', 10000); }
  finally { busy(false); }
  applyMode();
  if (location.hash === '#admin' && !isAdmin()) openLogin();
}
async function loadData() {
  await Promise.all([DB.loadSdn(), DB.loadSettings()]);
  if (isAdmin()) await Promise.all([DB.loadMaster(), DB.loadGedaLight(), DB.loadActivity()]);
  else await DB.loadPending();
  S.loaded = true;
}
function applyMode() {
  document.body.classList.toggle('field', !isAdmin());
  $('#btnLogin').textContent = isAdmin() ? 'Log out' : 'Admin login';
  $('#byWrap').style.display = isAdmin() ? 'none' : '';
  $('#cFillWrap').style.display = isAdmin() ? '' : 'none';
  $('#pBy').value = localStorage.getItem('geda.by') || '';
  renderSettings(); refreshAll();
  showPage(isAdmin() ? 'dash' : 'pend');
}
function openLogin() {
  if (!S.sb) { toast('Not connected to Supabase: <b>config.js</b> still has the placeholder URL/key. Put your Project URL and anon key in config.js.', 'bad', 10000); return; } $('#loginBox').style.display = ''; $('#lgMsg').innerHTML = ''; setTimeout(() => $('#lgEmail').focus(), 50); }
async function doLogin() {
  const email = $('#lgEmail').value.trim(), pass = $('#lgPass').value;
  if (!email || !pass) return;
  $('#lgGo').disabled = true;
  try {
    const s = await DB.login(email, pass);
    if (!s.admin) { $('#lgMsg').innerHTML = `<div class="note bad">Logged in, but ${esc(email)} is not in the admins table. Ask the administrator to add it.</div>`; await DB.logout(); return; }
    S.mode = 'admin'; S.email = s.email; $('#loginBox').style.display = 'none'; $('#lgPass').value = '';
    busy(true, 'Loading all records…'); await loadData(); busy(false); applyMode(); history.replaceState(null, '', location.pathname);
  } catch (e) { $('#lgMsg').innerHTML = `<div class="note bad">${esc(e.message)}</div>`; }
  finally { $('#lgGo').disabled = false; busy(false); }
}
async function doLogout() { await DB.logout(); S.mode = 'field'; S.email = ''; CUR = null; $('#roForm').style.display = 'none'; busy(true, 'Loading…'); try { await loadData(); } finally { busy(false); } applyMode(); }
async function reload() {
  if (!S.sb) return; busy(true, 'Refreshing…');
  try { await loadData(); refreshAll(); toast('Data refreshed from server.', 'ok', 2500); }
  catch (e) { toast('Refresh failed: ' + esc(e.message), 'bad'); } finally { busy(false); }
}

/* ---------- tabs ---------- */
function showPage(p) {
  if (!isAdmin() && !['pend', 'chg'].includes(p)) p = 'pend';
  $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.p === p));
  $$('section.page').forEach(s => s.classList.toggle('on', s.id === 'p-' + p));
  if (p === 'chg') renderChargesPage();
  window.scrollTo(0, 0);
}

/* ---------- status helpers ---------- */
function bidirState(v) {
  const b = v.bidir;
  if (isD(b)) return 'released';
  const s = String(b ?? '').trim().toLowerCase();
  if (s === 'pending') return 'pending';
  if (s.includes('cancel') || s.includes('delet')) return 'cancelled';
  if (!s) return 'blank';
  if (parseDateLoose(s)) return 'released';
  return 'other';
}
const roSerial = v => parseDateLoose(v.roDate);
function sdnName(v) { const c = String(v.cons ?? '').replace(/\D/g, ''); if (!c) return clean(v.sdn); const code = String(+(c.length === 10 ? c.slice(0, 2) : c.slice(0, 3))); return S.sdn.get(code) || clean(v.sdn); }
function portalMeter(rec) {
  if (rec.portal) return rec.portal;
  const g = S.geda.get(rec.key); if (!g) return null;
  return { d: parseDateLoose(gv(g, 'Date of Installation of Solar Meter')), status: clean(gv(g, 'Application Status')) };
}
const whenTxt = t => t ? new Date(t).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';

/* ---------- dashboard ---------- */
function renderDash() {
  const today = todaySerial(), [ty, tm] = ymdOf(today);
  let ro = 0, rel = 0, pend = 0, p30 = 0, canc = 0, roM = 0, relM = 0, dsum = 0, dn = 0;
  const div = new Map();
  for (const r of S.mRows) {
    const v = r.v, st = bidirState(v), rs = roSerial(v), dv = clean(v.div) || '(blank)';
    if (!div.has(dv)) div.set(dv, { ro: 0, rel: 0, pend: 0, p30: 0, ds: 0, dn: 0 });
    const D = div.get(dv);
    if (rs) { ro++; D.ro++; const [y, m] = ymdOf(rs); if (y === ty && m === tm) roM++; }
    if (st === 'released') {
      rel++; D.rel++; const bs = parseDateLoose(v.bidir);
      if (bs) { const [y, m] = ymdOf(bs); if (y === ty && m === tm) relM++; if (rs && bs >= rs && bs - rs < 400) { dsum += bs - rs; dn++; D.ds += bs - rs; D.dn++; } }
    }
    if (st === 'pending') { pend++; D.pend++; if (rs && today - rs > 30) { p30++; D.p30++; } }
    if (st === 'cancelled') canc++;
  }
  const tile = (k, v, cls = '', click = '') => `<div class="tile ${cls}" ${click ? `style="cursor:pointer" onclick="${click}"` : ''}><div class="k">${k}</div><div class="v">${v}</div></div>`;
  $('#tiles').innerHTML = [
    tile('RO issued', ro.toLocaleString('en-IN')), tile('Meter released', rel.toLocaleString('en-IN'), 'ok'),
    tile('Pending release', pend, 'warn', "App.go('pend')"), tile('Pending > 30 days', p30, p30 ? 'bad' : '', "App.go('pend',30)"),
    tile('ROs this month', roM), tile('Releases this month', relM), tile('Avg. days RO → meter', dn ? (dsum / dn).toFixed(1) : '–'),
    tile('Cancelled', canc)
  ].join('');
  const rows = [...div.entries()].filter(([k]) => k !== '(blank)').sort((a, b) => a[0].localeCompare(b[0]));
  $('#divTable').innerHTML = `<thead><tr><th>Division</th><th class="num">RO issued</th><th class="num">Released</th><th class="num">Pending</th><th class="num">&gt;30 days</th><th class="num">Avg days</th></tr></thead><tbody>` +
    rows.map(([k, d]) => `<tr><td>${esc(k)}</td><td class="num">${d.ro}</td><td class="num">${d.rel}</td><td class="num"><a href="#" data-div="${esc(k)}">${d.pend}</a></td><td class="num">${d.p30 ? `<span class="pill bad">${d.p30}</span>` : 0}</td><td class="num">${d.dn ? (d.ds / d.dn).toFixed(1) : '–'}</td></tr>`).join('') + '</tbody>';
  const act = S.activity || [];
  $('#actTable').innerHTML = `<thead><tr><th>When</th><th>Application</th><th>What</th><th>By</th></tr></thead><tbody>` +
    (act.length ? act.map(a => {
      const d = a.detail || {};
      const what = a.action === 'released' ? `Meter installed ${d.meter_date ? fmtD(parseDateLoose(d.meter_date)) : ''}` : a.action === 'reason' ? `Reason: ${esc(d.reason || '')}` : esc(a.action || '');
      return `<tr><td class="small">${whenTxt(a.at)}</td><td><a href="#" data-open="${esc(appKey(a.app_no))}">${esc(a.app_no)}</a></td><td>${what}</td><td>${esc(a.by_name)}</td></tr>`;
    }).join('') : '<tr><td colspan="4" class="muted">No updates yet.</td></tr>') + '</tbody>';
}
function updateBadge() { $('#pendBadge').textContent = S.mRows.filter(r => bidirState(r.v) === 'pending').length; }

/* ---------- lookup ---------- */
function findApp(q) {
  q = clean(q); if (!q) return null;
  const k = appKey(q);
  if (S.mByKey.has(k) || S.geda.has(k)) return k;
  if (/^\d{3,}$/.test(q)) {
    const hits = new Set();
    for (const r of S.mRows) if (r.key.endsWith(q)) hits.add(r.key);
    for (const [kk] of S.geda) if (kk.endsWith(q)) hits.add(kk);
    if (hits.size === 1) return [...hits][0];
    const exact = [...hits].filter(h => (h.match(/(\d+)$/) || [])[1] === q);
    if (exact.length === 1) return exact[0];
  }
  return null;
}
function searchApps(q, lim = 12) {
  q = clean(q).toUpperCase(); if (q.length < 3) return [];
  const out = [], seen = new Set();
  const push = (key, label) => { if (seen.has(key) || out.length >= lim) return; seen.add(key); out.push({ key, label }); };
  for (const r of S.mRows) { const s = (r.key + ' ' + r.v.cons + ' ' + r.v.name).toUpperCase(); if (s.includes(q)) push(r.key, `${esc(r.key)} · ${esc(clean(r.v.name))} · ${esc(r.v.cons)} <span class="pill info">RO entered</span>`); }
  for (const g of S.gList) { const k = appKey(g.__app); const s = (k + ' ' + gv(g, 'Consumer No.') + ' ' + gName(g)).toUpperCase(); if (s.includes(q)) push(k, `${esc(k)} · ${esc(gName(g))} · ${esc(gv(g, 'Consumer No.'))} <span class="pill">${esc(gv(g, 'Application Status'))}</span>`); }
  return out;
}

/* ---------- Release Order form ---------- */
const F = {
  reg: 'f_reg', cons: 'f_cons', name: 'f_name', cat: 'f_cat', tariff: 'f_tariff', cl: 'f_cl', msme: 'f_msme', pv: 'f_pv', ex: 'f_ex', div: 'f_div', sdn: 'f_sdn',
  addr: 'f_addr', taluka: 'f_taluka', village: 'f_village', installer: 'f_installer', cei: 'f_cei', roNo: 'f_roNo', eurja: 'f_eurja', policy: 'f_policy', general: 'f_general',
  pmake: 'f_pmake', pwatt: 'f_pwatt', pnos: 'f_pnos', imake: 'f_imake', icap: 'f_icap', volt: 'f_volt', isr: 'f_isr', remark: 'f_remark'
};
const DATEF = { agr: 'f_agr', roDate: 'f_roDate' };
const NUMK = new Set(['cl', 'pv', 'ex', 'pwatt', 'pnos', 'icap', 'volt']);
const CHG = [
  { k: 'meter', r: 'meterR', label: 'Bi-directional meter + SMC box', calc: c => c.meterSmc, fx: c => `Meter ${inr(c.meter)} + SMC ${inr(c.smc)}${c.gen ? ' + Gen. meter ' + inr(c.gen) : ''}` },
  { k: 'test', r: 'testR', label: 'Meter testing charges', calc: c => c.test, fx: c => `GST/liability on meter, SMC, testing: Rs. ${inr(c.liability)}` },
  { k: 'conn', r: 'connR', label: 'Connectivity charges', calc: c => c.conn, fx: () => '' },
  { k: 'ss', r: 'ssR', label: 'System strengthening charges', calc: c => c.ss, fx: () => '' }
];
let CUR = null;

function splitReceipt(s) {
  s = clean(showVal(s)); if (!s || s === '0' || /^-+$/.test(s)) return ['', ''];
  const m = s.match(/^(.*?)[\s,]*(?:\/|dt\.?|dtd\.?|date[d:]?)\s*[:.]?\s*(\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4})\s*$/i);
  if (m) return [m[1].trim(), isoD(parseDateLoose(m[2]))];
  return [s, ''];
}
function joinReceipt(no, iso) { no = clean(no); if (!no) return ''; if (!iso) return no; const [y, m, d] = iso.split('-'); return `${no} Dt. ${d}.${m}.${y}`; }

function openRO(key) { showPage('ro'); $('#roSearch').value = key; fetchApp(); }
async function fetchApp() {
  $('#roSugg').style.display = 'none';
  const q = $('#roSearch').value, key = findApp(q);
  if (!key) {
    const s = searchApps(q);
    $('#roMsg').innerHTML = s.length ? `<div class="note info">Several matches – pick one from the list.</div>` : `<div class="note bad">No application found for “${esc(q)}”. Check the number, or update portal data in Settings.</div>`;
    if (s.length) showSugg(s); return;
  }
  let g = S.geda.get(key) || null;
  if (g && !g.__full) { busy(true, 'Loading portal details…'); try { g = await DB.getGeda(key); } catch (e) { toast('Portal details not loaded: ' + esc(e.message), 'bad'); } finally { busy(false); } }
  CUR = { key, rec: S.mByKey.get(key) || null, g, over: {} };
  $('#roMsg').innerHTML = '';
  fillForm();
  $('#roForm').style.display = '';
}
function gedaVal(g, k) {
  if (!g) return '';
  if (k === 'name') return gName(g);
  const h = GEDA_SRC[k]; if (!h) return '';
  return gv(g, h);
}
function fillForm() {
  const { rec, g, key } = CUR; const v = rec ? rec.v : {};
  const pick = k => { const sv = v[k]; if (rec && sv !== '' && sv != null) return sv; const gvv = gedaVal(g, k); return gvv !== '' ? gvv : (sv ?? ''); };
  const app = rec ? clean(v.app) : (g ? g.__app : key);
  $('#roTitle').textContent = app;
  $('#roState').innerHTML = rec ? `<span class="pill info">RO entered</span> ` + statePill(rec.v) + (rec.updatedBy ? ` <span class="who">Last updated by ${esc(rec.updatedBy)} · ${whenTxt(rec.updatedAt)}</span>` : '') : `<span class="pill warn">New – no RO yet</span>`;
  for (const [k, id] of Object.entries(F)) $('#' + id).value = showVal(pick(k));
  if (!rec) {
    $('#f_msme').value = 'Yes';
    $('#f_policy').value = SET.policy; $('#f_general').value = SET.settlement;
    const ph = clean(gv(g, 'Phase of proposed Solar Inverter')).toLowerCase();
    $('#f_volt').value = ph.startsWith('3') ? '415' : '230';
    const ceiId = clean(gv(g, 'CEI Inspection Application ID')), ceiD = parseDateLoose(gv(g, 'CEI Inspection Approval Date'));
    if (ceiId) $('#f_cei').value = ceiD ? `${ceiId} Dt. ${fmtD(ceiD)}` : ceiId;
  } else {
    const mv = clean(v.msme); $('#f_msme').value = /^y/i.test(mv) ? 'Yes' : /^n/i.test(mv) ? 'NO' : '-';
  }
  if (!['230', '415', '400'].includes(String($('#f_volt').value))) { const o = document.createElement('option'); o.textContent = showVal(v.volt) || '230'; $('#f_volt').appendChild(o); $('#f_volt').value = o.textContent; }
  const agr = rec ? parseDateLoose(v.agr) : parseDateLoose(gv(g, 'Agreement Signing Date'));
  $('#f_agr').value = agr ? isoD(agr) : '';
  const rd = rec ? parseDateLoose(v.roDate) : todaySerial();
  $('#f_roDate').value = rd ? isoD(rd) : '';
  $('#f_rotype').value = rec && v.roType ? v.roType : (numOr($('#f_ex').value) > 0 ? 'add' : 'new');
  $('#f_gen').checked = rec ? numOr(v.genMeter) > 0 : false;
  const st = rec ? bidirState(v) : 'pending';
  if (st === 'released') { $('#f_bidirSel').value = 'date'; $('#f_bidirDate').value = isoD(parseDateLoose(v.bidir)); }
  else if (st === 'pending' || st === 'blank') { $('#f_bidirSel').value = 'Pending'; $('#f_bidirDate').value = ''; }
  else { $('#f_bidirSel').value = 'other'; $('#f_bidirText').value = clean(v.bidir); }
  bidirUI();
  $('#chgRows').innerHTML = CHG.map(c => `<tr data-k="${c.k}"><td>${c.label}</td><td><input type="number" step="any" id="c_${c.k}"></td><td><span class="fx" id="fx_${c.k}"></span></td><td><input id="r_${c.k}" placeholder="M.R. No."></td><td><input type="date" id="d_${c.k}"></td></tr>`).join('') +
    `<tr class="total"><td>Total (excluding GST/liability)</td><td class="num" id="c_total"></td><td colspan="3" class="small muted" id="c_grand"></td></tr>`;
  CUR.over = {};
  for (const c of CHG) {
    if (rec && v[c.k] !== '' && v[c.k] != null && isNum(v[c.k])) { $('#c_' + c.k).value = +v[c.k]; CUR.over[c.k] = 'saved'; }
    const [no, d] = splitReceipt(rec ? v[c.r] : ''); $('#r_' + c.k).value = no; $('#d_' + c.k).value = d;
  }
  const kv = [];
  const add = (k, val) => { if (val !== '' && val != null) kv.push(`<div><b>${k}</b>${esc(showVal(val))}</div>`); };
  if (g) {
    add('Portal status', gv(g, 'Application Status')); add('Installer', gv(g, 'Installer Name')); add('Phase', gv(g, 'Phase of proposed Solar Inverter'));
    add('DisCom estimate (portal)', isNum(gv(g, 'DisCom Estimate Amount')) ? 'Rs. ' + inr(gv(g, 'DisCom Estimate Amount')) : ''); add('Payment made on', gv(g, 'Payment Made on'));
    add('CEI inspection ID / date', [gv(g, 'CEI Inspection Application ID'), showVal(gv(g, 'CEI Inspection Approval Date'))].filter(Boolean).join(' · '));
    add('Agreement signed (portal)', gv(g, 'Agreement Signing Date')); add('Consumer mobile', gv(g, 'Consumer Mobile'));
    add('Meter installed (portal)', gv(g, 'Date of Installation of Solar Meter'));
  } else kv.push('<div class="muted">Not found in portal data – fill the consumer details by hand, or update portal data in Settings.</div>');
  $('#portalKv').innerHTML = kv.join('');
  updateCalc(); panelCheck();
  $('#roSaveInfo').textContent = rec ? 'Saving updates this RO on the server.' : 'Saving adds this RO to the server.';
}
function statePill(v) { const st = bidirState(v); return st === 'released' ? `<span class="pill ok">Meter released ${esc(fmtD(parseDateLoose(v.bidir)))}</span>` : st === 'pending' ? '<span class="pill warn">Release pending</span>' : st === 'cancelled' ? `<span class="pill bad">${esc(clean(v.bidir))}</span>` : ''; }
function bidirUI() { const s = $('#f_bidirSel').value; $('#bidirDateWrap').style.display = s === 'date' ? '' : 'none'; $('#bidirTextWrap').style.display = s === 'other' ? '' : 'none'; }
function curCalc() { return calcCharges({ type: $('#f_rotype').value, cl: $('#f_cl').value, pv: $('#f_pv').value, ex: $('#f_ex').value, gen: $('#f_gen').checked }); }
function updateCalc() {
  if (!CUR) return;
  const c = curCalc(); let tot = 0;
  $('#genWrap').style.display = $('#f_rotype').value === 'add' ? '' : 'none';
  for (const ch of CHG) {
    const el = $('#c_' + ch.k), fv = ch.calc(c);
    if (!CUR.over[ch.k]) el.value = fv;
    const differs = numOr(el.value) !== fv;
    el.classList.toggle('override', differs);
    $('#fx_' + ch.k).innerHTML = (differs ? `Formula: Rs. ${inr(fv)} <button class="link" data-use="${ch.k}">use formula</button>` : `= formula`) + (ch.fx(c) ? `<div>${esc(ch.fx(c))}</div>` : '');
    tot += numOr(el.value);
  }
  $('#c_total').textContent = inr(tot);
  $('#c_grand').textContent = `With GST/liability Rs. ${inr(c.liability)} → Rs. ${inr(tot + c.liability)}`;
  const ht = /^HT/i.test(clean($('#f_cat').value)) || /^HT/i.test(clean($('#f_tariff').value));
  $('#chgNote').innerHTML = (ht ? '<div class="note warn">HT consumer: the formula follows the LT estimate sheet. Enter the amounts as per the HT estimate.</div>' : '') + esc(c.notes.join(' '));
}
function panelCheck() {
  const w = numOr($('#f_pwatt').value), n = numOr($('#f_pnos').value);
  $('#f_ptot').value = w && n ? w * n : '';
  const msgs = [], pv = numOr($('#f_pv').value), ic = numOr($('#f_icap').value), tot = w * n / 1000;
  if (ic && pv && ic > pv) msgs.push(`Inverter capacity ${ic} kW is more than the applied PV capacity ${pv} kW.`);
  if (tot && pv && tot < pv) msgs.push(`Total module capacity ${tot.toFixed(2)} kWp is less than the PV capacity ${pv} kW.`);
  $('#panelWarn').innerHTML = msgs.map(m => `<div class="note warn">${esc(m)}</div>`).join('');
}
function readForm() {
  const v = { __key: CUR.key };
  for (const [k, id] of Object.entries(F)) { const s = $('#' + id).value.trim(); v[k] = NUMK.has(k) && isNum(s) ? +s : s; }
  for (const [k, id] of Object.entries(DATEF)) { const s = $('#' + id).value; v[k] = s ? { d: parseDateLoose(s) } : ''; }
  v.app = CUR.rec ? clean(CUR.rec.v.app) : (CUR.g ? CUR.g.__app : clean($('#roSearch').value).toUpperCase());
  v.ptot = numOr($('#f_ptot').value) || '';
  v.icheck = isNum(v.icap) && isNum(v.pv) ? (v.icap <= v.pv ? 'Yes' : 'NO') : '';
  const c = curCalc();
  for (const ch of CHG) {
    const a = $('#c_' + ch.k).value; v[ch.k] = isNum(a) ? +a : 0;
    const r = joinReceipt($('#r_' + ch.k).value, $('#d_' + ch.k).value);
    v[ch.r] = r || (v[ch.k] ? '' : '0');
  }
  v.roType = $('#f_rotype').value; v.genMeter = v.roType === 'add' && $('#f_gen').checked ? c.gen : '';
  v.agrYes = 'YES';
  const bs = $('#f_bidirSel').value;
  v.bidir = bs === 'date' ? ($('#f_bidirDate').value ? { d: parseDateLoose($('#f_bidirDate').value) } : 'Pending') : bs === 'other' ? $('#f_bidirText').value.trim() : 'Pending';
  return v;
}
function validate(v) {
  const miss = [];
  if (!v.name) miss.push('Name of consumer'); if (!v.cons) miss.push('Consumer No.'); if (!isNum(v.pv)) miss.push('PV capacity');
  if (!v.cei) miss.push('CEI approval'); if (!v.agr) miss.push('Agreement date'); if (!v.pmake) miss.push('Panel make');
  if (!v.imake) miss.push('Inverter make'); if (!v.isr) miss.push('Inverter Sr. No.'); if (!v.roDate) miss.push('RO date');
  for (const c of CHG) if (v[c.k] > 0 && !$('#r_' + c.k).value.trim()) miss.push(c.label + ' receipt');
  return miss;
}
function sameVal(a, b) { const x = showVal(a), y = showVal(b); if (isNum(x) && isNum(y)) return +x === +y; return clean(x) === clean(y); }
const SAVE_KEYS = ['reg', 'cons', 'name', 'pv', 'ex', 'cl', 'cat', 'div', 'sdn', 'addr', 'taluka', 'village', 'cei', 'agr', 'pmake', 'pwatt', 'pnos', 'ptot', 'imake', 'icap', 'icheck', 'volt', 'isr',
  'meter', 'meterR', 'test', 'testR', 'conn', 'connR', 'ss', 'ssR', 'agrYes', 'roNo', 'roDate', 'bidir', 'eurja', 'general', 'tariff', 'msme', 'policy', 'remark', 'installer', 'roType', 'genMeter'];
async function saveRO(withWord) {
  if (!CUR) return;
  const v = readForm(), miss = validate(v);
  if (miss.length && !confirm('These are still empty:\n• ' + miss.join('\n• ') + '\n\nSave anyway?')) return;
  busy(true, 'Saving to server…');
  try {
    let rec, changed = 0;
    if (CUR.rec) {
      const vals = {};
      for (const k of SAVE_KEYS) if (!sameVal(v[k], CUR.rec.v[k])) vals[k] = v[k];
      changed = Object.keys(vals).length;
      if (changed) {
        rec = await DB.updateMaster(CUR.rec.v.app, vals);
        const what = isD(vals.bidir) ? 'released' : 'ro_updated';
        await DB.log(rec.v.app, what, what === 'released' ? { meter_date: isoD(vals.bidir.d) } : { fields: Object.keys(vals) });
      } else rec = CUR.rec;
    } else {
      const maxSr = S.mRows.reduce((m, r) => Math.max(m, numOr(r.v.sr)), 0);
      const nv = { sr: maxSr + 1, app: v.app, status: gedaVal(CUR.g, 'status') };
      for (const k of SAVE_KEYS) nv[k] = v[k];
      rec = await DB.insertMaster(nv); changed = 1;
      await DB.log(rec.v.app, 'ro_created', { ro_date: toCell('roDate', v.roDate) });
    }
    const i = S.mRows.findIndex(r => r.key === rec.key);
    if (i >= 0) S.mRows[i] = rec; else S.mRows.push(rec);
    S.mByKey.set(rec.key, rec); CUR.rec = rec;
    busy(false);
    toast(changed ? `Saved ${esc(rec.v.app)}.` : 'No changes to save.', 'ok');
    if (withWord) await makeRO(Object.assign({}, rec.v, v, { __key: CUR.key }), $('#f_rotype').value);
    $('#roState').innerHTML = `<span class="pill info">RO entered</span> ` + statePill(rec.v) + ` <span class="who">Last updated by ${esc(rec.updatedBy)} · ${whenTxt(rec.updatedAt)}</span>`;
    $('#roSaveInfo').textContent = 'Saving updates this RO on the server.';
    DB.loadActivity().then(() => isAdmin() && renderDash()).catch(() => { });
    refreshAll();
  } catch (e) { console.error(e); toast('Save failed: ' + esc(e.message), 'bad', 9000); }
  finally { busy(false); }
}
async function wordOnly() { if (!CUR) return; try { await makeRO(readForm(), $('#f_rotype').value); } catch (e) { console.error(e); toast('Could not make the Word file: ' + esc(e.message), 'bad'); } }
function showSugg(list) {
  const el = $('#roSugg');
  if (!list.length) { el.style.display = 'none'; return; }
  el.innerHTML = list.map(s => `<div data-k="${esc(s.key)}">${s.label}</div>`).join(''); el.style.display = '';
}
function buildDatalists() {
  const cnt = k => { const m = new Map(); for (const r of S.mRows.slice(-800)) { const x = clean(r.v[k]).toUpperCase(); if (x) m.set(x, (m.get(x) || 0) + 1); } return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60).map(e => e[0]); };
  $('#dlPanel').innerHTML = cnt('pmake').map(x => `<option value="${esc(x)}">`).join('');
  $('#dlInv').innerHTML = cnt('imake').map(x => `<option value="${esc(x)}">`).join('');
}

/* ---------- Pending release ---------- */
const PEND = { edits: new Map() };   // key -> {date:'yyyy-mm-dd', reason}
function buildPendFilters() {
  const pend = S.mRows.filter(r => bidirState(r.v) === 'pending');
  const divs = [...new Set(pend.map(r => clean(r.v.div)).filter(Boolean))].sort();
  const keep = $('#pDiv').value || localStorage.getItem('geda.pDiv') || '';
  $('#pDiv').innerHTML = '<option value="">All divisions</option>' + divs.map(d => `<option>${esc(d)}</option>`).join('');
  if (divs.includes(keep)) $('#pDiv').value = keep;
  buildSdnFilter();
}
function buildSdnFilter() {
  const dv = $('#pDiv').value, keep = $('#pSdn').value || localStorage.getItem('geda.pSdn') || '';
  const sd = [...new Set(S.mRows.filter(r => bidirState(r.v) === 'pending' && (!dv || clean(r.v.div) === dv)).map(r => sdnName(r.v)).filter(Boolean))].sort();
  $('#pSdn').innerHTML = '<option value="">All sub-divisions</option>' + sd.map(d => `<option>${esc(d)}</option>`).join('');
  if (sd.includes(keep)) $('#pSdn').value = keep;
}
function pendRows() {
  const dv = $('#pDiv').value, sd = $('#pSdn').value, q = clean($('#pQ').value).toUpperCase(), age = $('#pAge').value, today = todaySerial();
  return S.mRows.filter(r => {
    if (bidirState(r.v) !== 'pending') return false;
    if (dv && clean(r.v.div) !== dv) return false;
    if (sd && sdnName(r.v) !== sd) return false;
    if (age === '30') { const rs = roSerial(r.v); if (!rs || today - rs <= 30) return false; }
    if (q && !(r.key + ' ' + r.v.cons + ' ' + r.v.name + ' ' + r.v.village).toUpperCase().includes(q)) return false;
    return true;
  }).sort((a, b) => (roSerial(a.v) || 0) - (roSerial(b.v) || 0));
}
function renderPend() {
  const rows = pendRows(), today = todaySerial();
  $('#pCount').textContent = `${rows.length} pending connection${rows.length === 1 ? '' : 's'}`;
  $('#pendTable').innerHTML = `<thead><tr><th style="width:44px" class="num">#</th><th>Consumer</th><th>Sub-division</th><th class="num">PV kW</th><th>RO date</th><th class="num">Days</th><th style="width:150px">Meter installed on</th><th style="min-width:240px">Reason for pending</th></tr></thead><tbody>` +
    (rows.length ? rows.map((r, i) => {
      const v = r.v, rs = roSerial(v), days = rs ? today - rs : '', e = PEND.edits.get(r.key) || {};
      const nm = esc(clean(v.name));
      const nameCell = isAdmin() ? `<a href="#" data-open="${esc(r.key)}" class="cname">${nm}</a>` : `<div class="cname">${nm}</div>`;
      const dayTxt = days !== '' ? (days > 30 ? `<span class="pill bad">${days}</span>` : days > 7 ? `<span class="pill warn">${days}</span>` : days) : '';
      return `<tr data-k="${esc(r.key)}" class="${PEND.edits.has(r.key) ? 'dirty' : ''}"><td class="num muted c-no">${i + 1}</td>
        <td class="c-cons">${nameCell}<div class="small muted">Cons. No. ${esc(v.cons)} · ${esc(clean(v.village))}</div></td>
        <td data-l="Sub-division">${esc(sdnName(v))}<div class="small muted">${esc(clean(v.div))}</div></td>
        <td class="num" data-l="PV kW">${esc(v.pv)}${numOr(v.ex) ? `<span class="small muted"> +${esc(v.ex)}</span>` : ''}</td>
        <td data-l="RO date">${rs ? fmtD(rs) : ''}</td><td class="num" data-l="Days">${dayTxt}</td>
        <td data-l="Meter installed on" class="c-in"><input type="date" data-f="date" max="${isoD(today)}" value="${esc(e.date ?? '')}"></td>
        <td data-l="Reason for pending" class="c-in"><input data-f="reason" value="${esc(e.reason ?? clean(v.remark))}" placeholder="Reason if not released">${r.updatedBy && clean(v.remark) ? `<div class="who">${esc(r.updatedBy)} · ${whenTxt(r.updatedAt)}</div>` : ''}</td></tr>`;
    }).join('') : '<tr><td colspan="8" class="empty">No pending connections for this filter.</td></tr>') + '</tbody>';
  updatePendBar();
}
function pendEdit(key, f, val) {
  const rec = S.mByKey.get(key); const e = PEND.edits.get(key) || {};
  e[f] = val;
  const changed = (e.date && e.date !== '') || (e.reason !== undefined && clean(e.reason) !== clean(rec.v.remark));
  if (changed) PEND.edits.set(key, e); else PEND.edits.delete(key);
  const tr = $(`#pendTable tr[data-k="${CSS.escape(key)}"]`); if (tr) tr.classList.toggle('dirty', PEND.edits.has(key));
  updatePendBar();
}
function updatePendBar() {
  const n = PEND.edits.size, rel = [...PEND.edits.values()].filter(e => e.date).length;
  $('#pendBar').classList.toggle('on', n > 0);
  $('#pendDirtyN').textContent = `${n} change${n === 1 ? '' : 's'}${rel ? ` · ${rel} to release` : ''}`;
}
async function savePend() {
  if (!PEND.edits.size) return;
  const name = clean($('#pBy').value), by = isAdmin() ? 'Admin – ' + S.email : 'Field – ' + name;
  if (!isAdmin() && name.length < 2) { toast('Enter your name & designation first.', 'bad'); $('#pBy').focus(); return; }
  if (!isAdmin()) localStorage.setItem('geda.by', name);
  const todo = [];
  for (const [key, e] of PEND.edits) {
    const rec = S.mByKey.get(key); if (!rec) continue;
    const s = e.date ? parseDateLoose(e.date) : null, rs = roSerial(rec.v);
    if (s && s > todaySerial()) { toast(`${esc(rec.v.app)}: meter date is in the future.`, 'bad'); return; }
    if (s && rs && s < rs && !confirm(`${rec.v.app}: meter date ${fmtD(s)} is before the RO date ${fmtD(rs)}. Save anyway?`)) continue;
    const reason = e.reason !== undefined && clean(e.reason) !== clean(rec.v.remark) ? clean(e.reason) : null;
    todo.push({ rec, iso: s ? isoD(s) : null, reason });
  }
  let ok = 0, fail = [];
  for (const [i, t] of todo.entries()) {
    busy(true, `Saving ${i + 1} / ${todo.length}…`);
    try { await DB.fieldUpdate(t.rec.v.app, t.iso, t.reason, by); ok++; PEND.edits.delete(t.rec.key); }
    catch (e) { fail.push(`${t.rec.v.app}: ${e.message}`); }
  }
  busy(false);
  if (ok) toast(`Saved ${ok} entr${ok === 1 ? 'y' : 'ies'}.`, 'ok');
  if (fail.length) toast('Not saved:<br>' + fail.map(esc).join('<br>'), 'bad', 12000);
  await reload();
}
function usePortalDates() {
  let n = 0;
  for (const r of pendRows()) { const pm = portalMeter(r); if (pm && pm.d) { const e = PEND.edits.get(r.key) || {}; if (!e.date) { e.date = isoD(pm.d); PEND.edits.set(r.key, e); n++; } } }
  renderPend(); toast(n ? `Filled ${n} meter date${n === 1 ? '' : 's'} from the portal. Check them, then click Save.` : 'No pending rows in this filter have a meter date on the portal.', n ? 'ok' : '');
}
function pendencySheet(rows) {
  const today = todaySerial();
  const H = ['Name of Division', 'GEDA APPLICATION NO', 'Name of Sub Division', 'Consumer No.', 'Name of Consumer', 'PV Capacity', 'Existing PV Capacity (kW)', 'Sanctioned / Contract Load', 'City/Village', 'Release Order Date', 'Bi-Directional meter installed', 'EURJA SR NO.', 'TARIFF', 'Reason for Pending', 'Days since RO'];
  const n = x => xnum(x);
  const aoa = [H, ...rows.map(r => { const v = r.v, rs = roSerial(v); return [clean(v.div), clean(v.app), sdnName(v), n(v.cons), clean(v.name), n(v.pv), n(v.ex), n(v.cl), clean(v.village), rs ? fmtD(rs) : '', 'Pending', showVal(v.eurja), clean(v.tariff), clean(v.remark), rs ? today - rs : '']; })];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [24, 24, 16, 14, 34, 9, 10, 10, 18, 12, 12, 12, 9, 36, 8].map(w => ({ wch: w }));
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: aoa.length - 1, c: H.length - 1 } }) };
  return ws;
}
function pendencyExcel() {
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, pendencySheet(pendRows()), 'Pendency');
  const tag = $('#pSdn').value || $('#pDiv').value || 'All';
  XLSX.writeFile(wb, safeName(`Solar Pendency ${tag} ${fmtD(todaySerial())}.xlsx`));
}

/* ---------- GEDA Charges page ---------- */
function renderChargesPage() {
  const type = $('input[name=cType]:checked').value;
  $('#cEXwrap').style.display = type === 'add' ? '' : 'none'; $('#cGenWrap').style.display = type === 'add' ? '' : 'none';
  $('#cPVlbl').firstChild.textContent = type === 'add' ? 'Additional PV capacity (kW)' : 'PV capacity applied (kW)';
  const cl = $('#cCL').value, pv = $('#cPV').value;
  if (!isNum(cl) || !isNum(pv)) { $('#chgOut').innerHTML = '<div class="muted">Enter contract load and PV capacity.</div>'; return; }
  const c = calcCharges({ type, cl, pv, ex: $('#cEX').value, gen: $('#cGen').checked });
  const line = (a, b, cls = '') => `<tr class="${cls}"><td>${a}</td><td class="num">${inr(b)}</td></tr>`;
  const sub1 = c.meter + c.smc + c.test + c.liability + c.gen;
  $('#chgOut').innerHTML = `<div class="row" style="margin-bottom:8px"><h2>Solar rooftop charges – ${type === 'add' ? 'Additional load' : 'New installation'}</h2><span class="spacer"></span><span class="muted small">${fmtD(todaySerial())}</span></div>
    <div class="small muted" style="margin-bottom:10px">Contract load ${c.cl} kW · ${type === 'add' ? `Existing PV ${c.ex} kW + Additional ${c.pv} kW = ${+c.total.toFixed(3)} kW` : `PV capacity ${c.pv} kW`}${$('#cApp').value ? ' · Application ' + esc($('#cApp').value) : ''}</div>
    <table class="t charges" style="max-width:620px"><thead><tr><th>Item</th><th class="num">Amount (Rs.)</th></tr></thead><tbody>
    ${line('Bi-directional meter', c.meter)}${line(`GST / liability on meter @ ${RATES.gst}%`, c.meterGst)}
    ${line('SMC box', c.smc)}${line(`GST / liability on SMC @ ${RATES.gst}%`, c.smcGst)}
    ${line('Meter testing', c.test)}${line(`GST / liability on testing @ ${RATES.gst}%`, c.testGst)}
    ${type === 'add' && c.gen ? line('Generation meter', c.gen) : ''}
    ${line('Sub-total: meter, SMC, testing', sub1, 'sub')}
    ${line('Connectivity charges', c.conn, 'sub')}
    ${line('System strengthening charges', c.ss, 'sub')}
    ${line('Total to be recovered', c.grand, 'total')}
    </tbody></table>
    <div class="small muted" style="margin-top:8px">${c.notes.map(esc).join('<br>')}</div>`;
}
async function chargesFill() {
  const key = findApp($('#cApp').value); if (!key) return toast('Application not found.', 'bad');
  const rec = S.mByKey.get(key), g = S.geda.get(key);
  const val = k => { const x = rec ? rec.v[k] : ''; return x !== '' && x != null ? x : gedaVal(g, k); };
  $('#cApp').value = rec ? rec.v.app : g.__app;
  $('#cCL').value = numOr(val('cl')); $('#cPV').value = numOr(val('pv')); $('#cEX').value = numOr(val('ex'));
  $$('input[name=cType]').forEach(r => r.checked = r.value === (numOr(val('ex')) > 0 ? 'add' : 'new'));
  renderChargesPage();
}
function printCharges() { $$('section.page').forEach(s => s.classList.remove('printme')); $('#p-chg').classList.add('printme'); window.print(); }

/* ---------- settings & imports ---------- */
const SETF = ['seName', 'seDesig', 'circle', 'roPrefix', 'policy', 'settlement', 'fontSize', 'font'];
function renderSettings() {
  SETF.forEach(k => $('#s_' + k).value = SET[k] ?? '');
  $('#rateEdit').innerHTML = Object.keys(DEFAULT_RATES).map(k => `<label class="f">${esc(RATE_LABELS[k] || k)}<input type="number" step="any" data-rate="${k}" value="${RATES[k]}"></label>`).join('');
  $('#phList').innerHTML = PH_KEYS.map(k => `<code>{${k}}</code>`).join(' ');
  for (const t of ['new', 'add']) KV.get('tpl_' + t).then(x => { $('#tpl' + (t === 'new' ? 'New' : 'Add')).textContent = x ? `${x.name} (uploaded ${x.when})` : 'Built-in format'; });
  if (isAdmin()) $('#srvInfo').textContent = `${S.mRows.length} ROs and ${S.gList.length} portal applications on the server.`;
}
async function readWorkbook(file) { return XLSX.read(await file.arrayBuffer(), { type: 'array', cellNF: true, cellText: false }); }
async function importPortal(file) {
  busy(true, 'Reading portal file…'); await tick();
  try {
    const wb = await readWorkbook(file);
    const { headers, rows, ts } = gedaRowsFromAoa(sheetRows(wb.Sheets[wb.SheetNames[0]]));
    busy(false);
    if (!confirm(`Replace portal data on the server with ${rows.length} applications from "${file.name}"?`)) return;
    await DB.upsertChunks('geda', rows, 'app_key', 'Uploading portal data');
    busy(true, 'Removing old portal rows…');
    await DB.check(await S.sb.from('geda').delete().lt('imported_at', ts));
    await DB.saveSetting('geda_headers', headers);
    await DB.log('', 'portal_import', { file: file.name, rows: rows.length });
    $('#portalInfo').textContent = `${rows.length} applications imported ${new Date().toLocaleString('en-IN')}`;
    await reload(); toast('Portal data updated.', 'ok');
  } catch (e) { console.error(e); toast('Import failed: ' + esc(e.message), 'bad', 9000); }
  finally { busy(false); }
}
async function importMasterFile(file) {
  busy(true, 'Reading Master file…'); await tick();
  try {
    const wb = await readWorkbook(file);
    if (!wb.Sheets['Master']) throw new Error('No sheet named "Master" in this file.');
    const master = masterRowsFromAoa(sheetRows(wb.Sheets['Master']));
    const gd = wb.Sheets['GEDA FORMAT'] ? gedaRowsFromAoa(sheetRows(wb.Sheets['GEDA FORMAT'])) : null;
    const sdn = wb.Sheets['SDN Code'] ? sheetRows(wb.Sheets['SDN Code']).slice(1).filter(r => r[0] !== '' && r[1] !== '').map(r => ({ code: String(r[0]).trim(), name: clean(r[1]) })) : [];
    busy(false);
    if (!confirm(`Upload to server:\n• Master: ${master.length} ROs\n• GEDA FORMAT: ${gd ? gd.rows.length : 0} applications\n• SDN Code: ${sdn.length} sub-divisions\n\nROs already on the server with the same Application No. will be overwritten. Continue?`)) return;
    await DB.upsertChunks('master', master, 'app_no', 'Uploading Master');
    if (gd) { await DB.upsertChunks('geda', gd.rows, 'app_key', 'Uploading GEDA FORMAT'); await DB.saveSetting('geda_headers', gd.headers); }
    if (sdn.length) await DB.upsertChunks('sdn_code', sdn, 'code', 'Uploading SDN Code');
    await DB.log('', 'master_import', { file: file.name, master: master.length, geda: gd ? gd.rows.length : 0 });
    $('#masterInfo').textContent = `Imported ${master.length} ROs on ${new Date().toLocaleString('en-IN')}`;
    await reload(); toast('Master file imported.', 'ok', 6000);
  } catch (e) { console.error(e); toast('Import failed: ' + esc(e.message), 'bad', 10000); }
  finally { busy(false); }
}

/* ---------- wiring ---------- */
function init() {
  $('#btnLogin').onclick = () => isAdmin() ? doLogout() : openLogin();
  $('#btnRefresh').onclick = reload;
  $('#lgGo').onclick = doLogin; $('#lgCancel').onclick = () => $('#loginBox').style.display = 'none';
  $('#lgPass').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  $('#btnCfgSave').onclick = () => { const url = $('#cfgUrl').value.trim(), key = $('#cfgKey').value.trim(); if (!url || !key) return; localStorage.setItem('geda.server', JSON.stringify({ url, key })); location.reload(); };
  $('#tabs').onclick = e => { const b = e.target.closest('button'); if (b) showPage(b.dataset.p); };
  document.addEventListener('click', e => {
    const o = e.target.closest('[data-open]'); if (o && isAdmin()) { e.preventDefault(); openRO(o.dataset.open); return; }
    const d = e.target.closest('[data-div]'); if (d) { e.preventDefault(); App.go('pend', 0, d.dataset.div); return; }
    if (!e.target.closest('#roSugg') && e.target.id !== 'roSearch') $('#roSugg').style.display = 'none';
  });
  // RO
  $('#btnFetch').onclick = fetchApp;
  $('#roSearch').addEventListener('keydown', e => { if (e.key === 'Enter') fetchApp(); if (e.key === 'Escape') $('#roSugg').style.display = 'none'; });
  $('#roSearch').addEventListener('input', () => showSugg(searchApps($('#roSearch').value)));
  $('#roSugg').onclick = e => { const d = e.target.closest('[data-k]'); if (d) { $('#roSearch').value = d.dataset.k; fetchApp(); } };
  $('#btnClear').onclick = () => { CUR = null; $('#roForm').style.display = 'none'; $('#roSearch').value = ''; $('#roMsg').innerHTML = ''; $('#roSearch').focus(); };
  $('#roForm').addEventListener('input', e => {
    const id = e.target.id;
    if (id.startsWith('c_')) { CUR.over[id.slice(2)] = 'user'; updateCalc(); }
    if (['f_cl', 'f_pv', 'f_ex', 'f_cat', 'f_tariff'].includes(id)) { updateCalc(); panelCheck(); }
    if (['f_pwatt', 'f_pnos', 'f_icap'].includes(id)) panelCheck();
  });
  $('#roForm').addEventListener('change', e => {
    const id = e.target.id;
    if (id === 'f_rotype' || id === 'f_gen') updateCalc();
    if (id === 'f_bidirSel') bidirUI();
    if (id === 'f_rcptAll') { for (const c of CHG) if (numOr($('#c_' + c.k).value) > 0) $('#d_' + c.k).value = e.target.value; }
    if (id.startsWith('d_') && e.target.value) for (const c of CHG) if (!$('#d_' + c.k).value && numOr($('#c_' + c.k).value) > 0) $('#d_' + c.k).value = e.target.value;
  });
  $('#chgRows').addEventListener('click', e => { const k = e.target.dataset.use; if (k) { delete CUR.over[k]; updateCalc(); } });
  $('#btnSaveOnly').onclick = () => saveRO(false); $('#btnSaveWord').onclick = () => saveRO(true); $('#btnWordOnly').onclick = wordOnly;
  // pending
  $('#pDiv').onchange = () => { localStorage.setItem('geda.pDiv', $('#pDiv').value); buildSdnFilter(); renderPend(); };
  $('#pSdn').onchange = () => { localStorage.setItem('geda.pSdn', $('#pSdn').value); renderPend(); };
  $('#pAge').onchange = renderPend; $('#pQ').oninput = renderPend;
  $('#pendTable').addEventListener('change', e => { const tr = e.target.closest('tr[data-k]'); if (tr && e.target.dataset.f) pendEdit(tr.dataset.k, e.target.dataset.f, e.target.value); });
  $('#pendTable').addEventListener('input', e => { const tr = e.target.closest('tr[data-k]'); if (tr && e.target.dataset.f === 'reason') pendEdit(tr.dataset.k, 'reason', e.target.value); });
  $('#btnPendSave').onclick = savePend; $('#btnPendUndo').onclick = () => { PEND.edits.clear(); renderPend(); };
  $('#btnPendXls').onclick = pendencyExcel;
  // charges
  $('#p-chg').addEventListener('input', renderChargesPage); $('#p-chg').addEventListener('change', renderChargesPage);
  $('#btnCFill').onclick = chargesFill; $('#cApp').addEventListener('keydown', e => { if (e.key === 'Enter') chargesFill(); });
  // settings
  $('#btnSetSave').onclick = async () => { SETF.forEach(k => SET[k] = $('#s_' + k).value); try { await DB.saveSetting('letter', SET); toast('Settings saved.', 'ok'); } catch (e) { toast('Not saved: ' + esc(e.message), 'bad'); } };
  $('#btnRateSave').onclick = async () => { $$('[data-rate]').forEach(i => RATES[i.dataset.rate] = numOr(i.value)); try { await DB.saveSetting('rates', RATES); toast('Rates saved.', 'ok'); if (CUR) updateCalc(); } catch (e) { toast('Not saved: ' + esc(e.message), 'bad'); } };
  $('#btnRateReset').onclick = () => { RATES = { ...DEFAULT_RATES }; renderSettings(); toast('Default rates shown – click Save rates to keep them.'); };
  $$('input[data-tpl]').forEach(inp => inp.onchange = async e => { const f = e.target.files[0]; if (!f) return; await KV.set('tpl_' + inp.dataset.tpl, { name: f.name, when: new Date().toLocaleDateString('en-IN'), buf: await f.arrayBuffer() }); renderSettings(); toast('Template saved in this browser.', 'ok'); e.target.value = ''; });
  $$('[data-tplclear]').forEach(b => b.onclick = async () => { await KV.del('tpl_' + b.dataset.tplclear); renderSettings(); });
  $('#portalFile').onchange = e => { if (e.target.files[0]) importPortal(e.target.files[0]); e.target.value = ''; };
  $('#masterFile').onchange = e => { if (e.target.files[0]) importMasterFile(e.target.files[0]); e.target.value = ''; };
  $('#btnFullMaster').onclick = downloadFullMaster;
  window.addEventListener('beforeunload', e => { if (PEND.edits.size) { e.preventDefault(); e.returnValue = ''; } });
  boot();
}
window.App = {
  printCharges, S, DB, calcCharges, openRO,
  go(p, age, div) { showPage(p); if (p === 'pend') { if (div !== undefined) { $('#pDiv').value = div; buildSdnFilter(); } $('#pAge').value = age === 30 ? '30' : '0'; renderPend(); } }
};
document.addEventListener('DOMContentLoaded', init);
