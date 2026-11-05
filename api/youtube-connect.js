import { resolveAccount, hasEarlyAccess } from './_usage.js';
import { db } from './_watch.js';
import { googleReady, authUrl, readState, exchangeCode, lock, unlock, revoke, myChannel, pullAndSave, baseUrl } from './_youtube.js';

// Connect YouTube (read-only YouTube Studio numbers)
// POST { action:'start' }        (signed in)  -> { url }  the Google sign-in page; the Studio sends the artist there
// GET  ?code=&state=             (Google)     -> saves the connection, pulls this week's numbers, back to the Studio
// GET                            (signed in)  -> { enabled, ready, connected, link, latest, prev }
// POST { action:'refresh' }      (signed in)  -> pulls the numbers again now
// POST { action:'disconnect' }   (signed in)  -> removes the connection and tells Google to forget it
// A manager working in an artist's account connects for that artist (the artist's Google account signs in).
// Rollout: same as the Song Report Card (founders and Staff until REPORT_PUBLIC=true).

async function enabledFor(acct) {
  if (String(process.env.REPORT_PUBLIC || '').toLowerCase() === 'true') return true;
  return (await hasEarlyAccess(acct.accountEmail)) || (await hasEarlyAccess(acct.user.email));
}
async function state(uid) {
  const [l, s] = await Promise.all([
    db(`youtube_links?user_id=eq.${uid}&select=channel_id,channel_title,channel_image,google_email,connected_at,last_pull_at,last_error`),
    db(`youtube_snapshots?user_id=eq.${uid}&select=taken_on,data&order=taken_on.desc&limit=2`),
  ]);
  const link = (l && l[0]) || null;
  return { connected: !!link, link, latest: (s && s[0]) || null, prev: (s && s[1]) || null };
}
const back = (req, res, flag) => { res.setHeader('Location', baseUrl(req) + '/app.html?yt=' + flag + '#report'); return res.status(302).end(); };

export default async function handler(req, res) {
  // ---------- Google sends the artist back here ----------
  if (req.method === 'GET' && req.query && (req.query.code || req.query.error || req.query.state)) {
    if (req.query.error) return back(req, res, 'cancelled');
    const uid = readState(req.query.state);
    if (!uid || !googleReady()) return back(req, res, 'expired');
    try {
      const t = await exchangeCode(req, String(req.query.code));
      if (!t.refresh_token) return back(req, res, 'retry');
      const granted = String(t.scope || '');
      if (!granted.includes('yt-analytics.readonly')) { await revoke(t.refresh_token); return back(req, res, 'noaccess'); }
      const ch = await myChannel(t.access_token);
      if (!ch) { await revoke(t.refresh_token); return back(req, res, 'nochannel'); }
      // replacing an older connection: let Google forget the old key
      const old = (await db(`youtube_links?user_id=eq.${uid}&select=refresh_token`))[0];
      if (old) { try { await revoke(unlock(old.refresh_token)); } catch (e) {} }
      await db('youtube_links?on_conflict=user_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: { user_id: uid, channel_id: ch.id, channel_title: ch.title, channel_image: ch.image, refresh_token: lock(t.refresh_token), connected_at: new Date().toISOString(), last_error: null } });
      try { await pullAndSave(uid); } catch (e) { console.error('yt first pull', e); }
      return back(req, res, 'connected');
    } catch (e) {
      console.error('youtube connect', e);
      return back(req, res, 'error');
    }
  }

  const acct = await resolveAccount(req);
  if (!acct.ok) {
    if (req.method === 'GET') return res.status(200).json({ enabled: false });
    return res.status(acct.status).json({ error: acct.message || acct.error });
  }
  const uid = acct.accountId;
  const enabled = await enabledFor(acct);
  try {
    if (req.method === 'GET') {
      if (!enabled) return res.status(200).json({ enabled: false });
      return res.status(200).json(Object.assign({ enabled: true, ready: googleReady() }, await state(uid)));
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    if (!enabled) return res.status(403).json({ error: 'Connect YouTube is coming soon.' });
    const body = req.body || {};
    if (body.action === 'start') {
      if (!googleReady()) return res.status(503).json({ error: 'Connect YouTube isn’t switched on yet (Google keys missing in Vercel).' });
      return res.status(200).json({ url: authUrl(req, uid) });
    }
    if (body.action === 'refresh') {
      await pullAndSave(uid);
      return res.status(200).json(Object.assign({ enabled: true, ready: googleReady() }, await state(uid)));
    }
    if (body.action === 'disconnect') {
      const old = (await db(`youtube_links?user_id=eq.${uid}&select=refresh_token`))[0];
      if (old) { try { await revoke(unlock(old.refresh_token)); } catch (e) {} }
      await db(`youtube_links?user_id=eq.${uid}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
      await db(`youtube_snapshots?user_id=eq.${uid}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
      return res.status(200).json(Object.assign({ enabled: true, ready: googleReady() }, await state(uid)));
    }
    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    console.error('youtube-connect', e);
    if (/youtube_links|youtube_snapshots|relation/i.test(e.message || '')) return res.status(500).json({ error: 'Connect YouTube isn’t set up yet. Run youtube-connect-setup.sql in Supabase first.' });
    return res.status(500).json({ error: 'Something went wrong. Try again.' });
  }
}
