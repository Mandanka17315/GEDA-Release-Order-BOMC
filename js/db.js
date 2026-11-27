/* =========================================================================
   Server layer (Supabase). Admin = logged-in user listed in "admins".
   Field offices = no login; they can only call pending_list / field_update.
   ========================================================================= */
const MCOL = {
  sr: 'Sr NO', app: 'Application No.', reg: 'GEDA Registeration No.', cons: 'Consumer No.', name: 'Name of Consumer',
  pv: 'PV Capacity', ex: 'Existing PV Capacity (kW)', cl: 'Sanctioned / Contract Load', cat: 'Category', div: 'Division/Zone',
  sdn: 'Sub-division', addr: 'Adress', taluka: 'Taluka', village: 'City/Village', cei: 'CEI Inspection Application ID',
  status: 'Application Status', agr: 'Agreement Date', pmake: 'Solar Make', pwatt: 'Capacity', pnos: 'No. Modules',
  ptot: 'Total Capacity of Modules', imake: 'Inv. Make', icap: 'inv. Cap', icheck: 'Inv Cap. Must be less than or equal to AC capacity of Registraton.', volt: 'Voltage',
  isr: 'Inv. Sr no.', meter: 'Meter Charge + SMC Box Charge', meterR: 'Receip No and date', test: 'Meter testing Charge + S/Tax on Testing charge',
  testR: 'Receip No and date2', conn: 'Connectivity Charges', connR: 'Connectivity Charges Payment Date', ss: 'Strengthening Charges',
  ssR: 'Strengthening Charges Receipt No & Date', agrYes: 'Connectivity Agreement', roNo: 'Release Order No.', roDate: 'Release Order Date',
  bidir: 'Bi-Directional meter installed', eurja: 'EURJA SR NO.', general: 'General', tariff: 'TARIFF', msme: 'APPLIED UNDER MSME',
  policy: 'Solar Policy', remark: 'Remarks For Pending'
};
const EXTRA_COL = { installer: 'Installer Name', roType: 'RO Type', genMeter: 'Generation Meter Charges', connType: 'Connection Type' };
const KEY2DB = { app: 'app_no', meterR: 'meter_r', testR: 'test_r', connR: 'conn_r', ssR: 'ss_r', agrYes: 'agr_yes', roNo: 'ro_no', roDate: 'ro_date', roType: 'ro_type', genMeter: 'gen_meter', connType: 'conn_type' };
const ALLKEYS = [...Object.keys(MCOL), ...Object.keys(EXTRA_COL)];
const dbCol = k => KEY2DB[k] || k;
const DATE_KEYS = new Set(['agr', 'roDate']);
// Master columns that come from the portal (GEDA FORMAT)
const GEDA_SRC = {
  reg: 'GEDA Registeration No.', cons: 'Consumer No.', pv: 'PV Capacity', ex: 'Existing PV Capacity (kW)',
  cl: 'Sanctioned / Contract Load', cat: 'Category', div: 'Division/Zone', sdn: 'Sub-division', addr: 'Street/ House No.',
  taluka: 'Taluka', village: 'City/Village', status: 'Application Status', tariff: 'Tariff', eurja: 'Quotation No', installer: 'Installer Name'
};
const gName = g => g && g.__name ? g.__name : clean([gv(g, 'First Name'), gv(g, 'Middle Name'), gv(g, 'Last Name')].filter(x => x !== '' && x != null).join(' '));
function gv(g, h) { if (!g) return ''; const v = g[norm(h)]; return v == null ? '' : v; }

const S = {
  sb: null, mode: 'field', email: '', ready: false, loaded: false,
  mRows: [], mByKey: new Map(), geda: new Map(), gList: [], sdn: new Map(), activity: []
};

const isoRe = /^\d{4}-\d{2}-\d{2}$/;
const isoOf = s => s == null ? null : isoD(s);
function toCell(k, v) {               // JS form value -> text stored in DB
  if (v === '' || v == null) return null;
  if (isD(v)) return isoD(v.d);
  if (DATE_KEYS.has(k)) { const s = parseDateLoose(v); return s ? isoD(s) : String(v); }
  if (typeof v === 'number') return String(+v.toFixed(6));
  return String(v);
}
function fromCell(k, v) {             // DB text -> JS value used by the screens
  if (v == null) return '';
  if ((DATE_KEYS.has(k) || k === 'bidir') && isoRe.test(v)) return { d: parseDateLoose(v) };
  return v;
}
function recFromDb(row) {
  const v = {};
  for (const k of ALLKEYS) v[k] = fromCell(k, row[dbCol(k)]);
  return { key: appKey(row.app_no), v, updatedBy: row.updated_by || '', updatedAt: row.updated_at || '', portal: row.__portal || null };
}
function setRows(recs) { S.mRows = recs; S.mByKey = new Map(recs.map(r => [r.key, r])); }

const DB = {
  configured() {
    const c = window.GEDA_CONFIG || {}; const ls = (() => { try { return JSON.parse(localStorage.getItem('geda.server') || 'null'); } catch (e) { return null; } })();
    const url = (c.SUPABASE_URL && !/YOUR-PROJECT/.test(c.SUPABASE_URL)) ? c.SUPABASE_URL : ls && ls.url;
    const key = (c.SUPABASE_ANON_KEY && !/YOUR-ANON-KEY/.test(c.SUPABASE_ANON_KEY)) ? c.SUPABASE_ANON_KEY : ls && ls.key;
    return url && key ? { url, key } : null;
  },
  init() {
    const cfg = this.configured(); if (!cfg) return false;
    S.sb = supabase.createClient(cfg.url, cfg.key, { auth: { persistSession: true, storageKey: 'geda-ro-auth' } });
    return true;
  },
  async check(res) { if (res.error) { const e = new Error(res.error.message || String(res.error)); e.details = res.error; throw e; } return res.data; },
  async pageAll(table, cols, order) {
    const out = []; const step = 1000;
    for (let from = 0; ; from += step) {
      let q = S.sb.from(table).select(cols).range(from, from + step - 1);
      for (const o of order) q = q.order(o, { ascending: true, nullsFirst: false });
      const data = await this.check(await q); out.push(...data);
      if (data.length < step) break;
    }
    return out;
  },
  async session() {
    const { data } = await S.sb.auth.getSession();
    const sess = data && data.session;
    if (!sess) return { admin: false };
    const ok = await S.sb.rpc('is_admin');
    return { admin: !ok.error && ok.data === true, email: sess.user && sess.user.email };
  },
  async login(email, password) { await this.check(await S.sb.auth.signInWithPassword({ email, password })); return this.session(); },
  async logout() { await S.sb.auth.signOut(); },

  async loadMaster() { const rows = await this.pageAll('master', '*', ['sr', 'app_no']); setRows(rows.map(recFromDb)); },
  async loadPending() {
    const rows = await this.check(await S.sb.rpc('pending_list'));
    setRows(rows.map(r => { const rec = recFromDb({ ...r, bidir: 'Pending' }); rec.portal = { status: r.portal_status || '', d: parseDateLoose(r.portal_meter_date) }; return rec; }));
  },
  async loadGedaLight() {
    const rows = await this.pageAll('geda', 'app_key,app_no,status,category,name,cons,div,sdn,pv,ex,cl,installer,meter_date,cei_date', ['app_key']);
    S.geda = new Map(); S.gList = [];
    for (const r of rows) { const g = gedaLight(r); S.geda.set(r.app_key, g); S.gList.push(g); }
  },
  async getGeda(key) {
    const rows = await this.check(await S.sb.from('geda').select('*').eq('app_key', key).limit(1));
    if (!rows.length) return null;
    const r = rows[0], g = gedaLight(r);
    for (const [h, v] of Object.entries(r.data || {})) g[norm(h)] = v;
    g.__full = true; S.geda.set(key, g); return g;
  },
  async loadSdn() { const rows = await this.check(await S.sb.from('sdn_code').select('code,name')); S.sdn = new Map(rows.map(r => [String(r.code).trim(), clean(r.name)])); },
  async loadSettings() {
    const rows = await this.check(await S.sb.from('settings').select('key,value'));
    for (const r of rows) { if (r.key === 'rates' && r.value) Object.assign(RATES, r.value); if (r.key === 'letter' && r.value) Object.assign(SET, r.value); }
  },
  async saveSetting(key, value) { await this.check(await S.sb.from('settings').upsert({ key, value })); },
  async loadActivity() { S.activity = await this.check(await S.sb.from('activity').select('*').order('at', { ascending: false }).limit(40)); },
  async log(app_no, action, detail) { await S.sb.from('activity').insert({ app_no, action, by_name: 'Admin – ' + S.email, detail }); },

  async insertMaster(v) {
    const row = { updated_by: 'Admin – ' + S.email };
    for (const k of ALLKEYS) if (k in v) row[dbCol(k)] = k === 'sr' ? (isNum(v.sr) ? +v.sr : null) : toCell(k, v[k]);
    const data = await this.check(await S.sb.from('master').insert(row).select('*'));
    return recFromDb(data[0]);
  },
  async updateMaster(app_no, vals) {
    const row = { updated_by: 'Admin – ' + S.email };
    for (const [k, v] of Object.entries(vals)) row[dbCol(k)] = k === 'sr' ? (isNum(v) ? +v : null) : toCell(k, v);
    const data = await this.check(await S.sb.from('master').update(row).eq('app_no', app_no).select('*'));
    if (!data.length) throw new Error('Row not found on server: ' + app_no);
    return recFromDb(data[0]);
  },
  async fieldUpdate(app_no, isoDate, reason, by) {
    await this.check(await S.sb.rpc('field_update', { p_app: app_no, p_meter_date: isoDate || null, p_reason: reason, p_by: by }));
  },
  async upsertChunks(table, rows, conflict, label) {
    for (let i = 0; i < rows.length; i += 400) {
      busy(true, `${label} ${Math.min(i + 400, rows.length)} / ${rows.length}…`);
      await this.check(await S.sb.from(table).upsert(rows.slice(i, i + 400), { onConflict: conflict }));
    }
  }
};
function gedaLight(r) {
  const g = { __app: r.app_no, __name: r.name || '', __full: false };
  const set = (h, v) => { g[norm(h)] = v ?? ''; };
  set('Application No.', r.app_no); set('Application Status', r.status); set('Category', r.category); set('Consumer No.', r.cons);
  set('Division/Zone', r.div); set('Sub-division', r.sdn); set('PV Capacity', r.pv); set('Existing PV Capacity (kW)', r.ex);
  set('Sanctioned / Contract Load', r.cl); set('Installer Name', r.installer); set('Date of Installation of Solar Meter', r.meter_date);
  set('CEI Inspection Approval Date', r.cei_date);
  return g;
}

/* ---------- reading the Excel files (one-time Master import, portal import) ---------- */
function sheetRows(ws) {
  if (!ws || !ws['!ref']) return [];
  const rg = XLSX.utils.decode_range(ws['!ref']); const out = [];
  for (let r = rg.s.r; r <= rg.e.r; r++) {
    const row = [];
    for (let c = 0; c <= rg.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (!cell || cell.t === 'z' || cell.t === 'e') { row.push(''); continue; }
      if (cell.t === 'n' && cell.z && XLSX.SSF.is_date(cell.z)) { row.push({ d: cell.v }); continue; }
      row.push(cell.v);
    }
    out.push(row);
  }
  return out;
}
const txt = v => v === '' || v == null ? null : isD(v) ? isoD(Math.floor(v.d)) : typeof v === 'number' ? String(+v.toFixed(6)) : String(v).trim() || null;

function gedaRowsFromAoa(rows) {
  const hi = rows.findIndex(r => r.some(c => norm(c) === norm('Application No.')));
  if (hi < 0) throw new Error('No "Application No." heading found.');
  const hdr = rows[hi].map(h => clean(h)); const hn = hdr.map(norm);
  const at = h => hn.indexOf(norm(h));
  const ai = at('Application No.'), out = new Map();
  const ts = new Date().toISOString();
  for (const r of rows.slice(hi + 1)) {
    const app = clean(r[ai]); if (!app) continue;
    const key = appKey(app); if (out.has(key)) continue;           // keep first, like Excel MATCH
    const data = {}; hdr.forEach((h, j) => { if (h && !(h in data)) { const t = txt(r[j]); if (t != null) data[h] = isD(r[j]) ? t : (typeof r[j] === 'number' ? r[j] : t); } });
    const g = h => { const j = at(h); return j < 0 ? null : txt(r[j]); };
    const md = parseDateLoose(r[at('Date of Installation of Solar Meter')]), cd = parseDateLoose(r[at('CEI Inspection Approval Date')]);
    out.set(key, {
      app_key: key, app_no: app, status: g('Application Status'), category: g('Category'),
      name: clean([g('First Name'), g('Middle Name'), g('Last Name')].filter(Boolean).join(' ')) || null,
      cons: g('Consumer No.'), div: g('Division/Zone'), sdn: g('Sub-division'), pv: g('PV Capacity'), ex: g('Existing PV Capacity (kW)'),
      cl: g('Sanctioned / Contract Load'), installer: g('Installer Name'), meter_date: md ? isoD(md) : null, cei_date: cd ? isoD(cd) : null,
      data, imported_at: ts
    });
  }
  return { headers: hdr.filter(Boolean), rows: [...out.values()], ts };
}
function masterRowsFromAoa(rows) {
  const hdr = rows[0].map(h => clean(h)), hn = hdr.map(norm), col = {};
  for (const [k, h] of Object.entries({ ...MCOL, ...EXTRA_COL })) {
    const n = norm(h); let i = k === 'icheck' ? hn.findIndex(x => x.startsWith('invcapmust')) : hn.indexOf(n);
    if (i < 0 && k === 'meter') i = hn.findIndex(x => x.startsWith('metercharge'));
    if (i >= 0) col[k] = i;
  }
  if (col.app == null || col.bidir == null) throw new Error('This does not look like the Master sheet (Application No. / Bi-Directional meter installed columns missing).');
  const out = new Map();
  for (const r of rows.slice(1)) {
    const app = clean(r[col.app]); if (!app) continue;
    const row = { app_no: app };
    for (const [k, i] of Object.entries(col)) {
      if (k === 'app') continue; let v = r[i];
      if (k === 'sr') { row.sr = isNum(v) ? Math.round(+v) : null; continue; }
      if (DATE_KEYS.has(k) || k === 'bidir') { const s = isD(v) ? Math.floor(v.d) : (DATE_KEYS.has(k) ? parseDateLoose(v) : null); if (s) { row[dbCol(k)] = isoD(s); continue; } }
      row[dbCol(k)] = txt(v);
    }
    if (!row.updated_by) row.updated_by = 'Imported from Excel';
    out.set(appKey(app), row);
  }
  return [...out.values()];
}

/* ---------- full Master file download ---------- */
// text -> number only for plain numbers; "52,30" (two values) stays text
const xnum = v => { if (typeof v !== 'string' || !/^-?\d+(\.\d+)?$/.test(v.trim()) || v.trim().length > 15 || /^0\d/.test(v.trim())) return v ?? ''; const n = Number(v.trim()); return isFinite(n) ? n : v; };
// HT connection for the Master file split: entered in HT Connection, or (older imported rows) Category "HT…" / Application No. "…/RT/HT…"
const isHTRow = v => isHT(v) || /^HT/i.test(clean(v.cat)) || /\/RT\/HT/i.test(String(v.app ?? '').replace(/\s+/g, ''));
function masterSheet(recs, keys, heads, theme = 'lt') {
  const H = [...keys.map(k => (heads && heads[k]) || MCOL[k] || EXTRA_COL[k]), 'Last Updated', 'Updated By'];
  const aoa = [H], dateCells = [];
  recs.forEach((r, i) => {
    const row = keys.map((k, c) => {
      const v = r.v[k];
      if (isD(v)) { dateCells.push([i + 1, c]); return v.d; }
      if (k === 'app' || /R$/.test(k) || k === 'cei' || k === 'isr' || k === 'eurja' || k === 'icap' || k === 'imake') return v ?? '';
      return xnum(v);
    });
    row.push(r.updatedAt ? new Date(r.updatedAt).toLocaleString('en-IN') : '', r.updatedBy || '');
    aoa.push(row);
  });
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  for (const [r, c] of dateCells) { const a = XLSX.utils.encode_cell({ r, c }); if (ws[a]) { ws[a].t = 'n'; ws[a].z = 'dd-mm-yyyy'; } }
  ws['!cols'] = H.map((h, i) => ({ wch: i === 4 ? 34 : Math.min(Math.max(String(h).length, 10), 26) }));
  const money = new Set(['meter', 'test', 'conn', 'ss', 'genMeter'].map(k => keys.indexOf(k)).filter(i => i >= 0));
  return styleSheet(ws, theme, { freezeX: 2, money, wrapCols: [keys.indexOf('name'), keys.indexOf('addr')].filter(i => i >= 0) });
}
async function downloadFullMaster() {
  busy(true, 'Collecting data from server…'); await tick();
  try {
    await DB.loadMaster();
    const ht = S.mRows.filter(r => isHTRow(r.v)), lt = S.mRows.filter(r => !isHTRow(r.v));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, masterSheet(lt, ALLKEYS), 'LT Connections');
    XLSX.utils.book_append_sheet(wb, masterSheet(ht, ALLKEYS, null, 'ht'), 'HT Connections');
    busy(true, 'Writing Excel…'); await tick();
    await saveXlsx(wb, `Master File for GEDA Applications ${fmtD(todaySerial())}.xlsx`);
    toast(`Master downloaded: ${lt.length} LT and ${ht.length} HT connections.`, 'ok');
    refreshAll();
  } catch (e) { toast('Download failed: ' + esc(e.message), 'bad', 8000); }
  finally { busy(false); }
}

/* ---------- HT Solar Master download (HT connections only) ---------- */
// LT-only columns (meter/SMC, testing, RO No., generation meter) are left out; RO date is the entry date for HT.
const HT_SKIP = new Set(['meter', 'meterR', 'test', 'testR', 'roNo', 'genMeter', 'connType', 'agrYes']);
const HT_HEAD = { roDate: 'Entry Date', bidir: 'Connection Released', icap: 'Inverter Capacity (kW)', imake: 'Inverter Make', isr: 'Inverter Sr. No.' };
async function downloadHTMaster() {
  busy(true, 'Collecting HT connections from server…'); await tick();
  try {
    await DB.loadMaster();
    const rows = S.mRows.filter(r => isHTRow(r.v));
    if (!rows.length) { toast('No HT connections on the server yet.', 'bad'); return; }
    const used = k => rows.some(r => { const x = clean(showVal(r.v[k])); return x && !/^[-0]*$/.test(x); });
    const keys = ALLKEYS.filter(k => !HT_SKIP.has(k) || (k !== 'connType' && used(k)));
    const iAt = keys.indexOf('isr') + 1;
    const H = keys.map(k => HT_HEAD[k] || MCOL[k] || EXTRA_COL[k]);
    H.splice(iAt, 0, 'No. of Inverters', 'Total Inverter Capacity (kW)');
    H.push('Status', 'Days Pending', 'Last Updated', 'Updated By');
    const today = todaySerial(), aoa = [H], dateCells = [];
    rows.sort((a, b) => (numOr(a.v.sr) - numOr(b.v.sr)) || a.key.localeCompare(b.key)).forEach((r, i) => {
      const row = keys.map((k, c) => {
        const v = r.v[k];
        if (isD(v)) { dateCells.push([i + 1, c >= iAt ? c + 2 : c]); return v.d; }
        if (k === 'app' || /R$/.test(k) || k === 'cei' || k === 'isr' || k === 'eurja' || k === 'icap' || k === 'imake') return v ?? '';
        return xnum(v);
      });
      row.splice(iAt, 0, invCount(showVal(r.v.icap)) || '', sumCap(showVal(r.v.icap)) || '');
      const st = bidirState(r.v), rs = roSerial(r.v);
      row.push(st === 'released' ? 'Released' : st === 'pending' ? 'Pending' : clean(showVal(r.v.bidir)), st === 'pending' && rs ? today - rs : '',
        r.updatedAt ? new Date(r.updatedAt).toLocaleString('en-IN') : '', r.updatedBy || '');
      aoa.push(row);
    });
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    for (const [r, c] of dateCells) { const a = XLSX.utils.encode_cell({ r, c }); if (ws[a]) { ws[a].t = 'n'; ws[a].z = 'dd-mm-yyyy'; } }
    ws['!cols'] = H.map((h, i) => ({ wch: i === 4 ? 34 : Math.min(Math.max(String(h).length, 10), 26) }));
    const money = new Set(H.map((h, i) => /Charge/i.test(h) && !/Receip|Date/i.test(h) ? i : -1).filter(i => i >= 0));
    styleSheet(ws, 'ht', { freezeX: 2, money, wrapCols: [H.indexOf('Name of Consumer'), H.indexOf('Adress')].filter(i => i >= 0) });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'HT Master');
    XLSX.utils.book_append_sheet(wb, pendencySheet(rows.filter(r => bidirState(r.v) === 'pending'), 'ht'), 'HT Pendency');
    busy(true, 'Writing Excel…'); await tick();
    await saveXlsx(wb, `HT Solar Master File ${fmtD(todaySerial())}.xlsx`);
    toast(`HT Solar Master downloaded: ${rows.length} HT connection${rows.length === 1 ? '' : 's'}.`, 'ok');
    refreshAll();
  } catch (e) { console.error(e); toast('Download failed: ' + esc(e.message), 'bad', 8000); }
  finally { busy(false); }
}
