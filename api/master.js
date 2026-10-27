import { checkAndCount, logGeneration } from './_usage.js';

// AI Mastering
// POST { action: 'start', input_path, reference_path?, style, loudness, file_name }  -> { job }
// GET  (no job)                                                                    -> { enabled }
// GET  ?job=<id>                                                                    -> { status, metrics, preview_url, downloaded, error }
// POST { action: 'download', job }                                                 -> { url }   (uses 1 master the first time)
// The song itself is uploaded by the browser straight to Supabase Storage (bucket "mastering"),
// because WAV files are far bigger than Vercel allows in a request. The mastering server does the audio work.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MASTERING_URL, MASTERING_SECRET
// Rollout: only founder accounts (FOUNDER_EMAILS) see AI Mastering until MASTERING_PUBLIC=true in Vercel.

const STYLES = ['balanced', 'warm', 'punchy', 'open', 'vocal'];
const LOUDNESS = ['streaming', 'standard', 'loud'];
const BUCKET = 'mastering';

function env() {
  return { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
}
function svc(extra) {
  const { key } = env();
  return Object.assign({ apikey: key, Authorization: `Bearer ${key}` }, extra || {});
}
async function userFromToken(req) {
  const { url, key } = env();
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!url || !key || !token) return null;
  try {
    const r = await fetch(`${url}/auth/v1/user`, { headers: { apikey: key, Authorization: `Bearer ${token}` } });
    return r.ok ? await r.json() : null;
  } catch (e) { return null; }
}
async function getJob(id, userId) {
  const { url } = env();
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) return null;
  const r = await fetch(`${url}/rest/v1/master_jobs?id=eq.${id}&user_id=eq.${userId}&select=*`, { headers: svc() });
  const rows = await r.json();
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}
async function sign(path, seconds, download) {
  const { url } = env();
  const r = await fetch(`${url}/storage/v1/object/sign/${BUCKET}/${path}`, {
    method: 'POST', headers: svc({ 'Content-Type': 'application/json' }), body: JSON.stringify({ expiresIn: seconds }),
  });
  const j = await r.json();
  if (!j || !j.signedURL) return null;
  return `${url}/storage/v1${j.signedURL}` + (download ? `&download=${encodeURIComponent(download)}` : '');
}
function masteringEnabledFor(user) {
  if (!user || !process.env.MASTERING_URL || !process.env.MASTERING_SECRET) return false;
  if (String(process.env.MASTERING_PUBLIC || '').toLowerCase() === 'true') return true;
  const founders = (process.env.FOUNDER_EMAILS || '').toLowerCase().split(',').map(x => x.trim()).filter(Boolean);
  return founders.includes(String(user.email || '').toLowerCase());
}
const safePath = (p, uid) => typeof p === 'string' && p.startsWith(uid + '/') && !p.includes('..') && p.length < 300;

export default async function handler(req, res) {
  const user = await userFromToken(req);
  if (req.method === 'GET' && !(req.query && req.query.job)) return res.status(200).json({ enabled: masteringEnabledFor(user) });
  if (!user) return res.status(401).json({ error: 'Please sign in to use AI Mastering.' });
  const { url } = env();

  // ---------- status ----------
  if (req.method === 'GET') {
    const job = await getJob(req.query && req.query.job, user.id);
    if (!job) return res.status(404).json({ error: 'Not found' });
    const out = { status: job.status, metrics: job.metrics || null, downloaded: job.downloaded, error: job.error || null, style: job.style, loudness: job.loudness };
    if (job.status === 'done' && job.preview_path && !job.purged) out.preview_url = await sign(job.preview_path, 3600);
    if (job.purged) out.error = 'This master has expired. Files are kept for 14 days; master the song again.';
    return res.status(200).json(out);
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const body = req.body || {};

  // ---------- start a master (makes a free preview) ----------
  if (body.action === 'start') {
    if (!masteringEnabledFor(user)) return res.status(403).json({ error: 'AI Mastering is coming soon.' });
    if (!safePath(body.input_path, user.id)) return res.status(400).json({ error: 'Upload your song first.' });
    if (body.reference_path && !safePath(body.reference_path, user.id)) return res.status(400).json({ error: 'Upload the reference song again.' });

    // make sure the mastering server is up before using one of the artist's previews
    try {
      const hc = new AbortController(); const ht = setTimeout(() => hc.abort(), 10000);
      const up = await fetch(process.env.MASTERING_URL.replace(/\/$/, '') + '/health', { signal: hc.signal });
      clearTimeout(ht);
      if (!up.ok) throw new Error('health ' + up.status);
    } catch (e) {
      return res.status(503).json({ error: 'The mastering server is waking up. Try again in a minute.' });
    }

    const gate = await checkAndCount(req, 'master_preview');
    if (!gate.ok) return res.status(gate.status).json({ error: gate.error, plan: gate.plan || null });

    const row = {
      user_id: user.id,
      status: 'queued',
      style: STYLES.includes(body.style) ? body.style : 'balanced',
      loudness: LOUDNESS.includes(body.loudness) ? body.loudness : 'standard',
      file_name: String(body.file_name || 'song').slice(0, 120),
      input_path: body.input_path,
      reference_path: body.reference_path || null,
    };
    const ins = await fetch(`${url}/rest/v1/master_jobs`, {
      method: 'POST', headers: svc({ 'Content-Type': 'application/json', Prefer: 'return=representation' }), body: JSON.stringify(row),
    });
    const created = await ins.json();
    const job = Array.isArray(created) ? created[0] : null;
    if (!job) return res.status(500).json({ error: 'Couldn\'t start mastering. Try again.' });

    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 15000);
      const r = await fetch(process.env.MASTERING_URL.replace(/\/$/, '') + '/jobs', {
        method: 'POST', signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json', 'x-mastering-secret': process.env.MASTERING_SECRET },
        body: JSON.stringify({ job_id: job.id }),
      });
      clearTimeout(t);
      if (!r.ok) throw new Error('server ' + r.status);
    } catch (e) {
      console.error('mastering server', e);
      await fetch(`${url}/rest/v1/master_jobs?id=eq.${job.id}`, {
        method: 'PATCH', headers: svc({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ status: 'failed', error: 'The mastering server is waking up. Try again in a minute.' }),
      });
      return res.status(503).json({ error: 'The mastering server is waking up. Try again in a minute.', job: job.id });
    }
    logGeneration(gate.userId, 'master_preview', { style: row.style, loudness: row.loudness, reference: !!row.reference_path }, { job: job.id });
    return res.status(200).json({ job: job.id });
  }

  // ---------- download the full master (uses 1 master the first time) ----------
  if (body.action === 'download') {
    const job = await getJob(body.job, user.id);
    if (!job || job.status !== 'done' || !job.master_path) return res.status(404).json({ error: 'That master isn\'t ready.' });
    if (job.purged) return res.status(410).json({ error: 'This master has expired. Files are kept for 14 days; master the song again.' });
    if (!job.downloaded) {
      const gate = await checkAndCount(req, 'mastering');
      if (!gate.ok) return res.status(gate.status).json({ error: gate.error, plan: gate.plan || null });
      await fetch(`${url}/rest/v1/master_jobs?id=eq.${job.id}`, {
        method: 'PATCH', headers: svc({ 'Content-Type': 'application/json' }), body: JSON.stringify({ downloaded: true }),
      });
      logGeneration(gate.userId, 'mastering', { job: job.id, style: job.style, loudness: job.loudness }, job.metrics || {});
    }
    const base = String(job.file_name || 'song').replace(/\.[^.]+$/, '').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'song';
    const link = await sign(job.master_path, 3600, `${base}-mastered.wav`);
    if (!link) return res.status(500).json({ error: 'Couldn\'t create the download. Try again.' });
    return res.status(200).json({ url: link });
  }

  return res.status(400).json({ error: 'Unknown action' });
}
