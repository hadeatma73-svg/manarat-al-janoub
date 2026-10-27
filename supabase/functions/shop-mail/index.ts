// @ts-nocheck
import { createClient } from 'npm:@supabase/supabase-js@2';
import { dailyReport, weeklyReport, saleDigest, localNow } from './report.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
const sb = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function secret(n) { const { data } = await sb.rpc('get_secret', { n }); return data; }

async function send(key, to, subject, html) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'Manarat Al Janoub <onboarding@resend.dev>', to: [to], subject, html }),
  });
  const body = await r.text();
  return { ok: r.ok, status: r.status, body };
}
const ctxOf = (st) => ({ tz: st.tz || 'Asia/Amman', syncAt: st.data?._at || (st.updated_at ? Date.parse(st.updated_at) : 0), nowMs: Date.now() });
const why = (r) => (r.status === 403 || r.status === 422 ? 'ريسيند رفض الإرسال: تأكد أن البريد هو نفس إيميل حساب Resend بالضبط.' : r.status === 429 ? 'ريسيند طلب الانتظار قليلاً، أعد المحاولة بعد دقيقة.' : 'تعذّر الإرسال (' + r.status + ').');

async function tick(key) {
  const out = { sale: 0, daily: 0, weekly: 0, failed: 0 };
  const { data: rows } = await sb.from('mail_queue').select('*').is('sent_at', null).lt('attempts', 5).order('id').limit(500);
  const byUser = {};
  for (const r of rows || []) (byUser[r.user_id] ||= []).push(r);
  for (const [uid, list] of Object.entries(byUser)) {
    const ids = list.map((r) => r.id);
    const { data: st } = await sb.from('shop_state').select('data,notify_email,tz,updated_at').eq('user_id', uid).maybeSingle();
    if (!st || !st.notify_email) { await sb.from('mail_queue').update({ sent_at: new Date().toISOString() }).in('id', ids); continue; }
    const ctx = { ...ctxOf(st), date: localNow(st.tz || 'Asia/Amman').date };
    const m = saleDigest(list.map((r) => r.payload), st.data || {}, ctx);
    const res = await send(key, st.notify_email, m.subject, m.html);
    if (res.ok) { await sb.from('mail_queue').update({ sent_at: new Date().toISOString() }).in('id', ids); out.sale++; }
    else {
      out.failed++;
      const permanent = res.status === 400 || res.status === 403 || res.status === 422;
      for (const r of list) await sb.from('mail_queue').update({ attempts: permanent ? 5 : r.attempts + 1 }).eq('id', r.id);
    }
    await sleep(700);
  }
  const { data: users } = await sb.from('shop_state').select('user_id,data,notify_email,tz,daily_on,weekly_on,last_daily,last_weekly,updated_at').not('notify_email', 'is', null);
  for (const u of users || []) {
    const t = localNow(u.tz || 'Asia/Amman');
    if (t.hour !== 22) continue;
    const ctx = ctxOf(u);
    if (u.daily_on && u.last_daily !== t.date) {
      const m = dailyReport(u.data || {}, t.date, ctx);
      const r = await send(key, u.notify_email, m.subject, m.html);
      if (r.ok) { await sb.from('shop_state').update({ last_daily: t.date }).eq('user_id', u.user_id); out.daily++; } else out.failed++;
      await sleep(700);
    }
    if (u.weekly_on && t.dow === 4 && u.last_weekly !== t.date) {
      const m = weeklyReport(u.data || {}, t.date, ctx);
      const r = await send(key, u.notify_email, m.subject, m.html);
      if (r.ok) { await sb.from('shop_state').update({ last_weekly: t.date }).eq('user_id', u.user_id); out.weekly++; } else out.failed++;
      await sleep(700);
    }
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const body = await req.json().catch(() => ({}));
    const cronHdr = req.headers.get('x-cron-key');
    let userId = null, isCron = false;
    if (cronHdr) {
      const k = await secret('cron_key');
      if (!k || cronHdr !== k) return json({ error: 'forbidden' }, 403);
      isCron = true;
    } else {
      const tok = (req.headers.get('Authorization') || '').replace(/^Bearer /, '');
      const { data, error } = await sb.auth.getUser(tok);
      if (error || !data?.user) return json({ error: 'unauthorized' }, 401);
      userId = data.user.id;
    }
    const key = await secret('resend_api_key');
    if (isCron && body.action === 'tick') return json({ ok: true, ...(await tick(key)) });
    if (isCron && body.dry) {
      const t = localNow(body.tz || 'Asia/Amman');
      const ctx = { tz: body.tz || 'Asia/Amman', syncAt: body.syncAt || 0, nowMs: Date.now(), date: body.date || t.date };
      const m = body.action === 'weekly' ? weeklyReport(body.data, ctx.date, ctx) : body.action === 'sale' ? saleDigest(body.payloads, body.data, ctx) : dailyReport(body.data, ctx.date, ctx);
      return json({ ok: true, ...m });
    }
    if (!userId) return json({ error: 'bad request' }, 400);
    const { data: st } = await sb.from('shop_state').select('data,notify_email,tz,updated_at').eq('user_id', userId).maybeSingle();
    if (!st) return json({ ok: false, message: 'لا توجد بيانات محفوظة بعد، سجّل أي عملية أولاً.' });
    if (!st.notify_email) return json({ ok: false, message: 'اكتب بريد الاستلام في الإعدادات أولاً.' });
    const t = localNow(st.tz || 'Asia/Amman'), ctx = ctxOf(st);
    let m;
    if (body.action === 'test') m = { subject: 'بريد تجريبي من منارة الجنوب', html: '<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif"><h3>منارة الجنوب</h3><p>✅ التنبيهات تعمل بنجاح. ستصلك هنا: إشعارات المبيعات، والجرد اليومي (10 مساءً)، والجرد الأسبوعي (الخميس 10 مساءً).</p></div>' };
    else if (body.action === 'daily') m = dailyReport(st.data || {}, t.date, ctx);
    else if (body.action === 'weekly') m = weeklyReport(st.data || {}, t.date, ctx);
    else return json({ error: 'unknown action' }, 400);
    const r = await send(key, st.notify_email, m.subject, m.html);
    return json(r.ok ? { ok: true, message: 'تم الإرسال إلى ' + st.notify_email } : { ok: false, message: why(r) });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});
