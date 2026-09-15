// GET /api/fx?from=AUD  →  { rate: 0.66xx, source: 'er-api' }
// Server-side FX lookup: immune to ad-blockers/CORS, tries two free providers.
let cache = {}; // { AUD: { rate, ts } } — 12h cache per instance

export default async function handler(req, res) {
  try {
    const from = String((req.query && req.query.from) || '').toUpperCase();
    if (!/^[A-Z]{3}$/.test(from)) return res.status(400).json({ error: 'bad currency' });
    if (from === 'USD') return res.status(200).json({ rate: 1, source: 'identity' });

    const hit = cache[from];
    if (hit && Date.now() - hit.ts < 12 * 3600 * 1000) {
      return res.status(200).json({ rate: hit.rate, source: hit.source + ' (cached)' });
    }

    const providers = [
      { name: 'er-api',      url: 'https://open.er-api.com/v6/latest/' + from,                      pick: j => j && j.rates && j.rates.USD },
      { name: 'frankfurter', url: 'https://api.frankfurter.app/latest?from=' + from + '&to=USD',    pick: j => j && j.rates && j.rates.USD },
    ];
    for (const p of providers) {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 6000);
        const r = await fetch(p.url, { signal: ctrl.signal });
        clearTimeout(t);
        const rate = p.pick(await r.json());
        if (rate && rate > 0) {
          cache[from] = { rate, ts: Date.now(), source: p.name };
          return res.status(200).json({ rate, source: p.name });
        }
      } catch (e) { /* try next provider */ }
    }
    return res.status(502).json({ error: 'no provider available' });
  } catch (e) {
    return res.status(500).json({ error: String(e && e.message || e) });
  }
}
