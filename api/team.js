import { isOwner } from './_usage.js';

// Team page (owner only)
// GET                                   -> { owner: false }  or  { owner: true, members: [...] }
// POST { action: 'add', email, note? } -> { ok, email, signed_up }
// POST { action: 'remove', email }     -> { ok, email, plan }
// Team members get Premium plus early access to tools that aren't public yet.
// Adding someone who hasn't signed up works: they start on Premium the moment they create an account.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, FOUNDER_EMAILS (or OWNER_EMAILS)

const env = () => ({ url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY });
const svc = (extra) => { const { key } = env(); return Object.assign({ apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, extra || {}); };

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
  if (!r.ok) {
    const msg = (data && (data.message || data.error)) || ('error ' + r.status);
    const err = new Error(msg); err.status = r.status; throw err;
  }
  return data;
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export default async function handler(req, res) {
  const user = await userFromToken(req);
  if (!user || !isOwner(user.email)) {
    if (req.method === 'GET') return res.status(200).json({ owner: false });
    return res.status(403).json({ error: 'Only the account owner can manage the team.' });
  }

  try {
    if (req.method === 'GET') {
      const members = await rpc('team_status');
      return res.status(200).json({ owner: true, members: Array.isArray(members) ? members : [] });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const body = req.body || {};
    const email = String(body.email || '').trim().toLowerCase();
    if (!EMAIL.test(email) || email.length > 200) return res.status(400).json({ error: 'Enter a valid email address.' });

    if (body.action === 'add') {
      const out = await rpc('team_add', { p_email: email, p_note: String(body.note || '').slice(0, 80) || null });
      return res.status(200).json({ ok: true, ...out });
    }
    if (body.action === 'remove') {
      if (isOwner(email)) return res.status(400).json({ error: 'You can’t remove the owner.' });
      const out = await rpc('team_remove', { p_email: email });
      if (!out || !out.removed) return res.status(404).json({ error: 'That email isn’t on the team.' });
      return res.status(200).json({ ok: true, ...out });
    }
    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    console.error('team', e);
    if (/team_status|team_add|team_remove|relation .*team/i.test(e.message || '') || e.status === 404)
      return res.status(500).json({ error: 'The team list isn’t set up yet. Run team-setup.sql in Supabase first.' });
    return res.status(500).json({ error: 'Something went wrong. Try again.' });
  }
}
