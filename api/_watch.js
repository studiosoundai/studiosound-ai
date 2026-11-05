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
  return { id: a.id, name: a.name, image: (a.images && a.images[0] && a.images[0].url) || null };
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
// ---------- free weekly snapshot ----------
// Spotify stopped giving apps like ours popularity, follower counts and top tracks in February 2026,
// so the weekly numbers come from platforms that still share them. Spotify is still used to spot new releases.
//   Last.fm   listeners and plays (artist + newest song)          LASTFM_API_KEY
//   Deezer    fans, each song's popularity rank, public playlists  (no key)
//   Apple     is the song on an Apple Music top-100 chart anywhere (no key)
//   YouTube   subscribers, views, the newest videos, and what commenters say   YOUTUBE_API_KEY
//   Genius    how many people read the lyrics                       GENIUS_TOKEN
const squash = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9$]+/g, '');
const songMatch = (a, b) => { const x = squash(a), y = squash(b); return !!x && !!y && (x === y || x.includes(y) || y.includes(x)); };
const CHART_COUNTRIES = ['us', 'ca', 'gb', 'ng', 'za', 'gh', 'ke', 'jm', 'br', 'mx', 'co', 'fr', 'de', 'nl', 'au', 'nz', 'ie', 'in', 'ph', 'jp'];
let chartCache = null, chartAt = 0;
async function appleCharts() {
  if (chartCache && Date.now() - chartAt < 6 * 3600000) return chartCache;
  const all = await Promise.all(CHART_COUNTRIES.map(async cc => {
    const d = await getJson(`https://rss.applemarketingtools.com/api/v2/${cc}/music/most-played/100/songs.json`, 8000);
    return { cc, results: (d && d.feed && Array.isArray(d.feed.results)) ? d.feed.results.map((r, i) => ({ pos: i + 1, artist: r.artistName, song: r.name })) : [] };
  }));
  chartCache = all; chartAt = Date.now();
  return all;
}
async function youtube(path) {
  const k = process.env.YOUTUBE_API_KEY;
  if (!k) return null;
  return await getJson(`https://www.googleapis.com/youtube/v3/${path}&key=${encodeURIComponent(k)}`, 8000);
}
// "youtube.com/@name", "youtube.com/channel/UC...", or just "@name" -> channel id (or null)
export async function resolveYouTubeChannel(link) {
  const s = String(link || '').trim();
  const id = s.match(/channel\/(UC[0-9A-Za-z_-]{22})/);
  if (id) return id[1];
  const h = s.match(/@([0-9A-Za-z._-]{2,100})/);
  if (!h) return null;
  const c = await youtube('channels?part=id&forHandle=' + encodeURIComponent('@' + h[1]));
  return (c && c.items && c.items[0] && c.items[0].id) || null;
}
async function youtubeSnapshot(name, latestSong, prev) {
  // find the channel once (a search costs 100 of the 10,000 free daily units), then reuse it every week
  let cid = prev && prev.youtube && prev.youtube.channel && prev.youtube.channel.id;
  if (!cid) {
    const s = await youtube('search?part=snippet&type=channel&maxResults=6&q=' + encodeURIComponent(name));
    const items = (s && s.items) || [];
    const t = (it) => (it.snippet && it.snippet.channelTitle) || '';
    const own = items.find(it => squash(t(it)) === squash(name));
    const topic = items.find(it => / - topic$/i.test(t(it)) && squash(t(it).replace(/ - topic$/i, '')) === squash(name));
    const pick = own || topic;   // never guess: no exact name match, no YouTube numbers
    cid = pick && pick.id && (pick.id.channelId || pick.snippet.channelId);
    if (!cid) return null;
  }
  const c = await youtube('channels?part=statistics,contentDetails,snippet&id=' + cid);
  const ch = c && c.items && c.items[0];
  if (!ch) return null;
  const out = { channel: { id: cid, title: ch.snippet && ch.snippet.title, subscribers: Number(ch.statistics.subscriberCount) || null, views: Number(ch.statistics.viewCount) || 0, videos: Number(ch.statistics.videoCount) || 0 } };
  const up = ch.contentDetails && ch.contentDetails.relatedPlaylists && ch.contentDetails.relatedPlaylists.uploads;
  if (up) {
    const pl = await youtube('playlistItems?part=contentDetails&maxResults=10&playlistId=' + up);
    const ids = ((pl && pl.items) || []).map(x => x.contentDetails && x.contentDetails.videoId).filter(Boolean);
    if (ids.length) {
      const v = await youtube('videos?part=statistics,snippet&id=' + ids.join(','));
      out.videos = ((v && v.items) || []).map(x => ({ id: x.id, title: x.snippet.title, published: (x.snippet.publishedAt || '').slice(0, 10), views: Number(x.statistics.viewCount) || 0, likes: Number(x.statistics.likeCount) || 0, comments: Number(x.statistics.commentCount) || 0 })).slice(0, 6);
      // what people are saying, under the video for the newest song (or the newest video)
      const target = (latestSong && out.videos.find(x => songMatch(x.title, latestSong))) || out.videos[0];
      if (target && target.comments > 0) {
        const cm = await youtube('commentThreads?part=snippet&order=relevance&textFormat=plainText&maxResults=25&videoId=' + target.id);
        out.comments_on = target.title;
        out.comments = ((cm && cm.items) || []).map(x => String(x.snippet.topLevelComment.snippet.textDisplay || '').replace(/\s+/g, ' ').slice(0, 200)).filter(Boolean).slice(0, 20);
      }
    }
  }
  return out;
}
async function deezerSnapshot(name, latestSong) {
  const d = await getJson('https://api.deezer.com/search/artist?limit=10&q=' + encodeURIComponent(name));
  // the same name can have several Deezer profiles: take the biggest exact match
  const hits = d && Array.isArray(d.data) ? d.data.filter(x => squash(x.name) === squash(name)) : [];
  const best = hits.sort((x, y) => (y.nb_fan || 0) - (x.nb_fan || 0))[0];
  if (!best) return null;
  const [top, pls, song] = await Promise.all([
    getJson(`https://api.deezer.com/artist/${best.id}/top?limit=10`),
    getJson(`https://api.deezer.com/artist/${best.id}/playlists?limit=50`),
    latestSong ? getJson('https://api.deezer.com/search?limit=5&q=' + encodeURIComponent(`artist:"${name}" track:"${latestSong}"`)) : null,
  ]);
  const out = { fans: best.nb_fan || 0 };
  out.top = ((top && top.data) || []).slice(0, 5).map(t => ({ title: t.title, rank: t.rank || 0 }));
  const plist = (pls && pls.data) || [];
  out.playlists = plist.length; out.playlist_titles = plist.slice(0, 6).map(p => p.title).filter(Boolean);
  const st = song && song.data && song.data.find(t => songMatch(t.title, latestSong) && t.artist && squash(t.artist.name) === squash(name));
  if (st) out.latest = { title: st.title, rank: st.rank || 0 };
  if (!out.fans && !out.top.length && !out.playlists && !out.latest) return null;   // an empty profile with the same name: show nothing rather than 0
  return out;
}
async function geniusSnapshot(name, latestSong) {
  const tok = process.env.GENIUS_TOKEN;
  if (!tok) return null;
  const g = async (q) => {
    const c = new AbortController(); const t = setTimeout(() => c.abort(), 7000);
    try { const r = await fetch('https://api.genius.com/search?q=' + encodeURIComponent(q), { headers: { Authorization: 'Bearer ' + tok }, signal: c.signal }); return r.ok ? await r.json() : null; } catch (e) { return null; } finally { clearTimeout(t); }
  };
  const [a, s] = await Promise.all([g(name), latestSong ? g(name + ' ' + latestSong) : null]);
  const mine = (d) => ((d && d.response && d.response.hits) || []).map(h => h.result).filter(r => r && r.primary_artist && squash(r.primary_artist.name) === squash(name));
  const songs = mine(a);
  const out = { songs: songs.length, pageviews: songs.reduce((n, r) => n + ((r.stats && r.stats.pageviews) || 0), 0) };
  const hit = latestSong && mine(s).find(r => songMatch(r.title, latestSong));
  if (hit) out.latest = { title: hit.title, pageviews: (hit.stats && hit.stats.pageviews) || 0, url: hit.url };
  return songs.length || hit ? out : null;
}
export async function takeSnapshot(artistId, artistName, latestSong, prev) {
  const out = { at: new Date().toISOString() };
  const name = artistName || '';
  if (!name) return out;
  const key = process.env.LASTFM_API_KEY;
  const safe = (p) => p.catch(e => { console.error('snapshot source', e && e.message); return null; });
  const [lf, lfs, dz, yt, gn, charts] = await Promise.all([
    key ? safe(getJson(`https://ws.audioscrobbler.com/2.0/?api_key=${encodeURIComponent(key)}&format=json&autocorrect=1&artist=${encodeURIComponent(name)}&method=artist.getinfo`)) : null,
    key && latestSong ? safe(getJson(`https://ws.audioscrobbler.com/2.0/?api_key=${encodeURIComponent(key)}&format=json&autocorrect=1&artist=${encodeURIComponent(name)}&method=track.getinfo&track=${encodeURIComponent(latestSong)}`)) : null,
    safe(deezerSnapshot(name, latestSong)),
    safe(youtubeSnapshot(name, latestSong, prev)),
    safe(geniusSnapshot(name, latestSong)),
    safe(appleCharts()),
  ]);
  const st = lf && lf.artist && lf.artist.stats;
  if (st) out.lastfm = { listeners: Number(st.listeners) || 0, plays: Number(st.playcount) || 0 };
  const t = lfs && lfs.track;
  if (t && (t.listeners || t.playcount)) out.latest = { song: latestSong, listeners: Number(t.listeners) || 0, plays: Number(t.playcount) || 0 };
  if (dz) out.deezer = dz;
  if (yt) out.youtube = yt;
  if (gn) out.genius = gn;
  const onCharts = [];
  const me = squash(name);
  const credits = (a) => String(a || '').split(/,|&|\bfeat\.?|\bft\.?|\bx\b|\bwith\b/i).map(squash);   // "Drake & Future" -> ['drake','future']
  (charts || []).forEach(c => c.results.forEach(r => { if (me && credits(r.artist).includes(me)) onCharts.push({ country: c.cc.toUpperCase(), position: r.pos, song: r.song }); }));
  if (onCharts.length) out.apple_charts = onCharts.slice(0, 20);
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
  const n = (x) => Number(x || 0).toLocaleString('en-US');
  const diff = (a, b) => (b != null && a != null && a !== b) ? ` (${a > b ? '+' : '−'}${n(Math.abs(a - b))} this week)` : '';
  const L = snap && snap.lastfm, P = prev && prev.lastfm, S = snap && snap.latest && songMatch(snap.latest.song, rel.name) ? snap.latest : null;
  const Y = snap && snap.youtube, YP = prev && prev.youtube, G = snap && snap.genius && snap.genius.latest;
  const vid = Y && Y.videos && Y.videos.find(v => songMatch(v.title, rel.name));
  const lines = [];
  if (vid) lines.push(`YouTube: "${esc(vid.title)}" has <b>${n(vid.views)}</b> views`);
  if (S) lines.push(`Last.fm: <b>${n(S.listeners)}</b> listeners on "${esc(rel.name)}"`);
  if (G && songMatch(G.title, rel.name) && G.pageviews) lines.push(`Genius: <b>${n(G.pageviews)}</b> people read the lyrics`);
  if (snap && snap.apple_charts && snap.apple_charts.length) lines.push('Apple Music charts: ' + snap.apple_charts.slice(0, 3).map(c => `#${c.position} in ${esc(c.country)}`).join(', '));
  if (Y && Y.channel && Y.channel.subscribers != null) lines.push(`YouTube subscribers: <b>${n(Y.channel.subscribers)}</b>${diff(Y.channel.subscribers, YP && YP.channel && YP.channel.subscribers)}`);
  if (L) lines.push(`Last.fm listeners: <b>${n(L.listeners)}</b>${diff(L.listeners, P && P.listeners)}`);
  if (lines.length) trend = `<div style="background:#f1fbf8;border-radius:10px;padding:12px 14px;margin:12px 0;font-size:14px;line-height:1.7;">${lines.join('<br>')}</div>`;
  const html = shell(`
<div style="font-size:20px;font-weight:800;margin-bottom:6px;">"${esc(rel.name)}" has been out a week</div>
<div style="color:#444;">Time to see what's working. Take 2 minutes: screenshot your Spotify for Artists song page (and your distribution dashboard if you have one), and we'll tell you in plain words how it's doing, where it's hitting and your next move.</div>
${trend}
<div style="margin-top:12px;">${btn(s + '/app.html#report', 'Get my Report Card')}</div>`, uid);
  return { subject, html };
}
