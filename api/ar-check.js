import crypto from 'node:crypto';
import { checkAndCount, logGeneration, hasEarlyAccess } from './_usage.js';
import { LANES, lanesText } from './_lanes.js';

// A&R Check: drop a song in the Studio Assistant and get honest, encouraging feedback.
// The browser uploads the song to the private "mastering" bucket, then calls these steps in order
// (each one is short, so none of them hits Vercel's time limit):
//   POST { action: 'analyze', path, title?, artist?, genre?, city? } -> { metrics, token }   (uses 1 A&R check)
//   POST { action: 'lyrics',  token }                                 -> { text, first_vocal, language }
//   POST { action: 'listen',  token, genre?, refs? }                  -> { vibe }           (AI listens to the chorus)
//   POST { action: 'review',  token, metrics, lyrics, vibe, title, artist, genre, refs, city } -> { review }
// The artist's own genre and "sounds like" artists are the strongest signal; the lane map in _lanes.js
// (owned by the engineers) keeps the feedback in the right lane instead of defaulting to the biggest names.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY, MASTERING_URL, MASTERING_SECRET,
//      (optional) AR_LISTEN_MODEL (default gpt-audio-1.5), AR_PUBLIC=true to open it to everyone

export const config = { maxDuration: 60 };

const BUCKET = 'mastering';
const LISTEN_MODEL = process.env.AR_LISTEN_MODEL || 'gpt-audio-1.5';
const REVIEW_MODEL = process.env.AR_REVIEW_MODEL || 'gpt-4o';      // the writing model; gpt-4o writes stronger, more specific feedback
const NEXT_TOOLS = {
  master: 'Mastering (loud, clean, streaming-ready master)', checklist: 'Release Checklist (everything to do from 4 weeks out to release week)',
  plan: 'Release Planner (day-by-day rollout plan)', art: 'Cover Art', lyric: 'Lyric Videos (vertical clips for TikTok/Reels)',
  ads: 'Ad Generator (Meta ads)', distribute: 'Distribute with Stop One (free, keep 85%)',
};
// only the lanes that matter for this song, so the writer stays focused
function relevantLanes(vibe, genre, refs) {
  const want = new Set();
  const pick = n => { const l = LANES.find(x => x.name.toLowerCase() === String(n || '').toLowerCase()); if (l) want.add(l); };
  if (vibe) { pick(vibe.lane); pick(vibe.alt_lane); }
  const hay = (String(genre) + ' ' + String(refs)).toLowerCase();
  const words = new Set(hay.split(/[^a-z0-9$!.]+/).filter(w => w.length >= 4));
  LANES.forEach(l => {
    const named = l.artists.some(a => a.toLowerCase().split(/\s+/).some(w => w.length >= 4 && words.has(w)));
    if (named || hay.includes(l.name.toLowerCase().split(' /')[0])) want.add(l);
  });
  const list = [...want].slice(0, 5);
  return list.length ? list : LANES;
}
const env = () => ({ url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY });
const svc = (extra) => { const { key } = env(); return Object.assign({ apikey: key, Authorization: `Bearer ${key}` }, extra || {}); };

async function userFromToken(req) {
  const { url, key } = env();
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!url || !key || !token) return null;
  try {
    const r = await fetch(`${url}/auth/v1/user`, { headers: { apikey: key, Authorization: `Bearer ${token}` } });
    return r.ok ? await r.json() : null;
  } catch (e) { return null; }
}
async function enabledFor(user) {
  if (!user || !process.env.MASTERING_URL || !process.env.MASTERING_SECRET || !process.env.OPENAI_API_KEY) return false;
  if (String(process.env.AR_PUBLIC || process.env.CHAT_PUBLIC || '').toLowerCase() === 'true') return true;
  return await hasEarlyAccess(user.email);
}

// A short-lived pass that ties the later steps to the song this user analyzed
function sign(data) { return crypto.createHmac('sha256', process.env.MASTERING_SECRET).update(data).digest('hex').slice(0, 32); }
function makeToken(uid, base) { const exp = Date.now() + 30 * 60 * 1000; const d = `${uid}|${base}|${exp}`; return Buffer.from(`${d}|${sign(d)}`).toString('base64url'); }
function readToken(tok, uid) {
  try {
    const [u, base, exp, mac] = Buffer.from(String(tok || ''), 'base64url').toString().split('|');
    if (u !== uid || Number(exp) < Date.now() || sign(`${u}|${base}|${exp}`) !== mac) return null;
    return base;
  } catch (e) { return null; }
}

async function fetchFile(path) {
  const { url } = env();
  const r = await fetch(`${url}/storage/v1/object/${BUCKET}/${path}`, { headers: svc() });
  if (!r.ok) throw new Error('file ' + r.status);
  return Buffer.from(await r.arrayBuffer());
}
async function removeFiles(paths) {
  const { url } = env();
  try { await fetch(`${url}/storage/v1/object/${BUCKET}`, { method: 'DELETE', headers: svc({ 'Content-Type': 'application/json' }), body: JSON.stringify({ prefixes: paths }) }); } catch (e) {}
}
async function openai(body) {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: JSON.stringify(body),
  });
  const d = await r.json();
  if (d.error) throw new Error(d.error.message || 'openai');
  return d.choices[0].message.content || '';
}
const clip = (s, n) => String(s || '').slice(0, n);
const mmss = (t) => { t = Math.max(0, Math.round(Number(t) || 0)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };

export default async function handler(req, res) {
  const user = await userFromToken(req);
  if (req.method === 'GET') return res.status(200).json({ enabled: await enabledFor(user) });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!user) return res.status(401).json({ error: 'Please sign in first.' });
  if (!(await enabledFor(user))) return res.status(403).json({ error: 'A&R Check is coming soon.' });
  const body = req.body || {};

  // ---------- 1. measure the song (uses 1 A&R check) ----------
  if (body.action === 'analyze') {
    const p = String(body.path || '');
    if (!p.startsWith(user.id + '/') || p.includes('..') || p.length > 300) return res.status(400).json({ error: 'Upload your song first.' });
    const server = process.env.MASTERING_URL.replace(/\/$/, '');
    try {
      const hc = new AbortController(); const ht = setTimeout(() => hc.abort(), 10000);
      const up = await fetch(server + '/health', { signal: hc.signal }); clearTimeout(ht);
      if (!up.ok) throw new Error('health');
    } catch (e) { return res.status(503).json({ error: 'The Studio is warming up. Try again in a minute.' }); }

    const gate = await checkAndCount(req, 'ar_check');
    if (!gate.ok) return res.status(gate.status).json({ error: gate.error, plan: gate.plan || null });

    try {
      const r = await fetch(server + '/analyze', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-mastering-secret': process.env.MASTERING_SECRET },
        body: JSON.stringify({ path: p }),
      });
      const m = await r.json();
      if (!r.ok) return res.status(r.status === 422 ? 400 : 500).json({ error: (m && m.detail) || 'We couldn’t read that song. Try a WAV or MP3.' });
      const base = p.slice(0, p.lastIndexOf('/'));
      logGeneration(gate.userId, 'ar_check', { title: clip(body.title, 120), genre: clip(body.genre, 60) }, { duration: m.duration, lufs: m.loudness && m.loudness.lufs });
      return res.status(200).json({ metrics: m, token: makeToken(user.id, base) });
    } catch (e) {
      console.error('ar analyze', e);
      return res.status(500).json({ error: 'Something went wrong reading your song. Try again.' });
    }
  }

  const base = readToken(body.token, user.id);
  if (!base) return res.status(400).json({ error: 'That check expired. Drop the song again.' });

  // ---------- 2. lyrics (whole song, small mono copy) ----------
  if (body.action === 'lyrics') {
    try {
      const audio = await fetchFile(`${base}/voice.mp3`);
      const form = new FormData();
      form.append('file', new Blob([audio], { type: 'audio/mpeg' }), 'song.mp3');
      form.append('model', 'whisper-1');
      form.append('response_format', 'verbose_json');
      const r = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: form });
      const d = await r.json();
      if (d.error) throw new Error(d.error.message);
      const segs = (d.segments || []).filter(s => (s.text || '').trim().length > 1 && (s.no_speech_prob == null || s.no_speech_prob < 0.6));
      const text = segs.map(s => s.text.trim()).join('\n');
      return res.status(200).json({ text: clip(text, 6000), first_vocal: segs.length ? Math.round(segs[0].start) : null, language: d.language || null, instrumental: !segs.length });
    } catch (e) {
      console.error('ar lyrics', e);
      return res.status(200).json({ text: '', first_vocal: null, language: null, failed: true });
    }
  }

  // ---------- 3. the AI listens to the chorus ----------
  if (body.action === 'listen') {
    try {
      const audio = await fetchFile(`${base}/clip.mp3`);
      const out = await openai({
        model: LISTEN_MODEL, modalities: ['text'], temperature: 0.4,
        messages: [
          { role: 'system', content: 'You are an experienced A&R and producer with a precise ear for subgenres. You never lump a song into the biggest mainstream names when it belongs to a more specific lane. Answer with JSON only.' },
          { role: 'user', content: [
            { type: 'text', text: `Listen to this 30-second section (usually the chorus) of an independent artist's song.${clip(body.genre, 60) ? ' The artist describes it as: "' + clip(body.genre, 60) + '".' : ''}${clip(body.refs, 120) ? ' The artist says it sounds like: ' + clip(body.refs, 120) + '.' : ''}
Pick the closest lane from this LANE MAP (use the artist's description as a strong hint, then what you hear):
${lanesText()}
Return JSON: {"lane":"exact lane name from the map, or Other","lane_why":"what you hear that puts it there (production, vocals, tempo, mood)","alt_lane":"second closest lane","genre":"","mood":"","energy":"low|medium|high","vocals":"vocal style and delivery, or none","production":"key sounds you hear","sounds_like":["3-5 artists from the chosen lane, or the artist's own references"],"standout":"the strongest moment","concern":"one thing a producer would flag, or empty","confidence":"low|medium|high"}` },
            { type: 'input_audio', input_audio: { data: audio.toString('base64'), format: 'mp3' } },
          ] },
        ],
      });
      const m = out.match(/\{[\s\S]*\}/);
      return res.status(200).json({ vibe: m ? JSON.parse(m[0]) : null });
    } catch (e) {
      console.error('ar listen', e.message);
      return res.status(200).json({ vibe: null });           // the review still works from the measurements and lyrics
    }
  }

  // ---------- 4. research the lane + write the review ----------
  if (body.action === 'review') {
    const m = body.metrics || {}, vibe = body.vibe || null, lyr = body.lyrics || {};
    const title = clip(body.title, 120) || 'Untitled', artist = clip(body.artist, 80), givenGenre = clip(body.genre, 60), refs = clip(body.refs, 120), city = clip(body.city, 80);
    const genre = givenGenre || (vibe && vibe.genre) || '';
    const lane = vibe && vibe.lane && vibe.lane !== 'Other' ? LANES.find(l => l.name.toLowerCase() === String(vibe.lane).toLowerCase()) : null;
    let research = '';
    try {
      research = await openai({
        model: 'gpt-4o-mini-search-preview', web_search_options: { search_context_size: 'medium' },
        messages: [{ role: 'user', content: `Music marketing research for an independent ${givenGenre || (lane ? lane.name : genre) || 'artist'} song${refs ? ' that sounds like ' + refs : (lane ? ' in the ' + lane.name + ' lane (' + lane.artists.join(', ') + ')' : '')}${city ? ', artist based in ' + city : ''}${artist ? ' (artist: ' + artist + ')' : ''}. Focus on that exact lane and its scene, not mainstream hip-hop in general. Search the live web and give concise bullet notes on: who listens to this lane now (age, platforms), the cities and countries where it is strongest, the Spotify/Apple/YouTube playlists and curators that feature it, the TikTok/Reels trends and content formats working for it right now, and 2-3 independent artists in this lane growing fast. Be specific and current.` }],
      });
    } catch (e) { console.error('ar research', e.message); }

    const facts = {
      length: m.duration_text, loudness_lufs: m.loudness && m.loudness.lufs, true_peak: m.loudness && m.loudness.true_peak,
      tempo: m.tempo && m.tempo.reliable ? m.tempo.bpm + (m.tempo.also_could_be ? ` (or ${m.tempo.also_could_be})` : '') : 'unclear',
      key: m.key && m.key.reliable ? m.key.key : 'unclear',
      loudest_section_starts: m.structure && m.structure.chorus_text,
      intro_seconds_before_it_kicks_in: m.structure && m.structure.intro_seconds,
      first_vocal_at: lyr.first_vocal != null ? mmss(lyr.first_vocal) : 'unknown',
      measured_mix_notes: (m.notes || []).map(n => `${n.level.toUpperCase()}: ${n.title}. ${n.detail}`),
    };
    const prompt = `Song: "${title}"${artist ? ' by ' + artist : ''}. Genre the artist gave: ${givenGenre || 'not given'}. Artists the artist says it sounds like: ${refs || 'not given'}. City: ${city || 'not given'}.

LANES TO CHOOSE FROM (from our studio team's lane map):
${relevantLanes(vibe, givenGenre, refs).map(l => `- ${l.name}: ${l.sound}. Artists: ${l.artists.join(', ')}`).join('\n')}

MEASURED (from our analysis of the actual audio; trust these):
${JSON.stringify(facts, null, 1)}

WHAT OUR AI HEARD IN THE CHORUS${vibe ? ' (an opinion, usually right about genre and mood):\n' + JSON.stringify(vibe) : ': not available, so do not describe the sound beyond the measurements, lyrics and the genre the artist gave.'}

LYRICS (auto-transcribed, may contain small errors)${lyr.text ? ':\n' + clip(lyr.text, 3500) : ': none detected (instrumental, or the vocal could not be read).'}

MARKET RESEARCH (live web):
${clip(research, 3500) || 'not available'}

Write the A&R Check. Return JSON only:
{
 "headline": "one sentence overall take, warm but honest",
 "readiness": "ready | almost | needs_work",
 "readiness_reason": "one sentence on release readiness (mix, arrangement), based on the measurements",
 "working": ["3 specific things that are working"],
 "fix_first": [{"title":"", "why":"", "how":"a concrete fix"}],
 "hook": {"chorus_at":"m:ss", "first_vocal_at":"m:ss or empty", "tiktok_clip":{"start":"m:ss","end":"m:ss","why":""}, "intro_advice":""},
 "lyrics": {"themes":[""], "standout_lines":["up to 2 short lines quoted from the lyrics"], "language":"", "explicit":true/false, "note":""},
 "sound": {"lane":"exact lane name from the lanes above", "genre":"", "mood":"", "why":"what puts it in this lane", "sounds_like":["3-5 artists from that lane or the artist's own references"]},
 "lane_question": "if you are not sure between two lanes, one short question to confirm with the artist (e.g. \"Is this closer to rage or plugg?\"), otherwise empty",
 "audience": {"who":"", "cities":["up to 5"], "platforms":[{"name":"","why":""}], "playlists":["up to 5 playlist or curator types/names"]},
 "promo": ["5 specific promotion steps for this song, ordered"],
 "next_moves": [{"tool":"one of: master, checklist, plan, art, lyric, ads, distribute", "why":"one short line on why this is the right next step for THIS song"}]
}
TOOLS for next_moves (pick the 3 that matter most for this song, in order): ${Object.entries(NEXT_TOOLS).map(([k, v]) => k + ' = ' + v).join('; ')}. If it is not mastered, master comes first. If it is almost or fully ready, include checklist so nothing gets missed before release. Only include distribute if it is ready or almost ready.
VOICE: talk to the artist like a respected A&R in the room right after hearing the record. Direct, confident, vivid. Lead with what makes this song special. Use its real details: quote the lyrics, name the moment (m:ss), describe the sound. Short, punchy sentences. Encouraging because it's earned, honest because you want them to win. No filler, nothing generic that could apply to any song.
LANE: the artist's own genre and "sounds like" artists are the strongest signal; pick the most specific lane above that fits them and what the AI heard. "sounds_like" comes from that lane or the artist's references. Don't fall back to the biggest mainstream names unless that really is the lane. Audience, cities, playlists and promo fit that lane's scene. If unsure between two lanes, ask in lane_question.
RULES: 0-3 items in fix_first, most important first, using the measured mix notes (if it isn't mastered yet, say so and point to mastering). Never give a score or predict streams or a hit. If lyrics are empty, say so in lyrics.note and leave the other lyric fields empty.`;
    try {
      const out = await openai({
        model: REVIEW_MODEL, temperature: 0.75, response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'You are the A&R voice of StudioSound: a seasoned A&R with a great ear who has broken independent artists. You talk straight, get specific, and make artists feel heard. You never invent facts about the artist. JSON only.' },
          { role: 'user', content: prompt },
        ],
      });
      const review = JSON.parse(out);
      removeFiles([`${base}/clip.mp3`, `${base}/voice.mp3`]);
      return res.status(200).json({ review });
    } catch (e) {
      console.error('ar review', e);
      return res.status(500).json({ error: 'Couldn’t write the review. Try again.' });
    }
  }

  return res.status(400).json({ error: 'Unknown action' });
}
