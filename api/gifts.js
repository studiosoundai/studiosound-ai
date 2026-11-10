import { isOwner } from './_usage.js';

// Gifted plans (owner only, on the Staff page)
// GET                                                   -> { owner: false }  or  { owner: true, gifts: [...] }
// POST { action: 'give', email, plan, months, note? }   -> { ok, email, plan, expires_at, signed_up, now_on }
// POST { action: 'remove', email }                      -> { ok, email, plan }
// Give an artist or creator Pro or Premium for a set time (default 3 months; months 0 = no end date).
// Works before they sign up: they start on the gifted plan the moment they create an account with that email.
// Unlike Staff, a gift does NOT unlock tools that aren't public yet. Someone who pays keeps their paid plan.
// Gifts that run out are ended once a day by cron-release-watch.js (rpc gift_daily).
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, FOUNDER_EMAILS (or OWNER_EMAILS)

const env = () => ({ url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY });
const svc = () => { const { key } = env(); return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }; };

async function userFromToken(req) {
  const { url, key } = env();
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!url || !key || !token) return null;
  try {
    const r = await fetch(`${url}/auth/v1/user`, { headers: { apikey: key, Authorization: `Bearer ${token}` } });
    return r.ok ? await r.json() : null;
  } catch (e) { return null; }
}
async function rpc(name, args) {
  const { url } = env();
  const r = await fetch(`${url}/rest/v1/rpc/${name}`, { method: 'POST', headers: svc(), body: JSON.stringify(args || {}) });
  const data = await r.json().catch(() => null);
  if (!r.ok) { const err = new Error((data && (data.message || data.error)) || ('error ' + r.status)); err.status = r.status; throw err; }
  return data;
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MONTHS = [0, 1, 3, 6, 12];

export default async function handler(req, res) {
  const user = await userFromToken(req);
  if (!user || !isOwner(user.email)) {
    if (req.method === 'GET') return res.status(200).json({ owner: false });
    return res.status(403).json({ error: 'Only the account owner can give plans.' });
  }
  try {
    if (req.method === 'GET') {
      const gifts = await rpc('gift_list');
      return res.status(200).json({ owner: true, gifts: Array.isArray(gifts) ? gifts : [] });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const body = req.body || {};
    const email = String(body.email || '').trim().toLowerCase();
    if (!EMAIL.test(email) || email.length > 200) return res.status(400).json({ error: 'Enter a valid email address.' });

    if (body.action === 'give') {
      const plan = body.plan === 'pro' ? 'pro' : 'premium';
      const months = MONTHS.includes(Number(body.months)) ? Number(body.months) : 3;
      const out = await rpc('gift_give', { p_email: email, p_plan: plan, p_months: months, p_note: String(body.note || '').slice(0, 80) || null });
      return res.status(200).json({ ok: true, ...out });
    }
    if (body.action === 'remove') {
      const out = await rpc('gift_end', { p_email: email });
      if (!out || !out.removed) return res.status(404).json({ error: 'That email doesn’t have a gifted plan.' });
      return res.status(200).json({ ok: true, ...out });
    }
    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    console.error('gifts', e);
    if (/gift_|plan_gifts/i.test(e.message || '') || e.status === 404)
      return res.status(500).json({ error: 'Gifted plans aren’t set up yet. Run gift-plans-setup.sql in Supabase first.' });
    return res.status(500).json({ error: 'Something went wrong. Try again.' });
  }
}
