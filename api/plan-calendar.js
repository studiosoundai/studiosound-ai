import crypto from 'node:crypto';
import { resolveAccount } from './_usage.js';

// Release plan -> calendar
// POST { id }            (signed in)  -> { url }   a private calendar link for that saved plan (used for Google Calendar)
// GET  ?id=&k=           (no login)   -> the plan as an .ics calendar (Google, Apple and Outlook can subscribe to it)
// The link is signed, so only someone the artist gives it to can open it.

const env = () => ({ url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY });
const svc = () => { const { key } = env(); return { apikey: key, Authorization: `Bearer ${key}` }; };
const secret = () => process.env.CALENDAR_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const sign = (id) => crypto.createHmac('sha256', secret()).update('plan-cal|' + id).digest('base64url').slice(0, 32);
const ID = /^[0-9a-z-]{1,40}$/i;

async function getAsset(id) {
  const { url } = env();
  const r = await fetch(`${url}/rest/v1/assets?id=eq.${encodeURIComponent(id)}&select=id,user_id,name,tool,data`, { headers: svc() });
  const rows = r.ok ? await r.json() : [];
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

// ---- shared by the Studio (browser) and api/plan-calendar.js: release plan steps -> dated calendar events ----
function pcAddDays(iso, n) { return new Date(new Date(iso + 'T12:00:00Z').getTime() + n * 86400000).toISOString().slice(0, 10); }
// a step's date: the exact date we stored, or a best guess from the words ("2 weeks out", "Release day", "Nov 14")
function pcGuessIso(it, rel) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(it.iso || ''))) return it.iso;
  const d = parseInt(it.days_from_release, 10);
  if (rel && Number.isFinite(d)) return pcAddDays(rel, d);
  const s = String(it.date || '').toLowerCase();
  const iso = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[0];
  if (!rel) return null;
  if (/release day|day of release|drop day|launch day|release date|out today|^day 0|d-?day/.test(s)) return rel;
  let m;
  if ((m = s.match(/(\d+)\s*(weeks?|wks?)\s*(out|before|prior|pre|to go|until)/))) return pcAddDays(rel, -7 * m[1]);
  if ((m = s.match(/(\d+)\s*days?\s*(out|before|prior|pre|to go|until)/))) return pcAddDays(rel, -m[1]);
  if ((m = s.match(/(\d+)\s*(weeks?|wks?)\s*(after|post|later)/))) return pcAddDays(rel, 7 * m[1]);
  if ((m = s.match(/(\d+)\s*days?\s*(after|post|later)/))) return pcAddDays(rel, +m[1]);
  if (/(a|one)\s*week\s*(after|post|later)|week after/.test(s)) return pcAddDays(rel, 7);
  if (/(a|one)\s*week\s*(out|before|prior)|week before/.test(s)) return pcAddDays(rel, -7);
  if (/day after/.test(s)) return pcAddDays(rel, 1);
  if (/day before/.test(s)) return pcAddDays(rel, -1);
  if ((m = s.match(/(?:day|d)\s*([+-]\s*\d+)/))) return pcAddDays(rel, parseInt(m[1].replace(/\s/g, ''), 10));
  const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  if ((m = s.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/)) || (m = s.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/))) {
    const mon = MON.indexOf(isNaN(m[1]) ? m[1] : m[2]), day = parseInt(isNaN(m[1]) ? m[2] : m[1], 10);
    let y = parseInt(rel.slice(0, 4), 10);
    const mk = (yy) => yy + '-' + String(mon + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    let g = mk(y);
    const diff = (new Date(g) - new Date(rel)) / 86400000;
    if (diff > 180) g = mk(y - 1); else if (diff < -180) g = mk(y + 1);
    if (day >= 1 && day <= 31) return g;
  }
  if ((m = s.match(/\b(\d{1,2})\/(\d{1,2})\b/))) {
    let y = parseInt(rel.slice(0, 4), 10);
    const g = y + '-' + String(m[1]).padStart(2, '0') + '-' + String(m[2]).padStart(2, '0');
    if (!isNaN(new Date(g))) return g;
  }
  return null;
}
function pcEvents(data, rel) {
  rel = /^\d{4}-\d{2}-\d{2}$/.test(String(rel || '')) ? rel : null;
  const items = Array.isArray(data && data.timeline) ? data.timeline : [];
  const out = [];
  let last = rel ? pcAddDays(rel, -29) : null;
  items.forEach(it => {
    let iso = pcGuessIso(it, rel);
    if (!iso && last) iso = pcAddDays(last, 1);       // no date we can read: the day after the step before it
    if (!iso) return;
    last = iso;
    out.push({ iso, title: String(it.task || 'Release step').trim(), detail: String(it.detail || '').trim(), tool: String(it.tool || '').trim() || pcToolFor(it) });
  });
  if (rel && !out.some(e => e.iso === rel)) out.push({ iso: rel, title: 'Release day', detail: 'Your song is out today. Share it everywhere and keep posting.', tool: 'ads' });
  return out.sort((a, b) => a.iso.localeCompare(b.iso));
}
// older plans don't say which tool fits a step: match it by its words
function pcToolFor(it) {
  const s = (String(it.task || '') + ' ' + String(it.detail || '')).toLowerCase();
  if (/cover|artwork|album art/.test(s)) return 'art';
  if (/lyric video|visualizer|canvas/.test(s)) return 'lyric';
  if (/\bads?\b|boost|promote|campaign|meta ads|tiktok ads|spark/.test(s)) return 'ads';
  if (/master/.test(s)) return 'master';
  if (/distribut|upload|metadata|isrc|pitch|spotify for artists|checklist/.test(s)) return 'check';
  if (/merch|t-shirt|hoodie/.test(s)) return 'merch';
  if (/snippet|teaser|clip|sound/.test(s)) return 'trim';
  return 'plan';
}
function pcEsc(t) { return String(t == null ? '' : t).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n'); }
// calendar lines may be at most 75 bytes: wrap long ones without splitting a character
function pcFold(line) {
  const out = []; let cur = '', bytes = 0;
  for (const ch of line) {
    const b = unescape(encodeURIComponent(ch)).length;
    if (bytes + b > 74) { out.push(cur); cur = ' '; bytes = 1; }
    cur += ch; bytes += b;
  }
  out.push(cur);
  return out.join('\r\n');
}
function pcIcs(name, events, base, uidSeed) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//StudioSound//Release Plan//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    pcFold('X-WR-CALNAME:' + pcEsc((name || 'My release') + ' release plan'))];
  const seed = String(uidSeed || name || 'plan').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
  events.forEach((e, i) => {
    const link = base + '/app.html#' + (e.tool || 'plan');
    L.push('BEGIN:VEVENT', 'UID:' + seed + '-' + e.iso + '-' + i + '@studiosound', 'DTSTAMP:' + stamp,
      'DTSTART;VALUE=DATE:' + e.iso.replace(/-/g, ''), 'DTEND;VALUE=DATE:' + pcAddDays(e.iso, 1).replace(/-/g, ''),
      pcFold('SUMMARY:' + pcEsc('🎵 ' + e.title)),
      pcFold('DESCRIPTION:' + pcEsc(e.detail + '\n\nDo it in StudioSound: ' + link)),
      pcFold('URL:' + link),
      'BEGIN:VALARM', 'ACTION:DISPLAY', pcFold('DESCRIPTION:' + pcEsc(e.title)), 'TRIGGER:PT9H', 'END:VALARM',
      'END:VEVENT');
  });
  L.push('END:VCALENDAR');
  return L.join('\r\n') + '\r\n';
}

export default async function handler(req, res) {
  const base = 'https://' + (req.headers['x-forwarded-host'] || req.headers.host || 'studiosound.ai');

  if (req.method === 'GET') {
    const id = String((req.query && req.query.id) || ''), k = String((req.query && req.query.k) || '');
    if (!ID.test(id) || !k || k !== sign(id)) return res.status(404).send('Not found');
    const a = await getAsset(id);
    if (!a || a.tool !== 'Release Plan' || !a.data) return res.status(404).send('Not found');
    const rel = a.data.release_date || (a.data._inputs && a.data._inputs.releaseDate);
    const ics = pcIcs(a.name, pcEvents(a.data, rel), base, 'plan-' + id);
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="release-plan.ics"');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.status(200).send(ics);
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const acct = await resolveAccount(req);
  if (!acct.ok) return res.status(acct.status).json({ error: acct.message || acct.error });
  const id = String((req.body && req.body.id) || '');
  if (!ID.test(id)) return res.status(400).json({ error: 'Save the plan first.' });
  const a = await getAsset(id);
  if (!a || a.user_id !== acct.accountId || a.tool !== 'Release Plan') return res.status(404).json({ error: 'Plan not found.' });
  return res.status(200).json({ url: base + '/api/plan-calendar?id=' + encodeURIComponent(id) + '&k=' + sign(id) });
}
