'use strict';
/* =========================================================================
   GEDA RO Tool – single-file offline app
   Reads/writes "Master File for GEDA Applications.xlsx" directly (Chrome/Edge)
   ========================================================================= */
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const xesc = s => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const norm = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const appKey = s => String(s ?? '').toUpperCase().replace(/\s+/g, '');
const numOr = (v, d = 0) => { const n = parseFloat(String(v ?? '').replace(/,/g, '')); return isFinite(n) ? n : d; };
const isNum = v => v !== '' && v !== null && v !== undefined && isFinite(Number(String(v).replace(/,/g, '')));
const fix2 = v => isNum(v) ? Number(v).toFixed(2) : String(v ?? '');
const inr = v => isNum(v) ? Number(v).toLocaleString('en-IN') : String(v ?? '');
const clean = v => String(v ?? '').replace(/\s+/g, ' ').trim();

/* ---------------- dates: Excel serial helpers ---------------- */
const EPOCH = Date.UTC(1899, 11, 30);
const isD = v => v && typeof v === 'object' && 'd' in v;
const serialOf = (y, m, d) => Math.round((Date.UTC(y, m - 1, d) - EPOCH) / 864e5);
const ymdOf = s => { const t = new Date(EPOCH + Math.round(s) * 864e5); return [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()]; };
const p2 = n => String(n).padStart(2, '0');
const fmtD = s => { if (s === '' || s == null) return ''; const [y, m, d] = ymdOf(s); return `${p2(d)}.${p2(m)}.${y}`; };
const isoD = s => { if (s === '' || s == null) return ''; const [y, m, d] = ymdOf(s); return `${y}-${p2(m)}-${p2(d)}`; };
const todaySerial = () => { const t = new Date(); return serialOf(t.getFullYear(), t.getMonth() + 1, t.getDate()); };
function parseDateLoose(v) { // returns serial or null
  if (v == null || v === '') return null;
  if (isD(v)) return v.d;
  if (typeof v === 'number') return v > 20000 && v < 80000 ? Math.floor(v) : null;
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return serialOf(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})/); if (m) { let y = +m[3]; if (y < 100) y += 2000; return serialOf(y, +m[2], +m[1]); }
  return null;
}
const showVal = v => isD(v) ? fmtD(v.d) : (v ?? '');

/* ---------------- small IndexedDB key-value store ---------------- */
const KV = {
  db: null,
  open() { return this.db || (this.db = new Promise((res, rej) => { const r = indexedDB.open('geda-ro-tool', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); })); },
  async get(k) { try { const db = await this.open(); return await new Promise((res, rej) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); } catch (e) { return undefined; } },
  async set(k, v) { try { const db = await this.open(); await new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = res; t.onerror = () => rej(t.error); }); } catch (e) { console.warn(e); } },
  async del(k) { try { const db = await this.open(); await new Promise(res => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').delete(k); t.oncomplete = res; }); } catch (e) { } }
};

/* ---------------- settings & rates ---------------- */
const DEFAULT_RATES = {
  meter1: 1045, meter2: 1931, meter3: 2340,        // bi-directional meter  (≤6 / ≤40 / >40 kW, on max of CL & PV)
  smc1: 282, smc2: 698, smc3: 1121,                // SMC box
  test1: 1500, test2: 2000, test3: 3000,           // meter testing
  conn1: 1500, conn2: 10000, conn3: 50000,         // connectivity (≤6 / ≤100 / >100 kW of PV)
  ssNew12: 12000, ssNew20: 21000,                  // strengthening, new: 0 up to 6, ≤12, >12
  ssAdd2: 3500, ssAdd6: 6500, ssAdd12: 12000, ssAdd20: 21000, // full slab table used for additions
  ssPerKw: 1100,                                   // per kW above 20 kW
  gen1: 1285, gen2: 3498, gen3: 4521,              // generation meter (≤6 / ≤40 / >40 kW total)
  gst: 18
};
const RATE_LABELS = {
  meter1: 'Bi-dir meter ≤6 kW', meter2: 'Bi-dir meter 6–40 kW', meter3: 'Bi-dir meter >40 kW',
  smc1: 'SMC ≤6 kW', smc2: 'SMC 6–40 kW', smc3: 'SMC >40 kW',
  test1: 'Testing ≤6 kW', test2: 'Testing 6–40 kW', test3: 'Testing >40 kW',
  conn1: 'Connectivity ≤6 kW', conn2: 'Connectivity 6–100 kW', conn3: 'Connectivity >100 kW',
  ssNew12: 'Strengthening new 6–12 kW', ssNew20: 'Strengthening new >12 kW',
  ssAdd2: 'Strengthening slab ≤2 kW', ssAdd6: 'Strengthening slab 2–6 kW', ssAdd12: 'Strengthening slab 6–12 kW', ssAdd20: 'Strengthening slab >12 kW',
  ssPerKw: 'Strengthening per kW above 20', gen1: 'Generation meter ≤6 kW', gen2: 'Generation meter 6–40 kW', gen3: 'Generation meter >40 kW', gst: 'GST / liability %'
};
const DEFAULT_SETTINGS = {
  seName: 'B A GOHIL', seDesig: 'Superintending Engineer', circle: 'Baroda O&M Circle', roPrefix: '',
  policy: 'Renewable Energy Policy 2025', settlement: 'As per provisional agreement', fontSize: 11, font: 'Arial'
};
let SET = { ...DEFAULT_SETTINGS }, RATES = { ...DEFAULT_RATES };
try { Object.assign(SET, JSON.parse(localStorage.getItem('geda.settings') || '{}')); } catch (e) { }
try { Object.assign(RATES, JSON.parse(localStorage.getItem('geda.rates') || '{}')); } catch (e) { }

/* ---------------- charges logic (Rooftop Charges › Estimate Sheet) ---------------- */
const slab3 = (x, a, b, c, lim1, lim2) => x < lim1 + 0.1 ? a : (x < lim2 + 0.1 ? b : c);
function meterSlab(x) { return slab3(x, RATES.meter1, RATES.meter2, RATES.meter3, 6, 40); }
function smcSlab(x) { return slab3(x, RATES.smc1, RATES.smc2, RATES.smc3, 6, 40); }
function testSlab(x) { return slab3(x, RATES.test1, RATES.test2, RATES.test3, 6, 40); }
function connSlab(x) { return x <= 0 ? 0 : slab3(x, RATES.conn1, RATES.conn2, RATES.conn3, 6, 100); }
function ssNew(t) { return (t < 6.1 ? 0 : (t < 12.1 ? RATES.ssNew12 : RATES.ssNew20)) + (t > 20 ? (t - 20) * RATES.ssPerKw : 0); }
function ssFull(t) { return (t < 2.1 ? RATES.ssAdd2 : t < 6.1 ? RATES.ssAdd6 : t < 12.1 ? RATES.ssAdd12 : RATES.ssAdd20) + (t > 20 ? (t - 20) * RATES.ssPerKw : 0); }
function genSlab(t) { return t <= 0 ? 0 : (t <= 6 ? RATES.gen1 : (t <= 40 ? RATES.gen2 : RATES.gen3)); }
const gstOf = v => Math.round(v * RATES.gst / 100);

/** type: 'new' | 'add'; cl = contract load; pv = applied (or additional) PV; ex = existing PV; gen = include generation meter */
function calcCharges({ type, cl, pv, ex, gen }) {
  cl = numOr(cl); pv = numOr(pv); ex = numOr(ex);
  const r = { type, cl, pv, ex, total: type === 'add' ? pv + ex : pv, notes: [] };
  if (type !== 'add') {
    const m = Math.max(cl, pv);
    r.meter = cl === 0 ? 0 : meterSlab(m);
    r.smc = cl === 0 ? 0 : smcSlab(pv);
    r.test = cl === 0 ? 0 : testSlab(m);
    r.conn = pv === 0 ? 0 : connSlab(pv);
    r.ss = Math.round(ssNew(pv));
    r.gen = 0;
    r.notes.push(`Meter & testing slab on max(contract load, PV) = ${m} kW; SMC slab on PV ${pv} kW.`);
    if (pv < 6.1) r.notes.push('Strengthening charges nil up to 6 kW.');
  } else {
    const t = pv + ex, mo = Math.max(cl, ex), mn = Math.max(cl, t);
    const ch = (o, n) => o === n ? 0 : Math.max(o, n);
    r.meter = cl === 0 ? 0 : ch(meterSlab(mo), meterSlab(mn));
    r.smc = cl === 0 ? 0 : ch(smcSlab(mo), smcSlab(mn));
    r.test = cl === 0 ? 0 : ch(testSlab(mo), testSlab(mn));
    r.conn = ch(connSlab(ex), connSlab(t));
    r.ss = t < 6 ? 0 : Math.round(ssFull(t) - ssFull(ex));
    r.gen = gen ? genSlab(t) : 0;
    r.notes.push(`Total PV after addition ${+t.toFixed(3)} kW. Meter, SMC, testing and connectivity are charged only when the slab changes.`);
    r.notes.push(`Strengthening = slab for ${+t.toFixed(3)} kW (Rs. ${inr(Math.round(ssFull(t)))}) − slab for existing ${ex} kW (Rs. ${inr(Math.round(ssFull(ex)))}).`);
  }
  r.meterGst = gstOf(r.meter); r.smcGst = gstOf(r.smc); r.testGst = gstOf(r.test);
  r.liability = r.meterGst + r.smcGst + r.testGst;
  r.meterSmc = r.meter + r.smc + r.gen;                 // Master col "Meter Charge + SMC Box Charge"
  r.grand = r.meterSmc + r.test + r.liability + r.conn + r.ss;
  return r;
}

/* ---------------- UI helpers ---------------- */
function toast(msg, cls = '', ms = 4200) { const d = document.createElement('div'); d.className = cls; d.innerHTML = msg; $('#toast').appendChild(d); setTimeout(() => d.remove(), ms); }
function busy(on, txt) { $('#busy').classList.toggle('on', !!on); if (txt) $('#busyTxt').textContent = txt; }
const tick = () => new Promise(r => setTimeout(r, 30));
function download(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000); }
const safeName = s => String(s).replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 90);
