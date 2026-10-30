// api/_scene.js
// Real listening data for the artists a user says they sound like, so the A&R Check places the song in
// the right scene instead of guessing. Source: Deezer's public API (free, no key needed).
//   search an artist  -> /search/artist?q=
//   related artists   -> /artist/{id}/related      ("fans also like")
//   playlists         -> /artist/{id}/playlists    (playlists that include the artist; titles name the lane)
// Plus Last.fm when LASTFM_API_KEY is set in Vercel (free): similar artists from real listening, and the genre
// tags listeners give the artist ("atl drill", "rage", "plugg"...).
// More sources (SoundCloud, YouTube) can be added here later and merged the same way.

const API = 'https://api.deezer.com';

async function get(path, ms = 6000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(API + path, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!r.ok) return null;
    const d = await r.json();
    return d && !d.error ? d : null;
  } catch (e) { return null; } finally { clearTimeout(t); }
}

async function lastfm(method, artist) {
  const key = process.env.LASTFM_API_KEY;
  if (!key) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 6000);
  try {
    const u = `https://ws.audioscrobbler.com/2.0/?method=${method}&artist=${encodeURIComponent(artist)}&api_key=${encodeURIComponent(key)}&format=json&autocorrect=1&limit=30`;
    const r = await fetch(u, { signal: ctrl.signal, headers: { 'User-Agent': 'StudioSound/1.0 (studiosound.ai)' } });
    if (!r.ok) return null;
    const d = await r.json();
    return d && !d.error ? d : null;
  } catch (e) { return null; } finally { clearTimeout(t); }
}
const JUNK_TAGS = new Set(['seen live', 'favorites', 'favourite', 'favorite', 'love', 'awesome', 'beautiful', 'cool', 'my favorite', 'all', 'male vocalists', 'female vocalists', 'american', 'usa', 'spotify']);

const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9$]+/g, '');

// "Carti, Lucki & Yachty" -> ['Carti', 'Lucki', 'Yachty']
export function parseRefs(refs) {
  return String(refs || '')
    .split(/,|;|\/|\n|\s+&\s+|\s+and\s+|\s+x\s+|\s+\+\s+/i)
    .map(s => s.trim().replace(/^(like|sounds like)\s+/i, ''))
    .filter(s => s.length >= 2)
    .slice(0, 3);
}

async function findArtist(name) {
  const d = await get('/search/artist?limit=8&q=' + encodeURIComponent(name));
  const list = (d && d.data) || [];
  if (!list.length) return null;
  const n = norm(name);
  const exact = list.filter(a => norm(a.name) === n);
  const pool = exact.length ? exact : list.filter(a => norm(a.name).includes(n) || n.includes(norm(a.name)));
  const best = (pool.length ? pool : list.slice(0, 1)).sort((a, b) => (b.nb_fan || 0) - (a.nb_fan || 0))[0];
  return best ? { id: best.id, name: best.name, fans: best.nb_fan || 0, link: best.link || null } : null;
}

export async function sceneFor(refs) {
  const names = parseRefs(refs);
  if (!names.length) return null;
  const found = (await Promise.all(names.map(findArtist)));
  const artists = found.filter(Boolean);
  const notFound = names.filter((n, i) => !found[i]);

  // Last.fm (optional): similar artists with a match score, and listener tags
  const fm = await Promise.all(names.map(async (n, i) => {
    const q = found[i] ? found[i].name : n;
    const [sim, tags] = await Promise.all([lastfm('artist.getsimilar', q), lastfm('artist.gettoptags', q)]);
    return { name: q, similar: (sim && sim.similarartists && sim.similarartists.artist) || [], tags: (tags && tags.toptags && tags.toptags.tag) || [] };
  }));
  const fmUsed = fm.some(x => x.similar.length || x.tags.length);
  const tagScore = new Map();
  fm.forEach(x => x.tags.slice(0, 15).forEach(t => {
    const k = String(t.name || '').toLowerCase().trim();
    if (!k || JUNK_TAGS.has(k) || k.length > 30) return;
    tagScore.set(k, (tagScore.get(k) || 0) + (Number(t.count) || 1));
  }));
  const tags = [...tagScore.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([t]) => t);
  const source = fmUsed ? (artists.length ? 'Deezer + Last.fm' : 'Last.fm') : 'Deezer';
  // a name Deezer missed but Last.fm knows still counts as found
  fm.forEach((x, i) => { if (!found[i] && (x.similar.length || x.tags.length)) { artists.push({ id: null, name: x.name, fans: 0, link: null }); const j = notFound.indexOf(names[i]); if (j >= 0) notFound.splice(j, 1); } });
  if (!artists.length) return { source, asked: names, found: [], not_found: notFound, neighbors: [], playlists: [], tags };

  const seeds = new Set(artists.map(a => a.id).filter(Boolean));
  const seedNames = new Set(artists.map(a => norm(a.name)));
  const neighborScore = new Map();    // name -> { count, fans }
  const playlistScore = new Map();    // title -> { count, tracks }
  await Promise.all(artists.filter(a => a.id).map(async (a) => {
    const [rel, pls] = await Promise.all([get(`/artist/${a.id}/related?limit=25`), get(`/artist/${a.id}/playlists?limit=40`)]);
    ((rel && rel.data) || []).forEach((r, i) => {
      if (seeds.has(r.id)) return;
      const k = r.name; const cur = neighborScore.get(k) || { count: 0, fans: r.nb_fan || 0, rank: 99 };
      cur.count += 1; cur.rank = Math.min(cur.rank, i);
      neighborScore.set(k, cur);
    });
    ((pls && pls.data) || []).forEach((p) => {
      const title = String(p.title || '').trim();
      if (!title || title.length > 80) return;
      const k = title; const cur = playlistScore.get(k) || { count: 0, tracks: p.nb_tracks || 0 };
      cur.count += 1; playlistScore.set(k, cur);
    });
  }));

  // Last.fm similar artists: strong matches count like a Deezer "related" hit
  fm.forEach(x => x.similar.slice(0, 25).forEach((r, i) => {
    if (!r || !r.name || seedNames.has(norm(r.name))) return;
    const existing = [...neighborScore.keys()].find(k => norm(k) === norm(r.name));
    const k = existing || r.name;
    const cur = neighborScore.get(k) || { count: 0, fans: 0, rank: 99 };
    cur.count += Number(r.match) >= 0.3 ? 1 : 0.5; cur.rank = Math.min(cur.rank, i);
    neighborScore.set(k, cur);
  }));

  const neighbors = [...neighborScore.entries()]
    .sort((x, y) => (y[1].count - x[1].count) || (x[1].rank - y[1].rank) || (y[1].fans - x[1].fans))
    .slice(0, 15).map(([name, v]) => ({ name, shared: Math.round(v.count * 10) / 10, fans: v.fans }));
  const playlists = [...playlistScore.entries()]
    .sort((x, y) => (y[1].count - x[1].count) || (y[1].tracks - x[1].tracks))
    .slice(0, 15).map(([title, v]) => ({ title, shared: v.count }));

  return { source, asked: names, found: artists, not_found: notFound, neighbors, playlists, tags };
}

// Compact text for the AI prompts
export function sceneText(scene) {
  if (!scene || !scene.found || !scene.found.length) return '';
  const f = scene.found.map(a => a.fans ? `${a.name} (${a.fans.toLocaleString('en-US')} fans)` : a.name).join(', ');
  const n = scene.neighbors.map(x => x.name + (x.shared >= 2 ? ' [strong]' : '')).join(', ');
  const p = scene.playlists.map(x => `"${x.title}"` + (x.shared > 1 ? ` [${x.shared}]` : '')).join(', ');
  return `REAL LISTENING DATA (${scene.source}) for the artists they named: ${f}.` +
    (n ? `\nRelated artists (fans also like; [strong] = linked to several of their references or by both sources): ${n}.` : '') +
    (p ? `\nPlaylists that include them (their titles show the scene and lane): ${p}.` : '') +
    (scene.tags && scene.tags.length ? `\nGenre tags listeners give them (Last.fm, most used first): ${scene.tags.join(', ')}.` : '') +
    (scene.not_found.length ? `\nNot found on ${scene.source}: ${scene.not_found.join(', ')}.` : '');
}
