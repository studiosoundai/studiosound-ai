import { checkAndCount, logGeneration, hasEarlyAccess, accountUser } from './_usage.js';

// Song Report Card: "how is my song doing?" in plain words, with the next move.
// GET                                   -> { enabled }
// POST { title, artist, images: [dataURL], files: [{ name, text }], notes?, previous? }
//   images: screenshots (Spotify for Artists, the Distribution Dashboard, Apple Music for Artists, TikTok...)
//   files:  CSV text the artist downloaded (Spotify for Artists' download button)
//   previous: the numbers from their last report card for this song, so we can say what changed
//   -> { card, metrics }      (uses 1 report card)
// Step 1 reads the numbers off the screens. Step 2 turns them into the report card.
// Rollout: founders and Staff see it until REPORT_PUBLIC=true in Vercel.
// Env: OPENAI_API_KEY, REPORT_MODEL (optional, default gpt-4o)

const MODEL = process.env.REPORT_MODEL || 'gpt-4o';
const TOOLS = ['ads', 'lyric', 'art', 'plan', 'master', 'trim', 'merch', 'check', 'forecast', 'distribute'];
const clip = (s, n) => String(s == null ? '' : s).slice(0, n);

async function enabledFor(user) {
  if (!user || user.denied || !process.env.OPENAI_API_KEY) return false;
  if (String(process.env.REPORT_PUBLIC || '').toLowerCase() === 'true') return true;
  return (await hasEarlyAccess(user.email)) || (!!user.actor_email && await hasEarlyAccess(user.actor_email));
}

async function ai(messages, maxTokens) {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.OPENAI_API_KEY },
    body: JSON.stringify({ model: MODEL, response_format: { type: 'json_object' }, temperature: 0.4, max_tokens: maxTokens, messages }),
  });
  const d = await r.json();
  if (d.error) throw new Error(d.error.message || 'AI error');
  return JSON.parse(String(d.choices[0].message.content || '{}').replace(/```json|```/g, '').trim());
}

const EXTRACT = `You read music analytics screenshots and exports (Spotify for Artists, Apple Music for Artists, YouTube Studio, TikTok, the Distribution Dashboard and other distributor dashboards that show streams by platform, Shazams and views where the song is used as a sound).
Copy ONLY numbers you can actually see. In a table of many tracks, read only the row for this song (match the title; ignore other songs with similar names).
Mark the scope of every number: a song page or that song's row is "song"; an artist profile page is "artist"; a dashboard covering a whole account or catalog (many tracks or artists) is "account". Cities and countries need the same care: a song page's Location tab is the song; a dashboard overview's cities are the whole account. Never guess or fill in a number that isn't shown. Keep the period each number covers (for example "last 7 days", "last 28 days", "1 month").
If a number has a change next to it (like ↑13.0% or -1.6%), put it in change_pct as a number (13.0 or -1.6).
Return JSON:
{
  "sources": ["which dashboards these came from, e.g. Spotify for Artists, Distribution Dashboard"],
  "period": "the main period the numbers cover",
  "scope": "song | artist | catalog (whether these numbers are for one song, the whole artist, or many artists/tracks)",
  "stats": [ { "platform": "Spotify | Apple Music | TikTok | YouTube | Instagram | Facebook | Shazam | Amazon Music | Pandora | Deezer | SoundCloud | All", "metric": "streams | listeners | monthly active listeners | saves | playlist adds | followers | streams per listener | views | shazams | ...", "value": 0, "period": "", "change_pct": null, "scope": "song | artist | account (account = a whole label/manager account or catalog)" } ],
  "song": { "release_date": "the song's release date if shown, as YYYY-MM-DD", "all_time_streams": null, "has_canvas": "no if a Spotify 'Add Canvas' button is visible, yes if a Canvas is shown, otherwise unknown" },
  "trend": "if a chart is shown, describe its shape in plain words with rough numbers, e.g. 'about 1,800 a week at launch, faded to about 50-100 a week since summer'",
  "audience_mix": { "active_pct": null, "previously_active_pct": null, "programmed_pct": null, "total_audience": null },
  "top_countries": [ { "place": "", "platform": "", "value": 0, "share_pct": null, "active_pct": null } ],
  "top_cities": [ { "place": "", "platform": "", "value": 0, "share_pct": null } ],
  "notes": ["anything else useful you can see, like 'TikTok views dropped from ~900K a day to ~340K a day over the week', or Spotify's own insights text"]
}`;

const WRITE = `You are StudioSound's music analyst. You explain how an independent artist's music is doing in plain, simple words, like a smart friend in the industry, never like a data report.
RULES
- No jargon. Never say: KPI, metric, conversion, engagement rate, algorithmic, cohort, retention, CTR, segment. Say it the way an artist talks: "people are saving it", "they're coming back to it", "Spotify's playlists are bringing you new ears".
- Be honest. If something is weak, say so kindly and say what to do about it. Don't hype weak numbers.
- Every point must come from the numbers given. Never invent a number, a city, a playlist or a platform.
- Short sentences. Each bullet is one or two sentences and includes the number that proves it, written simply (9.1K, up 56%).
- "Programmed" listeners on Spotify are people who heard the song through Spotify's own playlists and radio, not by looking for the artist.
- Shazams mean people heard the song out in the world (a party, a car, a club, a video) and looked it up. Views on TikTok/Instagram/YouTube/Facebook in a distributor dashboard are views of videos that use the song as a sound.
- Saves and playlist adds show people liked it enough to keep it. Streams per listener shows they come back to it.
- If the numbers cover many artists or a whole catalog, not one song, say so in the headline and talk about the catalog.
- Spotify for Artists does not show skip rate, so never mention skip rate.
- When two dashboards show the same platform (for example Spotify for Artists and a distributor's estimate of Spotify), trust the platform's own dashboard, never add them together, and don't point out small differences. Distributor numbers are estimates and lag a day or two.
- Only numbers with scope "song" describe this song. Artist-wide or account-wide numbers (a whole catalog's cities, total streams across all tracks) can only be mentioned as background ("across your whole catalog"), never as this song's numbers.
- If the same song's numbers are shown for two periods (for example 1 month and 3 months), compare the monthly pace to tell if it's growing or fading.
- Group suburbs and neighborhoods into their city when it's obvious (Lithia Springs and Atlanta = the Atlanta area; Brooklyn, the Bronx and New York = New York) and say the combined number.
- Look at today's date and the release date. Every song's streams fade after release week; that is normal. For a song out more than about 6 months, judge it against that, say it plainly, and aim the moves at keeping it alive cheaply and at the NEXT release, using the cities where this song found fans. Don't tell them to spend ad money on an old, fading song unless it's growing again. If today is the release anniversary, mention it.
- If the song has no Spotify Canvas (an "Add Canvas" button is showing), one move should be adding one: a short looping video, which a lyric video clip can be.
- Next moves must be things the artist can do this week. Each one points to a StudioSound tool when one fits: ads (an ad kit aimed at the right cities), lyric (a lyric video for TikTok/Reels), trim (cut the hook as a TikTok sound or snippet), art (new cover or visuals), plan (a release plan for the next drop), master, merch, check (release checklist), forecast (earnings), distribute (Stop One distribution), or "" when no tool fits.
Return JSON:
{
  "verdict": "growing | steady | slowing | early",
  "headline": "one sentence a friend would say: how the song is doing overall",
  "summary": "2-3 short sentences: the big picture in plain words",
  "numbers": [ { "label": "short label like 'Spotify streams (28 days)'", "value": "9.1K", "change": "+56% (only if the screen shows a change; otherwise an empty string)" } ],
  "working": ["2-4 things going well, each with its number"],
  "watch": ["1-3 things that are weak or slowing, each with its number and why it matters"],
  "where": [ { "place": "city or country", "why": "short reason, e.g. 'most active listeners' or '45 Pandora streams'" } ],
  "moves": [ { "text": "a specific move for this week", "tool": "one of the tools above or empty" } ],
  "vs_last": "one or two sentences comparing with their last report card, or empty if there is no last report"
}
numbers: the 4-6 most important numbers. where: up to 5 places. moves: exactly 3, most important first.`;

export default async function handler(req, res) {
  const user = await accountUser(req);
  if (req.method === 'GET') return res.status(200).json({ enabled: await enabledFor(user) });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!user) return res.status(401).json({ error: 'Please sign in first.' });
  if (user.denied) return res.status(user.status || 403).json({ error: user.error });
  if (!(await enabledFor(user))) return res.status(403).json({ error: 'Song Report Card is coming soon.' });

  const body = req.body || {};
  const title = clip(body.title, 120).trim(), artist = clip(body.artist, 120).trim();
  const images = (Array.isArray(body.images) ? body.images : []).filter(x => typeof x === 'string' && /^data:image\/(png|jpe?g|webp);base64,/.test(x) && x.length < 2500000).slice(0, 6);
  const files = (Array.isArray(body.files) ? body.files : []).filter(f => f && typeof f.text === 'string').slice(0, 3).map(f => ({ name: clip(f.name, 80), text: clip(f.text, 20000) }));
  if (!images.length && !files.length) return res.status(400).json({ error: 'Add at least one screenshot or downloaded file.' });

  const gate = await checkAndCount(req, 'report_card');
  if (!gate.ok) return res.status(gate.status).json({ error: gate.error, plan: gate.plan || null });

  try {
    // 1) read the numbers
    const content = [{ type: 'text', text: `Song: "${title || 'unknown'}" by ${artist || 'unknown'}. Read every number from these ${images.length} screenshot(s)` + (files.length ? ` and ${files.length} downloaded file(s)` : '') + '.' }];
    images.forEach(u => content.push({ type: 'image_url', image_url: { url: u, detail: 'high' } }));
    files.forEach(f => content.push({ type: 'text', text: `FILE ${f.name}:\n${f.text}` }));
    const metrics = await ai([{ role: 'system', content: EXTRACT }, { role: 'user', content }], 2500);
    if (!Array.isArray(metrics.stats) || !metrics.stats.length) {
      return res.status(422).json({ error: 'We couldn’t read any numbers from those. Try clear screenshots of your Spotify for Artists or distributor stats pages.' });
    }

    // 2) write the report card
    const prev = body.previous && typeof body.previous === 'object' ? JSON.stringify(body.previous).slice(0, 6000) : '';
    const pub = body.public_numbers && typeof body.public_numbers === 'object' ? JSON.stringify(body.public_numbers).slice(0, 9000) : '';
    const card = await ai([
      { role: 'system', content: WRITE },
      { role: 'user', content: `Today is ${new Date().toISOString().slice(0, 10)}. Song: "${title || 'this song'}" by ${artist || 'the artist'}.` + (body.notes ? `\nWhat the artist wants: ${clip(body.notes, 300)}` : '') +
        `\n\nNUMBERS READ FROM THEIR DASHBOARDS:\n${JSON.stringify(metrics).slice(0, 12000)}` +
        (prev ? `\n\nTHEIR LAST REPORT CARD'S NUMBERS (for vs_last):\n${prev}` : '\n\nNo last report card.') +
        (pub ? `\n\nPUBLIC NUMBERS WE TRACK EVERY WEEK FOR THIS ARTIST (this_week vs week_before): Last.fm listeners/plays (artist, and "latest" = their newest song), Deezer fans, each song's Deezer rank (higher = more popular on Deezer right now) and public Deezer playlists, Apple Music top-100 chart spots by country, YouTube channel subscribers/views and their newest videos' views, Genius lyric-page views, and real YouTube comments. Use them: say what changed week to week, mention any chart spot, and if comments are included, add one "working" or "watch" point that sums up what commenters are saying in plain words (what they quote or ask for, where they're from) without quoting usernames. Numbers here are for the whole artist unless they name a song:\n${pub}` : '') },
    ], 1800);

    // keep it tidy
    const arr = (a, n, len) => (Array.isArray(a) ? a : []).map(x => clip(x, len)).filter(Boolean).slice(0, n);
    card.verdict = ['growing', 'steady', 'slowing', 'early'].includes(card.verdict) ? card.verdict : 'steady';
    card.headline = clip(card.headline, 200); card.summary = clip(card.summary, 600); card.vs_last = clip(card.vs_last, 300);
    const realChange = (c) => /\d/.test(String(c || '')) && !/n\/?a|none|unknown/i.test(String(c)) ? clip(c, 12) : '';
    card.numbers = (Array.isArray(card.numbers) ? card.numbers : []).slice(0, 6).map(n => ({ label: clip(n && n.label, 50), value: clip(n && n.value, 20), change: realChange(n && n.change) })).filter(n => n.label && n.value);
    card.working = arr(card.working, 4, 300); card.watch = arr(card.watch, 3, 300);
    card.where = (Array.isArray(card.where) ? card.where : []).slice(0, 5).map(w => ({ place: clip(w && w.place, 60), why: clip(w && w.why, 120) })).filter(w => w.place);
    card.moves = (Array.isArray(card.moves) ? card.moves : []).slice(0, 3).map(m => ({ text: clip(m && m.text, 300), tool: TOOLS.includes(m && m.tool) ? m.tool : '' })).filter(m => m.text);
    card.sources = arr(metrics.sources, 4, 60); card.period = clip(metrics.period, 60); card.scope = clip(metrics.scope, 20);

    logGeneration(gate.userId, 'report_card', { title, artist, images: images.length, files: files.length, actor: gate.actingAs ? gate.actorEmail : null }, { metrics, card });
    return res.status(200).json({ card, metrics });
  } catch (e) {
    console.error('report-card', e);
    return res.status(500).json({ error: 'Something went wrong reading your stats. Try again.' });
  }
}
