// GET /api/fx?from=AUD  →  { rate: 0.66xx, source: 'frankfurter' }
// Server-side FX lookup: immune to ad-blockers/CORS, tries two free providers.
let cache = {}; // { AUD: { rate, ts } } — 12h cache per instance

export default async function handler(req, res) {
  const from = String(req.query.from || '').toUpperCase();
  if (!/^[A-Z]{3}$/.test(from)) return res.status(400).json({ error: 'bad currency' });
  if (from === 'USD') return res.status(200).json({ rate: 1, source: 'identity' });

  const hit = cache[from];
  if (hit && Date.now() - hit.ts < 12 * 3600 * 1000) {
    return res.status(200).json({ rate: hit.rate, source: hit.source + ' (cached)' });
  }

  const providers = [
    { name: 'frankfurter', url: `https://api.frankfurter.app/latest?from=${from}&to=USD`, pick: j => j?.rates?.USD },
    { name: 'er-api',      url: `https://open.er-api.com/v6/latest/${from}`,             pick: j => j?.rates?.USD },
  ];
  for (const p of providers) {
    try {
      const r = await fetch(p.url, { signal: AbortSignal.timeout(6000) });
      const rate = p.pick(await r.json());
      if (rate && rate > 0) {
        cache[from] = { rate, ts: Date.now(), source: p.name };
        return res.status(200).json({ rate, source: p.name });
      }
    } catch (e) { /* try next */ }
  }
  return res.status(502).json({ error: 'no provider available' });
}
