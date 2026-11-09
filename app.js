'use strict';
/* PACE Mobile - reads the snapshot that PACE uploads at Day End (via Google Apps Script). Read-only. */
const APP_VER = '10.0.0';     // change with every upload to GitHub - phones compare it with the online copy
const $ = (s, el = document) => el.querySelector(s);
const E = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const inr = (x, d = 2) => (Number(x) || 0).toLocaleString('en-IN', {minimumFractionDigits: d, maximumFractionDigits: d});
const r0 = x => '&#8377; ' + inr(x, 0);
const dmy = iso => iso ? iso.slice(8, 10) + '-' + iso.slice(5, 7) + '-' + iso.slice(0, 4) : '';
const qf = x => { x = Number(x) || 0; return Number.isInteger(x) ? String(x) : x.toFixed(2); };
const M = $('#m');
let D = null;

/* ---------------- storage (IndexedDB - snapshot can be a few MB) ---------------- */
const idb = () => new Promise((res, rej) => { const r = indexedDB.open('pace', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
async function kvGet(k) { const db = await idb(); return new Promise(res => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(null); }); }
async function kvSet(k, v) { const db = await idb(); return new Promise(res => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = res; t.onerror = res; }); }
const cfg = () => { try { return JSON.parse(localStorage.getItem('pace_cfg') || '{}'); } catch (e) { return {}; } };
const setCfg = c => { try { localStorage.setItem('pace_cfg', JSON.stringify(c)); } catch (e) {} };

async function refresh(manual) {
  const c = cfg();
  if (!c.url) { location.hash = '#setup'; return; }
  $('#rf').textContent = '...';
  try {
    const r = await fetch(c.url + (c.url.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(c.key || ''), {cache: 'no-store'});
    const j = await r.json();
    if (j.ok === false) throw new Error(j.error);
    if (!j.meta) throw new Error('Unexpected data');
    D = j; await kvSet('snap', j);
    if (manual) flash('Updated - data up to ' + j.meta.generated);
  } catch (e) {
    if (manual || !D) flash((D ? 'Could not refresh (showing saved data): ' : 'Could not load data: ') + e.message, true);
  }
  $('#rf').textContent = 'Refresh';
  route();
}
/* ---------------- update check: the phone may keep an old copy of the app in its cache ---------------- */
const verNum = v => String(v || '0').split('.').map(Number).reduce((a, x) => a * 1000 + (x || 0), 0);
let NEW_VER = null;
async function checkUpdate(manual) {
  try {
    const t = await (await fetch('app.js?t=' + Date.now(), {cache: 'no-store'})).text();
    const m = t.match(/APP_VER = '([\d.]+)'/);
    NEW_VER = m && verNum(m[1]) > verNum(APP_VER) ? m[1] : null;
    if (manual) flash(NEW_VER ? 'Version ' + NEW_VER + ' is available' : 'You have the latest version (' + APP_VER + ')');
  } catch (e) { if (manual) flash('Could not check for update (no internet?)', true); }
  showUpdate();
}
function showUpdate() {
  let b = $('#upd');
  if (!NEW_VER) { if (b) b.remove(); return; }
  if (!b) { b = document.createElement('div'); b.id = 'upd'; document.body.insertBefore(b, M); }
  b.innerHTML = `New version ${E(NEW_VER)} of PACE Mobile is available <button id="updb">Upgrade now</button>`;
  $('#updb').onclick = upgrade;
}
async function upgrade() {
  try {
    if (window.caches) for (const k of await caches.keys()) await caches.delete(k);
    if (navigator.serviceWorker) for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
  } catch (e) {}
  location.replace(location.pathname + '?v=' + Date.now() + location.hash);
}

function flash(msg, err) {
  const d = document.createElement('div'); d.className = err ? 'err' : 'card'; d.textContent = msg;
  d.style.cssText += ';position:fixed;left:12px;right:12px;bottom:84px;z-index:9;box-shadow:0 4px 16px rgba(0,0,0,.15)';
  document.body.appendChild(d); setTimeout(() => d.remove(), 3500);
}

/* ---------------- helpers on snapshot ---------------- */
const accName = id => (D.meta.accounts.find(a => String(a.id) === String(id)) || {name: 'UPI'}).name;
const dayRow = d => D.daily.find(x => x.date === d);
const sum = (a, f) => a.reduce((s, x) => s + (Number(f(x)) || 0), 0);
function ledgerRows(o, sign) {   // sign 1 = customer (debit - credit), -1 = supplier (credit - debit)
  const net = sum(o.led, l => sign * (l[3] - l[4]));
  let bal = o.balance - net;
  const rows = [{d: '', t: 'B/F', ref: 'Balance brought forward', dr: 0, cr: 0, bal}];
  for (const l of o.led) { bal += sign * (l[3] - l[4]); rows.push({d: l[0], t: l[1], ref: l[2], dr: l[3], cr: l[4], bal}); }
  return rows;
}

/* ---------------- views ---------------- */
const V = {};
V.setup = () => {
  const c = cfg();
  M.innerHTML = `<h2>Connect to your shop</h2><div class="card">
    <p style="margin-top:0">Enter the <b>Sync URL</b> and <b>Secret key</b> from PACE &gt; Settings &gt; Advance Settings &gt; Mobile App Sync.</p>
    <label>Sync URL<input id="su" placeholder="https://script.google.com/macros/s/.../exec" value="${E(c.url || '')}"></label><br><br>
    <label>Secret key<input id="sk" value="${E(c.key || '')}" autocomplete="off"></label>
    <button class="btn o" id="sv">Save &amp; Load Data</button>
    ${D ? '<button class="btn l" id="cl">Remove data from this phone</button>' : ''}</div>
    <div class="foot">Data stays in your own Google Drive. This app only reads it.</div>`;
  $('#sv').onclick = () => { setCfg({url: $('#su').value.trim(), key: $('#sk').value.trim()}); location.hash = '#home'; refresh(true); };
  if ($('#cl')) $('#cl').onclick = async () => { await kvSet('snap', null); D = null; setCfg({}); location.hash = '#setup'; route(); };
};

V.home = () => {
  const m = D.meta, t = dayRow(m.date) || {}, mon = m.date.slice(0, 7);
  const monRows = D.daily.filter(x => x.date.startsWith(mon));
  const recv = sum(D.customers.filter(c => c.balance > 0), c => c.balance);
  const pay = sum(D.suppliers.filter(s => s.balance > 0), s => s.balance);
  const book = D.books[m.date] || [];
  const stockVal = sum(D.stock, s => s[4] > 0 ? s[4] * s[6] : 0);
  const days = [...Array(14)].map((_, i) => addDays(m.date, i - 13));
  const mx = Math.max(1, ...days.map(d => (dayRow(d) || {}).net || 0));
  const low = D.stock.filter(s => s[4] <= s[8]).length;
  const exp = D.stock.filter(s => s[7] && s[7] <= addDays(m.date, 30)).length;
  M.innerHTML = `<div class="kpis">
    <div class="kpi"><div class="l">Sales on ${dmy(m.date)}</div><div class="v">${r0(t.net)}</div><div class="x">${t.bills || 0} bills &middot; ${qf(t.qty || 0)} pcs</div></div>
    <div class="kpi"><div class="l">This month</div><div class="v">${r0(sum(monRows, x => x.net))}</div><div class="x">${sum(monRows, x => x.bills)} bills</div></div>
    <div class="kpi"><div class="l">Receivable</div><div class="v red">${r0(recv)}</div><div class="x">${D.customers.filter(c => c.balance > 0.009).length} customers</div></div>
    <div class="kpi"><div class="l">Payable</div><div class="v">${r0(pay)}</div><div class="x">${D.suppliers.filter(s => s.balance > 0.009).length} suppliers</div></div></div>
    ${D.meta.version && verNum(D.meta.version) < verNum('10.0.0') ? '<div class="err" style="margin-top:10px">The shop PC runs an older PACE. Some screens show less.</div>' : ''}
    <h2>Cash &amp; UPI balance</h2><div class="card">${book.length ? book.map(b => `<div class="row"><span class="n">${E(b.account)}</span><span class="r"><b>${r0(b.closing)}</b></span></div>`).join('') +
      `<div class="row"><span class="n">Total</span><span class="r big" style="font-size:18px">${r0(sum(book, b => b.closing))}</span></div>` : '<div class="empty">No data</div>'}</div>
    <h2>Sales - last 14 days</h2><div class="card"><div class="bars">${days.map(d => { const v = (dayRow(d) || {}).net || 0;
      return `<div onclick="location.hash='#day/${d}'"><span>${v ? inr(v / 1000, 1) + 'k' : ''}</span><b style="height:${v / mx * 70}%"></b>${d.slice(8)}</div>`; }).join('')}</div></div>
    <h2>Stock</h2><div class="card"><div class="row"><span>Value at cost</span><span class="r"><b>${r0(stockVal)}</b></span></div>
      <div class="row" onclick="location.hash='#stock/low'"><span>Low stock items</span><span class="r ${low ? 'amber' : ''}"><b>${low}</b> &rsaquo;</span></div>
      <div class="row" onclick="location.hash='#stock/exp'"><span>Expired / expiring in 30 days</span><span class="r ${exp ? 'red' : ''}"><b>${exp}</b> &rsaquo;</span></div></div>
    <div class="foot">Data up to ${E(m.generated)} &middot; ${E(m.store || '')}<br>PACE by Weave Solutions</div>`;
};
const isoL = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return isoL(d); };

V.day = arg => {
  const d = arg || D.meta.date, t = dayRow(d) || {}, book = D.books[d];
  const exps = D.expenses.filter(x => x[0] === d), bills = D.invoices.filter(x => x[1] === d);
  const cl = D.closings.find(x => x.date === d);
  M.innerHTML = `<div class="sticky"><input type="date" id="dd" value="${d}" min="${D.meta.fy_start}" max="${D.meta.date}"></div>
    <div class="card"><div class="m" style="color:var(--mut)">Net sales</div><div class="big">${r0(t.net)}</div>
      <div class="row"><span>Bills / pieces</span><span class="r">${t.bills || 0} / ${qf(t.qty || 0)}</span></div>
      <div class="row"><span>Discount</span><span class="r">${r0(t.disc)}</span></div>
      ${Object.entries(t.pay || {}).map(([a, v]) => `<div class="row"><span>${E(accName(a))}</span><span class="r">${r0(v)}</span></div>`).join('')}
      <div class="row"><span>Given on credit</span><span class="r red">${r0(t.credit)}</span></div>
      <div class="row"><span>Received from debtors</span><span class="r green">${r0(D.rcpt_day[d])}</span></div>
      <div class="row"><span>Expenses</span><span class="r">${r0(D.exp_day[d])}</span></div></div>
    ${book ? `<h2>Cash &amp; UPI book</h2><div class="card"><table><tr><th>Account</th><th class="r">Opening</th><th class="r">In</th><th class="r">Out</th><th class="r">Closing</th></tr>
      ${book.map(b => `<tr><td>${E(b.account)}</td><td class="r">${inr(b.opening, 0)}</td><td class="r">${inr(b.inn, 0)}</td><td class="r">${inr(b.out, 0)}</td><td class="r"><b>${inr(b.closing, 0)}</b></td></tr>`).join('')}</table>
      ${cl ? `<div class="m" style="margin-top:8px;color:var(--mut)">Day closed at ${E(cl.time || '')}${Object.values(cl.diffs || {}).some(x => x) ? ' &middot; <span class="red">difference found</span>' : ' &middot; tallied'}</div>` : ''}</div>` : ''}
    ${exps.length ? `<h2>Expenses</h2><div class="card">${exps.map(x => `<div class="row"><div><div class="n">${E(x[1])}</div><div class="m">${E(x[4])} &middot; ${E(x[3])}</div></div><span class="r">${r0(x[2])}</span></div>`).join('')}</div>` : ''}
    <h2>Bills (${bills.length})</h2><div class="card">${bills.length ? bills.map(billRow).join('') : `<div class="empty">${D.meta.bills_from && d < D.meta.bills_from ? 'Bill list is kept on the phone for the last 60 days only' : 'No bills'}</div>`}</div>`;
  $('#dd').onchange = e => { location.hash = '#day/' + e.target.value; };
};
const billRow = b => `<div class="row"><div><div class="n">${E(b[3])}${b[9] !== 'ACTIVE' ? '<span class="tag red">CANCELLED</span>' : ''}${b[10] ? '<span class="tag">GST</span>' : ''}</div>
  <div class="m">${E(b[0])} &middot; ${dmy(b[1])} ${E(b[2] || '')}${b[8] ? ' &middot; ' + E(b[8]) : ''} &middot; ${E(b[7])}</div></div>
  <div class="r"><b>${r0(b[4])}</b>${b[6] > 0.009 ? `<div class="m red">due ${inr(b[6], 0)}</div>` : ''}</div></div>`;

function partyList(kind, arg) {
  const list = kind === 'cust' ? D.customers : D.suppliers, q = (arg || '').toLowerCase();
  if (arg && /^\d+$/.test(arg) && list.find(x => String(x.id) === arg)) return partyDetail(kind, list.find(x => String(x.id) === arg));
  const filt = sessionStorage.getItem(kind + '_f') || 'due';
  let rows = list.filter(x => filt === 'all' || Math.abs(x.balance) > 0.009);
  rows.sort((a, b) => b.balance - a.balance);
  M.innerHTML = `<div class="sticky"><input id="q" placeholder="Search name, mobile or city" value="${E(sessionStorage.getItem(kind + '_q') || '')}">
    <div class="chips"><span class="chip ${filt === 'due' ? 'on' : ''}" data-f="due">With balance</span><span class="chip ${filt === 'all' ? 'on' : ''}" data-f="all">All</span></div></div>
    <div class="card" id="pl"></div>`;
  const draw = () => {
    const s = $('#q').value.toLowerCase(); sessionStorage.setItem(kind + '_q', $('#q').value);
    const r = rows.filter(x => !s || (x.name + ' ' + x.mobile + ' ' + x.city).toLowerCase().includes(s));
    $('#pl').innerHTML = (r.length ? r.slice(0, 300).map(x => `<div class="row" onclick="location.hash='#${kind}/${x.id}'"><div><div class="n">${E(x.name)}</div>
      <div class="m">${E(x.mobile || '')}${x.city ? ' &middot; ' + E(x.city) : ''}</div></div><span class="r ${x.balance > 0.009 ? 'red' : x.balance < -0.009 ? 'green' : ''}"><b>${r0(x.balance)}</b></span></div>`).join('')
      : '<div class="empty">Nothing found</div>') + `<div class="row"><span class="n">Total (${r.length})</span><span class="r"><b>${r0(sum(r, x => x.balance))}</b></span></div>`;
  };
  $('#q').oninput = draw;
  M.querySelectorAll('.chip').forEach(c => c.onclick = () => { sessionStorage.setItem(kind + '_f', c.dataset.f); partyList(kind); });
  draw();
}
function partyDetail(kind, x) {
  const rows = ledgerRows(x, kind === 'cust' ? 1 : -1);
  const msg = encodeURIComponent(`Dear ${x.name}, your outstanding balance with ${D.meta.store} is Rs. ${inr(x.balance)} as on ${dmy(D.meta.date)}. Kindly arrange payment. Thank you.`);
  const mob = (x.mobile || '').replace(/\D/g, '');
  M.innerHTML = `<div class="card"><div class="n" style="font-size:17px">${E(x.name)}</div><div class="m" style="color:var(--mut)">${E(x.mobile || '')}${x.city ? ' &middot; ' + E(x.city) : ''}</div>
    <div class="big ${x.balance > 0.009 ? 'red' : ''}" style="margin-top:6px">${r0(x.balance)}</div>
    <div class="m" style="color:var(--mut)">${kind === 'cust' ? 'Receivable' : 'Payable'}${x.limit ? ' &middot; credit limit ' + r0(x.limit) : ''}</div>
    ${mob.length === 10 ? `<div style="margin-top:10px"><a class="act" href="tel:${mob}">Call</a>${kind === 'cust' && x.balance > 0.009 ? `<a class="act" href="https://wa.me/91${mob}?text=${msg}">WhatsApp reminder</a>` : ''}</div>` : ''}</div>
    <h2>Ledger (${D.meta.led_from ? 'from ' + dmy(D.meta.led_from) : 'this financial year'})</h2><div class="card"><table><tr><th>Date</th><th>Ref</th><th class="r">${kind === 'cust' ? 'Debit' : 'Paid'}</th><th class="r">${kind === 'cust' ? 'Credit' : 'Bill'}</th><th class="r">Balance</th></tr>
    ${rows.map(r => `<tr><td>${dmy(r.d)}</td><td>${E(r.ref || r.t)}<div class="m" style="color:var(--mut);font-size:11px">${E(r.t)}</div></td>
      <td class="r">${r.dr ? inr(r.dr, 0) : ''}</td><td class="r">${r.cr ? inr(r.cr, 0) : ''}</td><td class="r"><b>${inr(r.bal, 0)}</b></td></tr>`).join('')}</table></div>
    <button class="btn l" onclick="history.back()">Back</button>`;
}
V.cust = arg => partyList('cust', arg);
V.sup = arg => partyList('sup', arg);

V.stock = arg => {
  const f = arg || sessionStorage.getItem('st_f') || 'all', lim = addDays(D.meta.date, 30);
  M.innerHTML = `<div class="sticky"><input id="q" placeholder="Search name, barcode, category" value="${E(sessionStorage.getItem('st_q') || '')}">
    <div class="chips">${[['all', 'All'], ['low', 'Low stock'], ['exp', 'Expiring'], ['zero', 'Out of stock']].map(([k, v]) => `<span class="chip ${f === k ? 'on' : ''}" data-f="${k}">${v}</span>`).join('')}</div></div>
    <div class="card" id="sl"></div>`;
  const draw = () => {
    const s = $('#q').value.toLowerCase(); sessionStorage.setItem('st_q', $('#q').value);
    let r = D.stock.filter(x => !s || (x[0] + ' ' + x[1] + ' ' + x[2] + ' ' + x[3]).toLowerCase().includes(s));
    if (f === 'low') r = r.filter(x => x[4] <= x[8]);
    if (f === 'zero') r = r.filter(x => x[4] <= 0);
    if (f === 'exp') r = r.filter(x => x[7] && x[7] <= lim).sort((a, b) => a[7].localeCompare(b[7]));
    $('#sl').innerHTML = r.length ? r.slice(0, 400).map(x => `<div class="row"><div><div class="n">${E(x[1])}</div><div class="m">${E(x[0].toUpperCase())} &middot; ${E(x[2])}${x[3] ? ' &middot; ' + E(x[3]) : ''}
      ${x[7] ? `<span class="tag ${x[7] < D.meta.date ? 'red' : x[7] <= lim ? 'amber' : ''}">exp ${dmy(x[7])}</span>` : ''}</div></div>
      <div class="r"><b class="${x[4] <= 0 ? 'red' : x[4] <= x[8] ? 'amber' : ''}">${qf(x[4])} pcs</b><div class="m">${r0(x[5])}</div></div></div>`).join('') + (r.length > 400 ? '<div class="empty">Showing first 400 - search to narrow</div>' : '')
      : '<div class="empty">Nothing found</div>';
  };
  $('#q').oninput = draw;
  M.querySelectorAll('.chip').forEach(c => c.onclick = () => { sessionStorage.setItem('st_f', c.dataset.f); location.hash = '#stock/' + c.dataset.f; });
  draw();
};

V.bills = () => {
  M.innerHTML = `<div class="sticky"><input id="q" placeholder="Search bill no, customer, staff"></div><div class="card" id="bl"></div>`;
  const draw = () => { const s = $('#q').value.toLowerCase();
    const r = D.invoices.filter(b => !s || (b[0] + ' ' + b[3] + ' ' + b[8]).toLowerCase().includes(s)).slice(-300).reverse();
    $('#bl').innerHTML = r.length ? r.map(billRow).join('') : '<div class="empty">No bills</div>'; };
  $('#q').oninput = draw; draw();
};

V.exp = arg => {
  const mon = arg || D.meta.date.slice(0, 7), list = D.expenses.filter(x => x[0].startsWith(mon));
  const em = D.exp_month || {};
  const months = [...new Set(D.expenses.map(x => x[0].slice(0, 7)).concat(Object.keys(em), [D.meta.date.slice(0, 7)]))].sort().reverse();
  let cats = {}; list.forEach(x => cats[x[1]] = (cats[x[1]] || 0) + x[2]);
  if (em[mon]) cats = {...em[mon]};       // full month totals (entries are kept only for the last 90 days)
  M.innerHTML = `<div class="sticky"><select id="mm">${months.map(m => `<option ${m === mon ? 'selected' : ''} value="${m}">${new Date(m + '-01T00:00:00').toLocaleDateString('en-IN', {month: 'long', year: 'numeric'})}</option>`).join('')}</select></div>
    <div class="card"><div class="m" style="color:var(--mut)">Total expenses</div><div class="big">${r0(sum(Object.values(cats), x => x))}</div>
    ${Object.entries(cats).sort((a, b) => b[1] - a[1]).map(([c, v]) => `<div class="row"><span>${E(c)}</span><span class="r">${r0(v)}</span></div>`).join('')}</div>
    <h2>Entries</h2><div class="card">${D.meta.exp_from && mon + '-31' < D.meta.exp_from ? '<div class="empty">Entries are kept on the phone for the last 90 days only</div>' : list.length ? list.slice().reverse().map(x => `<div class="row"><div><div class="n">${E(x[1])}</div><div class="m">${dmy(x[0])} &middot; ${E(x[3])}${x[4] ? ' &middot; ' + E(x[4]) : ''}</div></div><span class="r">${r0(x[2])}</span></div>`).join('') : '<div class="empty">No expenses</div>'}</div>`;
  $('#mm').onchange = e => { location.hash = '#exp/' + e.target.value; };
};

V.staff = () => {
  M.innerHTML = `<h2>Staff sales &amp; commission - this month</h2><div class="card">${D.staff.length ? D.staff.map(s => `<div class="row"><div><div class="n">${E(s.staff || '(not selected)')}</div>
    <div class="m">${s.bills} bills &middot; ${qf(s.qty)} pcs</div></div><div class="r"><b>${r0(s.sales)}</b><div class="m green">comm. ${inr(s.commission)}</div></div></div>`).join('') : '<div class="empty">No sales</div>'}</div>`;
};

V.more = () => {
  M.innerHTML = `<h2>More</h2><div class="card">
    ${[['#sup', 'Suppliers & payables'], ['#bills', 'Bills (last 60 days)'], ['#exp', 'Expenses'], ['#staff', 'Staff commission'], ['#setup', 'Connection settings']]
      .map(([h, t]) => `<div class="row" onclick="location.hash='${h}'"><span class="n">${t}</span><span>&rsaquo;</span></div>`).join('')}
      <div class="row" id="chk"><span class="n">Check for app update</span><span class="m">v${APP_VER}</span></div>
      <div class="row" id="rel"><span class="n">Reload latest version</span><span>&#8635;</span></div></div>
    <div class="foot"><a href="https://weavesolution.com" class="wv"><img src="https://weavesolution.com/assets/logo.png" alt="Weave Solutions" onerror="this.remove()"></a><br>
      Data up to ${E(D.meta.generated)}<br>PACE Mobile ${APP_VER} &middot; shop PC: PACE ${E(D.meta.version)}<br><a href="https://weavesolution.com" style="color:var(--org2)">Software by Weave Solutions</a></div>`;
  $('#chk').onclick = () => checkUpdate(true);
  $('#rel').onclick = upgrade;
};

function route() {
  const [r, arg] = (location.hash.slice(1) || 'home').split('/');
  if (!D && r !== 'setup') { if (!cfg().url) { location.hash = '#setup'; return; } M.innerHTML = '<div class="empty">Loading...</div>'; return; }
  $('#hs').textContent = D ? (D.meta.store || 'PACE Mobile') : 'PACE Mobile';
  $('#hd').textContent = D ? 'Data up to ' + D.meta.generated : 'Not connected';
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('on', a.dataset.r === r || (a.dataset.r === 'more' && ['sup', 'bills', 'exp', 'staff', 'setup'].includes(r))));
  (V[r] || V.home)(arg ? decodeURIComponent(arg) : undefined);
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);
$('#rf').onclick = () => refresh(true);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
(async () => { try { D = await kvGet('snap'); } catch (e) { D = null; } route(); if (cfg().url) refresh(false); checkUpdate(false); })();
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkUpdate(false); });
