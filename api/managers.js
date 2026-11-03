import { MANAGER_LIMITS, managerPlanOf } from './_usage.js';

// Managers: an artist lets their manager work inside their account.
// GET                               -> { me: { plan, limit, managers: [...] }, accounts: [...] }
//   me.managers: the people who manage MY account (invited or active)
//   accounts:    the artists I manage (active) or have been invited to manage (invited)
// POST { action: 'invite', email }  -> the artist invites a manager (Free 0, Pro 1, Premium 3)
// POST { action: 'remove', id }     -> the artist removes a manager, or a manager leaves / declines
// POST { action: 'accept', id }     -> the invited person accepts (must be signed in with the invited email)
// Every POST answers with the same shape as GET, so the Studio can just redraw.
// This route always acts as the person signed in (never as an artist they manage):
// only the artist can add or remove managers on their own account.
// Needs managers-setup.sql run in Supabase.

const env = () => ({ url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY });
const svc = () => { const { key } = env(); return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }; };
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    const err = new Error((data && (data.message || data.error)) || ('error ' + r.status)); err.status = r.status; throw err;
  }
  return data;
}

async function state(user) {
  const plan = await managerPlanOf(user.id, user.email);
  const [mine, accounts] = await Promise.all([
    rpc('managers_of', { p_owner: user.id }),
    rpc('accounts_for', { p_uid: user.id, p_email: user.email || '' }),
  ]);
  return {
    me: { plan, limit: MANAGER_LIMITS[plan] || 0, managers: Array.isArray(mine) ? mine : [] },
    accounts: (Array.isArray(accounts) ? accounts : []).map(a => ({
      id: a.id, owner_id: a.owner_id, owner_email: a.owner_email, owner_name: a.owner_name || null,
      owner_plan: a.owner_plan, status: a.status,
      // a manager can only work in the account while the artist's plan includes managers
      usable: a.status === 'active' && (MANAGER_LIMITS[a.owner_plan] || 0) > 0,
    })),
  };
}

export default async function handler(req, res) {
  const user = await userFromToken(req);
  if (!user) return res.status(401).json({ error: 'Please sign in first.' });

  try {
    if (req.method === 'GET') return res.status(200).json(await state(user));
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const body = req.body || {};

    if (body.action === 'invite') {
      const email = String(body.email || '').trim().toLowerCase();
      if (!EMAIL.test(email) || email.length > 200) return res.status(400).json({ error: 'Enter a valid email address.' });
      if (email === String(user.email || '').toLowerCase()) return res.status(400).json({ error: 'That’s your own email. Enter your manager’s email.' });
      const cur = await state(user);
      if (cur.me.managers.some(m => m.email === email)) return res.status(200).json(Object.assign(cur, { note: 'Already invited.' }));
      if (cur.me.limit < 1) return res.status(402).json(Object.assign(cur, { error: 'upgrade', message: 'Managers come with Pro (1 manager) and Premium (up to 3). Upgrade to add one.' }));
      if (cur.me.managers.length >= cur.me.limit) {
        return res.status(402).json(Object.assign(cur, { error: 'full', message: cur.me.plan === 'pro'
          ? 'Pro includes 1 manager. Remove them first, or upgrade to Premium for up to 3.'
          : 'You have the most managers your plan allows (' + cur.me.limit + '). Remove one to add someone new.' }));
      }
      await rpc('manager_invite', { p_owner: user.id, p_email: email });
      return res.status(200).json(await state(user));
    }

    if (body.action === 'remove' || body.action === 'accept') {
      if (!UUID.test(String(body.id || ''))) return res.status(400).json({ error: 'Something went wrong. Refresh and try again.' });
      const fn = body.action === 'accept' ? 'manager_accept' : 'manager_remove';
      const ok = await rpc(fn, { p_id: body.id, p_uid: user.id, p_email: user.email || '' });
      if (!ok) return res.status(404).json(Object.assign(await state(user), { error: body.action === 'accept' ? 'That invite isn’t for this account. Sign in with the email it was sent to.' : 'Not found.' }));
      return res.status(200).json(await state(user));
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    console.error('managers', e);
    if (/managers_of|accounts_for|manager_invite|manager_accept|manager_remove|relation .*managers/i.test(e.message || '') || e.status === 404)
      return res.status(500).json({ error: 'Managers aren’t set up yet. Run managers-setup.sql in Supabase first.' });
    return res.status(500).json({ error: 'Something went wrong. Try again.' });
  }
}
