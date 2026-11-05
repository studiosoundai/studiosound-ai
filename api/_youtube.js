// api/_youtube.js — "Connect YouTube": Google sign-in, the locked key, and the weekly YouTube Studio numbers.
// Used by youtube-connect.js (sign-in, status) and cron-release-watch.js (weekly pull).
// Env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, YT_TOKEN_KEY (optional; falls back to the Supabase service key),
//      SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Only reads (scopes: yt-analytics.readonly, youtube.readonly). We never post, edit or delete anything on YouTube.
import crypto from 'node:crypto';
import { db } from './_watch.js';

export const SCOPES = ['https://www.googleapis.com/auth/yt-analytics.readonly', 'https://www.googleapis.com/auth/youtube.readonly'];
export const googleReady = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
export const baseUrl = (req) => 'https://' + String(req.headers['x-forwarded-host'] || req.headers.host || 'studiosound.ai').split(',')[0].trim();
export const redirectUri = (req) => baseUrl(req) + '/api/youtube-connect';

// ---------- the locked key (AES-256-GCM) ----------
const keyBytes = () => crypto.createHash('sha256').update('yt|' + (process.env.YT_TOKEN_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '')).digest();
export function lock(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', keyBytes(), iv);
  const enc = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return 'v1.' + iv.toString('base64url') + '.' + c.getAuthTag().toString('base64url') + '.' + enc.toString('base64url');
}
export function unlock(s) {
  const [v, iv, tag, enc] = String(s || '').split('.');
  if (v !== 'v1') throw new Error('bad key');
  const d = crypto.createDecipheriv('aes-256-gcm', keyBytes(), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(enc, 'base64url')), d.final()]).toString('utf8');
}

// ---------- signed "state" so the Google callback knows which account started it ----------
const sig = (s) => crypto.createHmac('sha256', keyBytes()).update('state|' + s).digest('base64url').slice(0, 32);
export function makeState(uid) {
  const body = Buffer.from(JSON.stringify({ u: uid, e: Date.now() + 15 * 60 * 1000, n: crypto.randomBytes(6).toString('hex') })).toString('base64url');
  return body + '.' + sig(body);
}
export function readState(state) {
  const [body, s] = String(state || '').split('.');
  if (!body || !s || sig(body) !== s) return null;
  try { const d = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); return d.e > Date.now() ? d.u : null; } catch (e) { return null; }
}
export function authUrl(req, uid) {
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID, redirect_uri: redirectUri(req), response_type: 'code',
    scope: SCOPES.join(' '), access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state: makeState(uid),
  });
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + p.toString();
}

// ---------- Google tokens ----------
async function tokenCall(params) {
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params).toString() });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(d.error || ('token ' + r.status)); e.code = d.error; throw e; }
  return d;
}
export const exchangeCode = (req, code) => tokenCall({ code, client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, redirect_uri: redirectUri(req), grant_type: 'authorization_code' });
export const refreshAccess = (refresh) => tokenCall({ refresh_token: refresh, client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, grant_type: 'refresh_token' });
export async function revoke(token) { try { await fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(token), { method: 'POST' }); } catch (e) {} }

async function gget(url, access) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), 6500);
  try {
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + access }, signal: c.signal });
    const d = await r.json().catch(() => null);
    return r.ok ? d : null;
  } catch (e) { return null; } finally { clearTimeout(t); }
}
export async function myChannel(access) {
  const d = await gget('https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,contentDetails&mine=true', access);
  const ch = d && d.items && d.items[0];
  return ch ? { id: ch.id, title: ch.snippet.title, image: ch.snippet.thumbnails && (ch.snippet.thumbnails.default || {}).url, subscribers: Number(ch.statistics.subscriberCount) || 0, views: Number(ch.statistics.viewCount) || 0 } : null;
}

// ---------- the weekly YouTube Studio numbers ----------
const day = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const TRAFFIC = {
  YT_SEARCH: 'YouTube search', SHORTS: 'Shorts feed', SUGGESTED: 'Suggested videos (next to other videos)', BROWSE: 'Home page and subscriptions',
  EXT_URL: 'Links from other sites and apps', PLAYLIST: 'Playlists', YT_CHANNEL: 'Your channel page', NOTIFICATION: 'Notifications',
  SUBSCRIBER: 'Subscribers', END_SCREEN: 'End screens', NO_LINK_OTHER: 'Direct or unknown', NO_LINK_EMBEDDED: 'Embedded players',
  YT_OTHER_PAGE: 'Other YouTube pages', ANNOTATION: 'Cards', CAMPAIGN_CARD: 'Campaign cards', HASHTAGS: 'Hashtag pages', SOUND_PAGE: 'Sound pages (videos using your sound)',
  RELATED_VIDEO: 'Related videos', LIVE_REDIRECT: 'Live redirects', VIDEO_REMIXES: 'Remixes of your videos', ADVERTISING: 'YouTube ads', PRODUCT_PAGE: 'Product pages', IMMERSIVE_LIVE: 'Live',
};
const rows = (d) => (d && Array.isArray(d.rows)) ? d.rows : [];
function iso8601Seconds(s) { const m = String(s || '').match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/); return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : null; }
const mmss = (t) => { t = Math.max(0, Math.round(t)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };

export async function pullStudio(access) {
  const A = 'https://youtubeanalytics.googleapis.com/v2/reports?ids=channel%3D%3DMINE';
  const end = day(3), start7 = day(9), prevEnd = day(10), prevStart = day(16), start28 = day(30);   // YouTube's numbers settle about 3 days late
  const q = (p) => gget(A + '&' + new URLSearchParams(p).toString(), access);
  const TOT = 'views,estimatedMinutesWatched,averageViewDuration,subscribersGained,subscribersLost,likes,comments,shares';
  const [w, pw, traffic, countries, cities, types, demo, vids] = await Promise.all([
    q({ startDate: start7, endDate: end, metrics: TOT }),
    q({ startDate: prevStart, endDate: prevEnd, metrics: TOT }),
    q({ startDate: start28, endDate: end, metrics: 'views', dimensions: 'insightTrafficSourceType', sort: '-views' }),
    q({ startDate: start28, endDate: end, metrics: 'views,estimatedMinutesWatched', dimensions: 'country', sort: '-views', maxResults: '10' }),
    q({ startDate: start28, endDate: end, metrics: 'views', dimensions: 'city', sort: '-views', maxResults: '10' }),
    q({ startDate: start28, endDate: end, metrics: 'views,subscribersGained', dimensions: 'creatorContentType' }),
    q({ startDate: start28, endDate: end, metrics: 'viewerPercentage', dimensions: 'ageGroup,gender' }),
    q({ startDate: start28, endDate: end, metrics: 'views,estimatedMinutesWatched,averageViewPercentage,subscribersGained', dimensions: 'video', sort: '-views', maxResults: '8' }),
  ]);
  const tot = (d) => { const r = rows(d)[0]; if (!r) return null; const [views, minutes, avgDur, subsG, subsL, likes, comments, shares] = r; return { views, watch_hours: Math.round(minutes / 60), avg_view_seconds: Math.round(avgDur), subscribers_gained: subsG, subscribers_lost: subsL, likes, comments, shares }; };
  const out = { period: { week: [start7, end], month: [start28, end] }, week: tot(w), prev_week: tot(pw) };
  const tr = rows(traffic); const trTotal = tr.reduce((n, r) => n + (r[1] || 0), 0) || 1;
  out.traffic = tr.slice(0, 6).map(r => ({ source: TRAFFIC[r[0]] || String(r[0]).replace(/_/g, ' ').toLowerCase(), views: r[1], share: Math.round(r[1] / trTotal * 100) }));
  out.countries = rows(countries).map(r => ({ country: r[0], views: r[1], watch_hours: Math.round((r[2] || 0) / 60) }));
  out.cities = rows(cities).map(r => ({ city: r[0], views: r[1] }));
  const ty = rows(types); const tyTotal = ty.reduce((n, r) => n + (r[1] || 0), 0) || 1;
  out.formats = ty.map(r => ({ type: r[0] === 'SHORTS' ? 'Shorts' : r[0] === 'VIDEO_ON_DEMAND' ? 'Long videos' : r[0] === 'LIVE_STREAM' ? 'Live' : String(r[0]).toLowerCase(), views: r[1], share: Math.round(r[1] / tyTotal * 100), subscribers_gained: r[2] }));
  out.audience = rows(demo).sort((a, b) => b[2] - a[2]).slice(0, 4).map(r => ({ age: String(r[0]).replace('age', '').replace('-', '–'), gender: String(r[1]).toLowerCase(), share: Math.round(r[2]) }));

  // top videos, with titles and length, and where viewers stop watching on the top one
  const vr = rows(vids);
  if (vr.length) {
    const info = await gget('https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id=' + vr.map(r => r[0]).join(','), access);
    const meta = {}; ((info && info.items) || []).forEach(v => { meta[v.id] = { title: v.snippet.title, seconds: iso8601Seconds(v.contentDetails.duration) }; });
    out.top_videos = vr.map(r => ({ id: r[0], title: (meta[r[0]] || {}).title || r[0], seconds: (meta[r[0]] || {}).seconds, views: r[1], watch_hours: Math.round((r[2] || 0) / 60), avg_percent_watched: Math.round(r[3] || 0), subscribers_gained: r[4] }));
    const top = out.top_videos.find(v => v.seconds && v.seconds > 20) || null;
    if (top) {
      const ret = await q({ startDate: start28, endDate: end, metrics: 'audienceWatchRatio', dimensions: 'elapsedVideoTimeRatio', filters: 'video==' + top.id });
      const pts = rows(ret).map(r => ({ at: r[0], ratio: r[1] })).sort((a, b) => a.at - b.at);
      if (pts.length > 5) {
        const half = pts.find(p => p.ratio < 0.5);
        let drop = { at: 0, by: 0 };
        for (let i = 1; i < pts.length && pts[i].at <= 0.4; i++) { const d = pts[i - 1].ratio - pts[i].ratio; if (d > drop.by) drop = { at: pts[i].at, by: d }; }
        const pick = (x) => { const p = pts.reduce((b, c) => Math.abs(c.at - x) < Math.abs(b.at - x) ? c : b); return Math.round(p.ratio * 100); };
        out.retention = {
          video: top.title, seconds: top.seconds,
          still_watching: { at_10pct: pick(0.1), at_25pct: pick(0.25), at_50pct: pick(0.5), at_75pct: pick(0.75) },
          half_gone_at: half ? mmss(half.at * top.seconds) : null,
          biggest_early_drop_at: drop.by > 0.05 ? mmss(drop.at * top.seconds) : null,
        };
      }
    }
  }
  return out;
}

// connect / weekly: get a fresh access key, pull, save. Marks 'reconnect' when Google says the connection ended.
export async function pullAndSave(uid) {
  const link = (await db(`youtube_links?user_id=eq.${uid}&select=refresh_token`))[0];
  if (!link) return null;
  let access;
  try { access = (await refreshAccess(unlock(link.refresh_token))).access_token; }
  catch (e) {
    await db(`youtube_links?user_id=eq.${uid}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: { last_error: e.code === 'invalid_grant' ? 'reconnect' : String(e.message || e).slice(0, 120), last_pull_at: new Date().toISOString() } });
    return null;
  }
  const ch = await myChannel(access);
  const data = await pullStudio(access);
  if (ch) data.channel = ch;
  await db('youtube_snapshots?on_conflict=user_id,taken_on', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: { user_id: uid, taken_on: new Date().toISOString().slice(0, 10), data } });
  await db(`youtube_links?user_id=eq.${uid}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: Object.assign({ last_error: null, last_pull_at: new Date().toISOString() }, ch ? { channel_id: ch.id, channel_title: ch.title, channel_image: ch.image } : {}) });
  return data;
}
