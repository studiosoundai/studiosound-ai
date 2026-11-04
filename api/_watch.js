// api/_watch.js — shared by release-watch.js (the Studio) and cron-release-watch.js (the daily check).
// Spotify public catalog (no artist login needed), Last.fm + Deezer public numbers, Resend emails, and the database.
// Env: SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, RESEND_API_KEY, EMAIL_FROM (optional), LASTFM_API_KEY (optional),
//      SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SITE_URL (optional, default https://studiosound.ai)
import crypto from 'node:crypto';

export const SITE = () => (process.env.SITE_URL || 'https://studiosound.ai').replace(/\/$/, '');
const env = () => ({ url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY });
const svc = (extra) => { const { key } = env(); return Object.assign({ apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, extra || {}); };

// ---------- database (service key; these tables have no browser access) ----------
export async function db(path, opts = {}) {
  const { url } = env();
  const r = await fetch(`${url}/rest/v1/${path}`, { method: opts.method || 'GET', headers: svc(opts.headers), body: opts.body ? JSON.stringify(opts.body) : undefined });
  if (!r.ok) { const t = await r.text().catch(() => ''); const e = new Error('db ' + r.status + ' ' + t.slice(0, 200)); e.status = r.status; throw e; }
  if (r.status === 204) return null;
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

// ---------- Spotify (public catalog, app-only token) ----------
let tok = null, tokExp = 0;
export const spotifyReady = () => !!(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET);
async function spotifyToken() {
  if (tok && Date.now() < tokExp - 60000) return tok;
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + Buffer.from(process.env.SPOTIFY_CLIENT_ID + ':' + process.env.SPOTIFY_CLIENT_SECRET).toString('base64') },
    body: 'grant_type=client_credentials',
  });
  const d = await r.json();
  if (!d.access_token) throw new Error('Spotify sign-in failed: ' + (d.error_description || d.error || r.status));
  tok = d.access_token; tokExp = Date.now() + (d.expires_in || 3600) * 1000;
  return tok;
}
export async function spotify(path) {
  const r = await fetch('https://api.spotify.com/v1/' + path, { headers: { Authorization: 'Bearer ' + await spotifyToken() } });
  if (r.status === 404 || r.status === 400) return null;
  if (!r.ok) throw new Error('Spotify ' + r.status);
  return await r.json();
}
// "https://open.spotify.com/artist/ID?si=..", "spotify:artist:ID", or a track/album link (we use its main artist)
export function parseSpotifyLink(s) {
  const m = String(s || '').trim().match(/(artist|track|album)[/:]([0-9A-Za-z]{22})/);
  return m ? { kind: m[1], id: m[2] } : null;
}
export async function resolveArtist(link) {
  const p = parseSpotifyLink(link);
  if (!p) return null;
  let id = p.id;
  if (p.kind !== 'artist') {
    const t = await spotify((p.kind === 'track' ? 'tracks/' : 'albums/') + p.id);
    id = t && t.artists && t.artists[0] && t.artists[0].id;
    if (!id) return null;
  }
  const a = await spotify('artists/' + id);
  if (!a || !a.id) return null;
  return { id: a.id, name: a.name, image: (a.images && a.images[0] && a.images[0].url) || null, followers: a.followers && a.followers.total, popularity: a.popularity };
}
export async function latestReleases(artistId) {
  const d = await spotify(`artists/${artistId}/albums?include_groups=album,single&market=US&limit=20`);
  return ((d && d.items) || []).map(x => ({
    spotify_id: x.id, name: x.name, release_date: x.release_date || null,
    image: (x.images && x.images[0] && x.images[0].url) || null, url: (x.external_urls && x.external_urls.spotify) || null,
  }));
}

// ---------- free weekly snapshot ----------
async function getJson(u, ms = 6000) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
  try { const r = await fetch(u, { signal: c.signal }); return r.ok ? await r.json() : null; } catch (e) { return null; } finally { clearTimeout(t); }
}
export async function takeSnapshot(artistId, artistName) {
  const out = { at: new Date().toISOString() };
  try {
    const [a, top] = await Promise.all([spotify('artists/' + artistId), spotify(`artists/${artistId}/top-tracks?market=US`)]);
    out.spotify = {
      followers: a && a.followers ? a.followers.total : null,
      popularity: a ? a.popularity : null,
      top: ((top && top.tracks) || []).slice(0, 5).map(t => ({ name: t.name, popularity: t.popularity })),
    };
  } catch (e) { out.spotify = null; }
  const name = artistName || '';
  if (name && process.env.LASTFM_API_KEY) {
    const d = await getJson(`https://ws.audioscrobbler.com/2.0/?method=artist.getinfo&artist=${encodeURIComponent(name)}&api_key=${encodeURIComponent(process.env.LASTFM_API_KEY)}&format=json&autocorrect=1`);
    const st = d && d.artist && d.artist.stats;
    if (st) out.lastfm = { listeners: Number(st.listeners) || 0, plays: Number(st.playcount) || 0 };
  }
  if (name) {
    const d = await getJson('https://api.deezer.com/search/artist?limit=5&q=' + encodeURIComponent(name));
    const hit = d && Array.isArray(d.data) ? d.data.find(x => String(x.name || '').toLowerCase() === name.toLowerCase()) : null;
    if (hit) out.deezer = { fans: hit.nb_fan || 0 };
  }
  return out;
}
export async function saveSnapshot(userId, artistId, data) {
  await db('music_snapshots?on_conflict=user_id,taken_on', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: { user_id: userId, spotify_artist_id: artistId, taken_on: new Date().toISOString().slice(0, 10), data } });
}

// ---------- email (Resend) ----------
export const emailReady = () => !!process.env.RESEND_API_KEY;
const secret = () => process.env.CALENDAR_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
export const unsubKey = (uid) => crypto.createHmac('sha256', secret()).update('unsub|' + uid).digest('base64url').slice(0, 24);
export const unsubLink = (uid) => `${SITE()}/api/release-watch?unsub=${encodeURIComponent(uid)}&k=${unsubKey(uid)}`;
export async function sendEmail(to, subject, html) {
  if (!emailReady() || !to) return { skipped: true };
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.EMAIL_FROM || 'StudioSound <updates@studiosound.ai>', to: [to], reply_to: 'support@studiosound.ai', subject, html }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('email ' + r.status + ' ' + JSON.stringify(d).slice(0, 200));
  return d;
}
const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function shell(inner, uid) {
  return `<!doctype html><html><body style="margin:0;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;color:#111;">
<div style="max-width:560px;margin:0 auto;padding:24px 16px;">
<div style="font-weight:800;font-size:18px;margin-bottom:16px;">StudioSound<span style="color:#00b894;">.ai</span></div>
<div style="background:#fff;border-radius:14px;padding:24px;line-height:1.55;font-size:15px;">${inner}</div>
<div style="color:#888;font-size:11px;line-height:1.6;margin-top:14px;text-align:center;">You get this because you turned on release alerts in StudioSound.<br><a href="${unsubLink(uid)}" style="color:#888;">Turn off release emails</a> · <a href="${SITE()}/app.html#report" style="color:#888;">Manage in the Studio</a></div>
</div></body></html>`;
}
const btn = (href, label) => `<a href="${href}" style="display:inline-block;background:#00d9b5;color:#05050a;font-weight:800;text-decoration:none;border-radius:10px;padding:12px 20px;margin:6px 0;">${esc(label)}</a>`;
const step = (n, text, href, label) => `<tr><td style="vertical-align:top;padding:8px 10px 8px 0;"><div style="width:24px;height:24px;border-radius:12px;background:#00d9b5;color:#05050a;font-weight:800;font-size:12px;text-align:center;line-height:24px;">${n}</div></td><td style="padding:8px 0;">${text}<br><a href="${href}" style="color:#00a389;font-weight:700;font-size:13px;text-decoration:none;">${esc(label)} →</a></td></tr>`;

export function releaseEmail(uid, artist, rel) {
  const s = SITE();
  const subject = `🎉 "${rel.name}" is out! Here's your first week`;
  const html = shell(`
${rel.image ? `<img src="${esc(rel.image)}" alt="" width="120" height="120" style="border-radius:10px;display:block;margin-bottom:14px;">` : ''}
<div style="font-size:20px;font-weight:800;margin-bottom:6px;">Congrats on "${esc(rel.name)}"!</div>
<div style="color:#444;margin-bottom:14px;">It just showed up on Spotify. The first 7 days matter most, so here's your week:</div>
<table style="border-collapse:collapse;width:100%;font-size:14px;">
${step(1, 'Post the hook every day this week on TikTok and Reels.', s + '/app.html#trim', 'Cut the hook')}
${step(2, 'Drop a lyric video so the song has something to share and loop.', s + '/app.html#lyric', 'Make the lyric video')}
${step(3, 'Run a small ad where your fans already are.', s + '/app.html#ads', 'Make the ad kit')}
${step(4, 'Put your release plan on your calendar so you don’t miss a step.', s + '/app.html#plan', 'Open the Release Planner')}
</table>
<div style="margin-top:16px;">${btn(rel.url || s + '/app.html', rel.url ? 'Hear it on Spotify' : 'Open StudioSound')}</div>
<div style="color:#666;font-size:13px;margin-top:10px;">In 7 days we'll check in on how "${esc(rel.name)}" is doing.</div>`, uid);
  return { subject, html };
}
export function followupEmail(uid, artist, rel, snap, prev) {
  const s = SITE();
  const subject = `How's "${rel.name}" doing? Get your Report Card`;
  let trend = '';
  const p = snap && snap.spotify, q = prev && prev.spotify;
  if (p && p.popularity != null) {
    trend = `<div style="background:#f1fbf8;border-radius:10px;padding:12px 14px;margin:12px 0;font-size:14px;">Your Spotify popularity: <b>${p.popularity}</b>` +
      (q && q.popularity != null && q.popularity !== p.popularity ? ` (${p.popularity > q.popularity ? 'up' : 'down'} from ${q.popularity} last week)` : '') +
      (p.followers != null ? `<br>Spotify followers: <b>${Number(p.followers).toLocaleString('en-US')}</b>` + (q && q.followers != null && q.followers !== p.followers ? ` (${p.followers > q.followers ? '+' : ''}${(p.followers - q.followers).toLocaleString('en-US')} this week)` : '') : '') + '</div>';
  }
  const html = shell(`
<div style="font-size:20px;font-weight:800;margin-bottom:6px;">"${esc(rel.name)}" has been out a week</div>
<div style="color:#444;">Time to see what's working. Take 2 minutes: screenshot your Spotify for Artists song page (and your distribution dashboard if you have one), and we'll tell you in plain words how it's doing, where it's hitting and your next move.</div>
${trend}
<div style="margin-top:12px;">${btn(s + '/app.html#report', 'Get my Report Card')}</div>`, uid);
  return { subject, html };
}
