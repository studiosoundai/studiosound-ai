import { hasEarlyAccess, resolveAccount } from './_usage.js';
import { db, spotifyReady, emailReady, resolveArtist, latestReleases, takeSnapshot, saveSnapshot, unsubKey } from './_watch.js';

// Release Watch: the artist pastes their Spotify artist link once; we email them when a new song drops,
// check in a week later, and keep a free weekly snapshot of their public numbers.
// GET                         -> { enabled, ready, watch, releases, snapshots }
// GET ?unsub=<uid>&k=<key>    -> turns release emails off (link at the bottom of every email)
// POST { action:'connect', link } | { action:'alerts', on } | { action:'disconnect' }
// A manager working in an artist's account manages that artist's watch; emails go to the artist.
// Rollout: same as the Song Report Card (founders and Staff until REPORT_PUBLIC=true).

async function enabledFor(acct) {
  if (String(process.env.REPORT_PUBLIC || '').toLowerCase() === 'true') return true;
  return (await hasEarlyAccess(acct.accountEmail)) || (await hasEarlyAccess(acct.user.email));
}

async function state(uid) {
  const [w, rel, snaps] = await Promise.all([
    db(`release_watch?user_id=eq.${uid}&select=spotify_artist_id,artist_name,artist_image,alerts,email,created_at,last_checked_at`),
    db(`release_seen?user_id=eq.${uid}&select=spotify_id,name,release_date,image,url,baseline,alerted_at,followup_at&order=release_date.desc&limit=6`),
    db(`music_snapshots?user_id=eq.${uid}&select=taken_on,data&order=taken_on.desc&limit=8`),
  ]);
  return { watch: (w && w[0]) || null, releases: rel || [], snapshots: snaps || [] };
}

const page = (msg) => `<!doctype html><html><body style="font-family:Arial,sans-serif;background:#05050a;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;"><div style="max-width:420px;padding:24px;text-align:center;"><div style="font-weight:800;font-size:20px;margin-bottom:10px;">StudioSound</div><div style="color:#c8c8dc;line-height:1.6;">${msg}</div><a href="/app.html#report" style="display:inline-block;margin-top:18px;color:#00FFD1;font-weight:700;">Open the Studio</a></div></body></html>`;

export default async function handler(req, res) {
  // one-tap unsubscribe from an email (no login)
  if (req.method === 'GET' && req.query && req.query.unsub) {
    const uid = String(req.query.unsub), k = String(req.query.k || '');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (!/^[0-9a-f-]{36}$/i.test(uid) || k !== unsubKey(uid)) return res.status(400).send(page('That link didn’t work. You can turn release emails off in the Studio under Song Report Card.'));
    try { await db(`release_watch?user_id=eq.${uid}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: { alerts: false } }); } catch (e) {}
    return res.status(200).send(page('Done. You won’t get release emails anymore. Turn them back on anytime in the Studio under Song Report Card.'));
  }

  const acct = await resolveAccount(req);
  if (!acct.ok) {
    if (req.method === 'GET') return res.status(200).json({ enabled: false });
    return res.status(acct.status).json({ error: acct.message || acct.error });
  }
  const uid = acct.accountId;
  const enabled = await enabledFor(acct);
  const ready = { spotify: spotifyReady(), email: emailReady(), youtube: !!process.env.YOUTUBE_API_KEY, genius: !!process.env.GENIUS_TOKEN, lastfm: !!process.env.LASTFM_API_KEY };

  try {
    if (req.method === 'GET') {
      if (!enabled) return res.status(200).json({ enabled: false });
      return res.status(200).json(Object.assign({ enabled: true, ready }, await state(uid)));
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    if (!enabled) return res.status(403).json({ error: 'Release alerts are coming soon.' });
    const body = req.body || {};

    if (body.action === 'connect') {
      if (!ready.spotify) return res.status(503).json({ error: 'Release alerts aren’t switched on yet (Spotify keys missing in Vercel).' });
      const artist = await resolveArtist(body.link);
      if (!artist) return res.status(400).json({ error: 'That doesn’t look like a Spotify artist link. In Spotify, open your artist page → ⋯ → Share → Copy link to artist.' });
      await db('release_watch?on_conflict=user_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: { user_id: uid, spotify_artist_id: artist.id, artist_name: artist.name, artist_image: artist.image, email: acct.accountEmail || null, alerts: true, last_checked_at: new Date().toISOString() } });
      // everything already out is the starting point: we only email about songs that come out from now on
      await db(`release_seen?user_id=eq.${uid}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
      const rels = await latestReleases(artist.id);
      if (rels.length) await db('release_seen?on_conflict=user_id,spotify_id', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: rels.map(r => Object.assign({ user_id: uid, baseline: true }, r)) });
      const newest = rels.filter(r => String(r.release_date || '') <= new Date().toISOString().slice(0, 10)).sort((a, b) => String(b.release_date || '').localeCompare(String(a.release_date || '')))[0];
      const last = await db(`music_snapshots?user_id=eq.${uid}&spotify_artist_id=eq.${artist.id}&select=data&order=taken_on.desc&limit=1`).catch(() => null);
      try { await saveSnapshot(uid, artist.id, await takeSnapshot(artist.id, artist.name, newest && newest.name, last && last[0] && last[0].data)); } catch (e) { console.error('snapshot', e); }
      return res.status(200).json(Object.assign({ enabled: true, ready }, await state(uid)));
    }
    if (body.action === 'alerts') {
      await db(`release_watch?user_id=eq.${uid}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: { alerts: !!body.on } });
      return res.status(200).json(Object.assign({ enabled: true, ready }, await state(uid)));
    }
    if (body.action === 'disconnect') {
      await db(`release_watch?user_id=eq.${uid}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
      await db(`release_seen?user_id=eq.${uid}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
      return res.status(200).json(Object.assign({ enabled: true, ready }, await state(uid)));
    }
    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    console.error('release-watch', e);
    if (/release_watch|release_seen|music_snapshots|relation/i.test(e.message || '')) return res.status(500).json({ error: 'Release alerts aren’t set up yet. Run release-watch-setup.sql in Supabase first.' });
    return res.status(500).json({ error: 'Something went wrong. Try again.' });
  }
}
