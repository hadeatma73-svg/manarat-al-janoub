// @ts-nocheck
// Report builders for the shop e-mails. Plain JavaScript syntax so the same file runs in Deno (edge function) and Node (tests).
export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const fmt = (n) => (Math.round((+n || 0) * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 });
const tot = (s) => (s.it || []).reduce((a, i) => a + (+i.q || 0) * (+i.p || 0), 0);
const paid = (s) => (s.pays || []).reduce((a, p) => a + (+p.a || 0), 0);
export const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
export const WD = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
export const dow = (d) => new Date(d + 'T00:00:00Z').getUTCDay();
export const PMN = { cash: 'نقدي', card: 'بطاقة', credit: 'دين' };

export function localNow(tz, now = new Date()) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(now).map((x) => [x.type, x.value]));
  const date = `${p.year}-${p.month}-${p.day}`;
  return { date, hour: +p.hour, minute: +p.minute, dow: dow(date) };
}

export function custDebt(D, cid) {
  return (D.sales || []).reduce((a, s) => a + (s.cid == cid && s.st != 'void' ? Math.max(0, tot(s) - paid(s)) : 0), 0) + ((D.cust || []).find((c) => c.id == cid)?.ob || 0);
}

export function receivables(D) {
  const list = [];
  let total = 0, anon = 0;
  for (const c of D.cust || []) {
    const d = custDebt(D, c.id);
    if (d > 0.001) {
      const old = (D.sales || []).filter((s) => s.cid == c.id && s.st != 'void' && tot(s) - paid(s) > 0.001).map((s) => s.d).sort()[0] || '';
      list.push({ n: c.n, ph: c.ph, d, old });
      total += d;
    }
  }
  for (const s of D.sales || []) if (s.st != 'void' && !s.cid && tot(s) - paid(s) > 0.001) { anon += tot(s) - paid(s); total += tot(s) - paid(s); }
  list.sort((a, b) => b.d - a.d);
  return { list, total, anon };
}

export function summarize(D, from, to) {
  const inR = (d) => d >= from && d <= to;
  const o = { n: 0, rev: 0, cost: 0, exp: 0, comm: 0, col: 0, byM: { cash: 0, card: 0 }, debtColl: 0, creditNew: 0, sales: [], voids: [], items: {}, emp: {}, cat: {}, days: {}, expList: [], puList: [], puTot: 0, advList: [], advTot: 0, absent: [], below: {}, zeroCost: false };
  for (let d = from; d <= to; d = addDays(d, 1)) o.days[d] = { n: 0, rev: 0, cost: 0, exp: 0 };
  for (const s of D.sales || []) {
    if (s.st == 'void') { if (inR(s.d)) o.voids.push(s); continue; }
    for (const p of s.pays || []) if (inR(p.d)) {
      o.col += +p.a || 0; o.byM[p.m] = (o.byM[p.m] || 0) + (+p.a || 0);
      if (s.d < from || p.d > s.d) o.debtColl += +p.a || 0;
    }
    if (!inR(s.d)) continue;
    const X = tot(s);
    o.n++; o.rev += X; o.sales.push(s);
    let cst = 0;
    for (const i of s.it || []) {
      const c = (+i.q || 0) * (+i.c || 0); cst += c;
      const x = (o.items[i.n] = o.items[i.n] || { q: 0, v: 0, g: 0 });
      x.q += +i.q || 0; x.v += (+i.q || 0) * (+i.p || 0); x.g += (+i.q || 0) * ((+i.p || 0) - (+i.c || 0));
      if ((+i.p || 0) < (+i.c || 0)) o.below[i.n] = 1;
      if (!(+i.c > 0) && i.t !== 'o') o.zeroCost = true;
    }
    o.cost += cst;
    const e = (o.emp[s.e || '—'] = o.emp[s.e || '—'] || { n: 0, v: 0, comm: 0 });
    e.n++; e.v += X;
    const em = (D.emp || []).find((x) => x.n == s.e);
    if (em && em.p) { const c = (X * em.p) / 100; e.comm += c; o.comm += c; }
    const dd = o.days[s.d]; dd.n++; dd.rev += X; dd.cost += cst;
    o.creditNew += Math.max(0, X - (s.pays || []).filter((p) => p.d == s.d).reduce((a, p) => a + (+p.a || 0), 0));
  }
  for (const p of D.dp || []) if (inR(p.d)) { o.col += +p.a || 0; o.byM[p.m] = (o.byM[p.m] || 0) + (+p.a || 0); o.debtColl += +p.a || 0; }
  for (const x of D.exp || []) if (inR(x.d)) { o.exp += +x.a || 0; o.cat[x.c] = (o.cat[x.c] || 0) + (+x.a || 0); o.expList.push(x); if (o.days[x.d]) o.days[x.d].exp += +x.a || 0; }
  for (const x of D.pu || []) if (inR(x.d)) { o.puTot += +x.a || 0; o.puList.push(x); }
  for (const x of D.adv || []) if (inR(x.d)) { o.advTot += +x.a || 0; o.advList.push(x); }
  for (const a of D.att || []) if (inR(a.d) && a.s == 'a') o.absent.push(a);
  o.gp = o.rev - o.cost; o.net = o.gp - o.exp; o.netAfter = o.net - o.comm;
  return o;
}

function stockAlerts(D) {
  const a = [];
  for (const p of D.prd || []) {
    if (p.s < 0) a.push(['bad', `مخزون سالب: ${esc(p.n)} (${p.s}) — راجع الكميات`]);
    else if (p.s <= 0) a.push(['bad', `نفد المخزون: ${esc(p.n)}`]);
    else if (p.s <= (+p.m || 0)) a.push(['warn', `مخزون منخفض: ${esc(p.n)} (المتبقي ${p.s}، حد التنبيه ${p.m})`]);
  }
  return a;
}

export function alertsFor(D, sm, ctx, kind) {
  const a = [];
  const label = kind == 'weekly' ? 'الأسبوع' : 'اليوم';
  if (sm.net < 0) a.push(['bad', `خسارة ${label}: ${fmt(-sm.net)} ${ctx.cur}`]);
  else if (sm.rev > 0 && sm.netAfter < 0) a.push(['warn', `الربح لا يغطي عمولات الموظفين (الصافي بعد العمولات ${fmt(sm.netAfter)} ${ctx.cur})`]);
  if (sm.exp > sm.rev && sm.exp > 0) a.push(['warn', `المصروفات (${fmt(sm.exp)}) أعلى من المبيعات (${fmt(sm.rev)})`]);
  if (sm.n == 0) a.push(['warn', `لا توجد أي مبيعات ${label}`]);
  for (const n of Object.keys(sm.below)) a.push(['bad', `بيع بسعر أقل من التكلفة: ${esc(n)}`]);
  if (sm.voids.length) a.push(['warn', `فواتير ملغاة ${label}: ${sm.voids.length} (قيمتها ${fmt(sm.voids.reduce((x, s) => x + tot(s), 0))} ${ctx.cur})`]);
  a.push(...stockAlerts(D));
  const rc = receivables(D);
  for (const c of rc.list) if (c.old && c.old < addDays(ctx.date, -30)) a.push(['warn', `دين متأخر أكثر من 30 يوماً: ${esc(c.n)} — ${fmt(c.d)} ${ctx.cur}`]);
  if (sm.zeroCost) a.push(['info', 'بعض البنود المباعة تكلفتها صفر، لذلك الربح المعروض أعلى من الحقيقي.']);
  if (kind != 'weekly' && sm.n > 0) {
    const prev = summarize(D, addDays(ctx.date, -7), addDays(ctx.date, -1));
    const avg = prev.rev / 7;
    if (avg > 0 && sm.rev < avg * 0.5) a.push(['warn', `مبيعات ${label} (${fmt(sm.rev)}) أقل من نصف متوسط آخر 7 أيام (${fmt(avg)})`]);
  }
  if (kind != 'weekly' && sm.n == 0) {
    const prev = summarize(D, addDays(ctx.date, -7), addDays(ctx.date, -1));
    if (prev.rev > 0) a.push(['bad', 'لم تُسجَّل مبيعات اليوم رغم أن المحل يبيع عادةً — تأكد أن التطبيق متزامن وأن العمليات تُسجَّل.']);
  }
  if (ctx.syncAt) {
    const hrs = (ctx.nowMs - ctx.syncAt) / 36e5;
    if (hrs > 18) a.push(['warn', `آخر مزامنة للبيانات كانت قبل ${Math.round(hrs)} ساعة، وقد تكون بعض العمليات لم تصل بعد.`]);
  }
  const seen = new Set();
  return a.filter((x) => (seen.has(x[1]) ? false : seen.add(x[1])));
}

/* ---------- html helpers (inline styles for e-mail clients) ---------- */
const C = { ok: '#16a34a', bad: '#dc2626', warn: '#b45309', ink: '#0b2239', mut: '#5b6b80', line: '#dbe6f0', bg: '#f3f8fb' };
const wrap = (inner) => `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;color:${C.ink};max-width:700px;margin:auto;background:#fff">${inner}</div>`;
const head = (title, sub) => `<div style="background:#0a4f6e;color:#fff;padding:16px 18px;border-radius:12px 12px 0 0"><div style="font-size:20px;font-weight:700">${esc(title)}</div><div style="opacity:.85;font-size:13px;margin-top:4px">${esc(sub)}</div></div>`;
const sec = (t, inner) => `<div style="margin:16px 0 6px;font-weight:700;font-size:16px;border-bottom:2px solid ${C.line};padding-bottom:4px">${t}</div>${inner}`;
const tbl = (hs, rows, foot) => `<table style="width:100%;border-collapse:collapse;font-size:13px"><tr>${hs.map((h) => `<th style="background:${C.bg};text-align:right;padding:6px 8px;border:1px solid ${C.line}">${h}</th>`).join('')}</tr>${rows.map((r) => `<tr>${r.map((c) => `<td style="padding:6px 8px;border:1px solid ${C.line};vertical-align:top">${c}</td>`).join('')}</tr>`).join('')}${foot ? `<tr>${foot.map((c) => `<td style="padding:6px 8px;border:1px solid ${C.line};background:${C.bg};font-weight:700">${c}</td>`).join('')}</tr>` : ''}</table>`;
const kv = (rows) => `<table style="width:100%;border-collapse:collapse;font-size:14px">${rows.map(([k, v, c, b]) => `<tr><td style="padding:7px 8px;border-bottom:1px solid ${C.line}">${k}</td><td style="padding:7px 8px;border-bottom:1px solid ${C.line};text-align:left;font-weight:${b ? 800 : 600};color:${c || C.ink}">${v}</td></tr>`).join('')}</table>`;
const alertBox = (al) => al.length ? al.map(([l, t]) => `<div style="margin:5px 0;padding:8px 10px;border-radius:8px;background:${l == 'bad' ? '#fee2e2' : l == 'warn' ? '#fef3c7' : '#e0f2fe'};color:${l == 'bad' ? '#991b1b' : l == 'warn' ? '#92400e' : '#075985'};font-size:13px">${l == 'bad' ? '🔴' : l == 'warn' ? '🟠' : 'ℹ️'} ${t}</div>`).join('') : `<div style="padding:8px 10px;border-radius:8px;background:#dcfce7;color:#166534;font-size:13px">✅ لا توجد تنبيهات، كل شيء سليم.</div>`;
const verdict = (label, net, cur) => `<div style="margin:14px 0;padding:14px;border-radius:12px;text-align:center;background:${net < 0 ? '#fee2e2' : '#dcfce7'};color:${net < 0 ? '#991b1b' : '#166534'}"><div style="font-size:14px">${label}</div><div style="font-size:28px;font-weight:800">${net < 0 ? 'خسارة ' : 'ربح '}${fmt(Math.abs(net))} ${esc(cur)}</div></div>`;
const payTxt = (s) => {
  const by = {};
  for (const p of s.pays || []) by[p.m] = (by[p.m] || 0) + (+p.a || 0);
  const parts = Object.entries(by).map(([m, a]) => `${PMN[m] || m} ${fmt(a)}`);
  const rem = tot(s) - paid(s);
  if (rem > 0.001) parts.push(`<b style="color:${C.bad}">دين ${fmt(rem)}</b>`);
  return parts.join(' + ') || '—';
};
const footer = (ctx) => `<div style="margin-top:18px;font-size:11px;color:${C.mut};text-align:center">تقرير تلقائي من نظام ${esc(ctx.shop)} — الأرقام مبنية على البيانات المتزامنة وقت الإرسال${ctx.syncAt ? ' (آخر مزامنة: ' + new Date(ctx.syncAt).toISOString().replace('T', ' ').slice(0, 16) + ' UTC)' : ''}.</div>`;

function itemsTable(sm, cur) {
  const rows = Object.entries(sm.items).sort((a, b) => b[1].v - a[1].v);
  if (!rows.length) return `<div style="color:${C.mut}">لا توجد مبيعات.</div>`;
  const q = rows.reduce((a, r) => a + r[1].q, 0), v = rows.reduce((a, r) => a + r[1].v, 0), g = rows.reduce((a, r) => a + r[1].g, 0);
  return tbl(['الصنف', 'الكمية', `المبيعات (${esc(cur)})`, 'الربح'], rows.map(([n, x]) => [esc(n), x.q, fmt(x.v), `<span style="color:${x.g < 0 ? C.bad : C.ok}">${fmt(x.g)}</span>`]), ['المجموع', q, fmt(v), fmt(g)]);
}

function debtBlock(D, sm, ctx) {
  const rc = receivables(D);
  return kv([
    ['ديون جديدة (بيع آجل)', fmt(sm.creditNew) + ' ' + esc(ctx.cur)],
    ['ديون تم تحصيلها', fmt(sm.debtColl) + ' ' + esc(ctx.cur), C.ok],
    ['إجمالي الديون المتبقية على العملاء', fmt(rc.total) + ' ' + esc(ctx.cur), rc.total > 0 ? C.bad : C.ink, true],
  ]) + (rc.list.length ? '<div style="margin-top:8px">' + tbl(['العميل', 'الجوال', 'الدين', 'أقدم دين'], rc.list.slice(0, 8).map((c) => [esc(c.n), esc(c.ph || '—'), `<b style="color:${C.bad}">${fmt(c.d)}</b>`, c.old || '—'])) + '</div>' : '');
}

export function dailyReport(D, date, ctx0) {
  const ctx = { shop: D.shop || 'منارة الجنوب', cur: D.cur || '', nowMs: Date.now(), ...ctx0, date };
  const sm = summarize(D, date, date);
  const al = alertsFor(D, sm, ctx, 'daily');
  const stock = (D.prd || []).reduce((a, p) => a + Math.max(0, p.s) * (+p.c || 0), 0);
  const inv = sm.sales.slice().sort((a, b) => a.id - b.id).map((s) => [`#${s.id}`, esc(s.cn || 'بدون اسم') + (s.cp ? `<br><span style="color:${C.mut}">${esc(s.cp)}</span>` : ''), (s.it || []).map((i) => `${esc(i.n)} × ${i.q} = ${fmt(i.q * i.p)}`).join('<br>'), esc(s.e || '—'), `<b>${fmt(tot(s))}</b>`, payTxt(s)]);
  const html = wrap(
    head(`جرد يوم ${date} (${WD[dow(date)]})`, ctx.shop) +
    '<div style="padding:0 14px 14px;border:1px solid ' + C.line + ';border-top:0;border-radius:0 0 12px 12px">' +
    verdict('صافي نتيجة اليوم (بعد المصروفات)', sm.net, ctx.cur) +
    sec('🔔 التنبيهات', alertBox(al)) +
    sec('📊 ملخص اليوم', kv([
      ['عدد الفواتير', sm.n], ['إجمالي المبيعات', fmt(sm.rev) + ' ' + esc(ctx.cur), C.ink, true], ['تكلفة البضاعة المباعة', fmt(sm.cost)], ['مجمل الربح', fmt(sm.gp), sm.gp < 0 ? C.bad : C.ok],
      ['المصروفات', fmt(sm.exp)], [sm.net < 0 ? 'الخسارة' : 'صافي الربح', fmt(sm.net), sm.net < 0 ? C.bad : C.ok, true],
      ['عمولات الموظفين المستحقة', fmt(sm.comm)], ['الصافي بعد العمولات', fmt(sm.netAfter), sm.netAfter < 0 ? C.bad : C.ok],
      ['المحصّل الكامل اليوم', fmt(sm.col) + ' ' + esc(ctx.cur), C.ink, true], ['— نقدي', fmt(sm.byM.cash || 0)], ['— بطاقة', fmt(sm.byM.card || 0)], ['— تسديد ديون قديمة', fmt(sm.debtColl)],
    ])) +
    sec('🛒 كل ما انباع اليوم (مجمّع حسب الصنف)', itemsTable(sm, ctx.cur)) +
    sec('🧾 الفواتير بالتفصيل', inv.length ? tbl(['#', 'العميل', 'البنود', 'الموظف', 'الإجمالي', 'الدفع'], inv) : `<div style="color:${C.mut}">لا توجد فواتير اليوم.</div>`) +
    sec('💰 الديون والتحصيل', debtBlock(D, sm, ctx)) +
    sec('💸 مصروفات اليوم', sm.expList.length ? tbl(['الفئة', 'الوصف', 'المبلغ', 'الدفع'], sm.expList.map((x) => [esc(x.c), esc(x.t || '—'), fmt(x.a), esc(PMN[x.m] || x.m || '—')]), ['المجموع', '', fmt(sm.exp), '']) : `<div style="color:${C.mut}">لا مصروفات.</div>`) +
    (sm.puList.length ? sec('🚚 مشتريات اليوم من الموردين', tbl(['المورّد', 'المنتج', 'الكمية', 'الإجمالي'], sm.puList.map((x) => [esc(x.sup || '—'), esc(x.n), x.q, fmt(x.a)]), ['المجموع', '', '', fmt(sm.puTot)])) : '') +
    (sm.advList.length ? sec('🤝 سلف الموظفين اليوم', tbl(['الموظف', 'المبلغ', 'ملاحظة'], sm.advList.map((x) => [esc((D.emp || []).find((e) => e.id == x.eid)?.n || '—'), fmt(x.a), esc(x.t || '—')]))) : '') +
    (sm.absent.length ? sec('📅 الغياب', sm.absent.map((a) => esc((D.emp || []).find((e) => e.id == a.eid)?.n || '—')).join('، ')) : '') +
    (sm.voids.length ? sec('⛔ فواتير ملغاة اليوم', tbl(['#', 'العميل', 'القيمة'], sm.voids.map((s) => [`#${s.id}`, esc(s.cn || '—'), fmt(tot(s))]))) : '') +
    sec('📦 حالة المخزون', `<div style="font-size:13px">قيمة المخزون بسعر التكلفة: <b>${fmt(stock)} ${esc(ctx.cur)}</b>${stockAlerts(D).length ? '' : ' — لا نقص'}</div>`) +
    footer(ctx) + '</div>'
  );
  const subject = `${sm.net < 0 ? '⚠️ خسارة' : '✅'} جرد يوم ${date}: مبيعات ${fmt(sm.rev)} ${ctx.cur} | ${sm.net < 0 ? 'خسارة' : 'ربح'} ${fmt(Math.abs(sm.net))}${al.some((x) => x[0] == 'bad') ? ' | تنبيهات' : ''}`;
  return { subject, html };
}

export function weeklyReport(D, date, ctx0) {
  const ctx = { shop: D.shop || 'منارة الجنوب', cur: D.cur || '', nowMs: Date.now(), ...ctx0, date };
  const from = addDays(date, -6);
  const sm = summarize(D, from, date), pv = summarize(D, addDays(date, -13), addDays(date, -7));
  const al = alertsFor(D, sm, ctx, 'weekly');
  const rc = receivables(D);
  const pc = (a, b) => (b ? `${a >= b ? '▲' : '▼'} ${Math.abs(Math.round(((a - b) / Math.abs(b)) * 100))}%` : '—');
  const days = Object.entries(sm.days).map(([d, x]) => [`${d} <span style="color:${C.mut}">${WD[dow(d)]}</span>`, x.n, fmt(x.rev), fmt(x.exp), `<span style="color:${x.rev - x.cost - x.exp < 0 ? C.bad : C.ok}">${fmt(x.rev - x.cost - x.exp)}</span>`]);
  const emps = Object.entries(sm.emp).sort((a, b) => b[1].v - a[1].v).map(([n, x]) => [esc(n), x.n, fmt(x.v), fmt(x.comm)]);
  const cats = Object.entries(sm.cat).sort((a, b) => b[1] - a[1]).map(([n, v]) => [esc(n), fmt(v)]);
  const html = wrap(
    head(`جرد الأسبوع ${from} → ${date}`, ctx.shop) +
    '<div style="padding:0 14px 14px;border:1px solid ' + C.line + ';border-top:0;border-radius:0 0 12px 12px">' +
    verdict('نتيجة الأسبوع (صافي بعد المصروفات)', sm.net, ctx.cur) +
    sec('🔔 التنبيهات', alertBox(al)) +
    sec('📊 ملخص الأسبوع', kv([
      ['إجمالي المبيعات', fmt(sm.rev) + ' ' + esc(ctx.cur), C.ink, true], ['عدد الفواتير', sm.n], ['تكلفة البضاعة المباعة', fmt(sm.cost)], ['مجمل الربح', fmt(sm.gp), sm.gp < 0 ? C.bad : C.ok],
      ['المصروفات', fmt(sm.exp)], [sm.net < 0 ? 'الخسارة' : 'صافي الربح', fmt(sm.net), sm.net < 0 ? C.bad : C.ok, true],
      ['عمولات الموظفين', fmt(sm.comm)], ['الصافي بعد العمولات', fmt(sm.netAfter), sm.netAfter < 0 ? C.bad : C.ok],
      ['المحصّل الكامل (نقدي + بطاقة + ديون)', fmt(sm.col) + ' ' + esc(ctx.cur), C.ink, true], ['— نقدي', fmt(sm.byM.cash || 0)], ['— بطاقة', fmt(sm.byM.card || 0)],
      ['مشتريات من الموردين', fmt(sm.puTot)], ['سلف الموظفين', fmt(sm.advTot)],
    ])) +
    sec('📈 مقارنة بالأسبوع السابق', kv([['المبيعات', `${fmt(pv.rev)} ← ${fmt(sm.rev)} (${pc(sm.rev, pv.rev)})`], ['صافي الربح', `${fmt(pv.net)} ← ${fmt(sm.net)} (${pc(sm.net, pv.net)})`], ['المصروفات', `${fmt(pv.exp)} ← ${fmt(sm.exp)} (${pc(sm.exp, pv.exp)})`]])) +
    sec('📅 يوماً بيوم', tbl(['اليوم', 'فواتير', 'المبيعات', 'المصروفات', 'الصافي'], days)) +
    sec('🛒 الأصناف المباعة خلال الأسبوع', itemsTable(sm, ctx.cur)) +
    (emps.length ? sec('👷 أداء الموظفين', tbl(['الموظف', 'فواتير', 'المبيعات', 'العمولة'], emps)) : '') +
    (cats.length ? sec('💸 المصروفات حسب الفئة', tbl(['الفئة', 'المبلغ'], cats, ['المجموع', fmt(sm.exp)])) : '') +
    sec('💰 الديون', debtBlock(D, sm, ctx)) +
    footer(ctx) + '</div>'
  );
  const subject = `${sm.net < 0 ? '⚠️ خسارة' : '✅'} جرد الأسبوع ${from} → ${date}: مبيعات ${fmt(sm.rev)} ${ctx.cur} | ${sm.net < 0 ? 'خسارة' : 'ربح'} ${fmt(Math.abs(sm.net))}`;
  return { subject, html };
}

export function saleDigest(payloads, D, ctx0) {
  const ctx = { shop: D.shop || 'منارة الجنوب', cur: D.cur || '', nowMs: Date.now(), ...ctx0 };
  const sales = payloads.flatMap((p) => p.sales || []);
  const shown = sales.slice(0, 20);
  const total = sales.reduce((a, s) => a + tot(s), 0);
  const today = ctx.date || localNow(ctx.tz || 'Asia/Amman').date;
  const dsum = summarize(D, today, today);
  const sold = new Set(sales.flatMap((s) => (s.it || []).map((i) => i.n)));
  const low = (D.prd || []).filter((p) => sold.has(p.n) && p.s <= (+p.m || 0)).map((p) => ['warn', `${p.s <= 0 ? 'نفد' : 'اقترب من النفاد'}: ${esc(p.n)} (المتبقي ${p.s})`]);
  const cards = shown.map((s) => `<div style="border:1px solid ${C.line};border-radius:10px;padding:10px 12px;margin:8px 0"><div><b>فاتورة #${s.id}</b> — ${esc(s.d)}${s.e ? ' — الموظف: ' + esc(s.e) : ''}</div><div style="margin:6px 0;font-size:14px">${(s.it || []).map((i) => `${esc(i.n)} × ${i.q} — ${fmt(i.p)} ${esc(ctx.cur)}`).join('<br>')}</div><div><b>الإجمالي: ${fmt(tot(s))} ${esc(ctx.cur)}</b> — ${payTxt(s)}</div>${s.cn ? `<div style="color:${C.mut};font-size:13px">العميل: ${esc(s.cn)}${s.cp ? ' — ' + esc(s.cp) : ''}</div>` : ''}</div>`).join('');
  const html = wrap(head(sales.length == 1 ? 'بيع جديد' : `${sales.length} عمليات بيع جديدة`, ctx.shop) + '<div style="padding:10px 14px;border:1px solid ' + C.line + ';border-top:0;border-radius:0 0 12px 12px">' + cards + (sales.length > shown.length ? `<div style="color:${C.mut}">+ ${sales.length - shown.length} عملية أخرى</div>` : '') + `<div style="margin-top:10px;padding:10px;background:${C.bg};border-radius:10px;font-size:13px">مبيعات اليوم حتى الآن: <b>${fmt(dsum.rev)} ${esc(ctx.cur)}</b> في ${dsum.n} فاتورة</div>` + (low.length ? '<div style="margin-top:8px">' + alertBox(low) + '</div>' : '') + '</div>');
  const first = (sales[0]?.it || [])[0]?.n || '';
  const subject = sales.length == 1 ? `بيع جديد: ${first}${(sales[0].it || []).length > 1 ? ' +' + (sales[0].it.length - 1) : ''} — ${fmt(total)} ${ctx.cur}` : `${sales.length} عمليات بيع جديدة — إجمالي ${fmt(total)} ${ctx.cur}`;
  return { subject, html };
}
