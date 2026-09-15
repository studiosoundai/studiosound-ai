import { checkAndCount, logGeneration } from './_usage.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ===== GATE =====
  const gate = await checkAndCount(req, 'forecast');
  if (!gate.ok) {
    return res.status(gate.status).json({ error: gate.error, plan: gate.plan || null });
  }
  // ================

  const { monthly, stats, scenarios, genre, city, releasesPerYear } = req.body;
  if (!stats || !scenarios) return res.status(400).json({ error: 'Missing forecast data' });

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + process.env.OPENAI_API_KEY
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are a music-industry royalty analyst who reviews independent artists' earnings data and explains their trajectory honestly. You know how streaming royalties behave: catalog decays without new releases, consistent release cadence and short-form content drive growth, viral moments are possible but never guaranteed. You are encouraging but NEVER promise outcomes — these are scenario estimates, and you say what the artist can DO to steer toward the better curves. You speak directly to the artist in plain language.`
          },
          {
            role: 'user',
            content: `An independent artist's royalty history and computed projections:

HISTORY: ${JSON.stringify(monthly)}
STATS: ${JSON.stringify(stats)} (avgMonthly = average of recent months, trend = month-over-month growth rate observed)
PROJECTIONS (computed, cumulative totals): ${JSON.stringify(scenarios)}
Genre: ${genre || 'not specified'} | City: ${city || 'not specified'} | Planned releases per year: ${releasesPerYear || 'not specified'}

Return ONLY valid JSON:
{
  "headline": "one sentence stating where they are right now (their current monthly average, their trend direction)",
  "analysis": "3-4 sentences reading their actual numbers: trend, what's driving it, what the data suggests",
  "scenario_notes": {
    "steady": "2-3 sentences: what this curve assumes, who ends up on it, and what it feels like a year in",
    "growth": "2-3 sentences: what specifically the artist must do to earn this curve — release cadence, content rhythm, playlisting, live/local presence",
    "breakout": "2-3 sentences: honest framing — what a viral moment does to the math, how the afterglow decays, why it can't be planned on"
  },
  "moves": ["5-6 specific actions ordered by impact, each with the WHY built in (e.g. 'Release every 6 weeks — catalog decay is the #1 silent earnings killer for artists at this stage'). Concrete and doable this quarter."],
  "milestones": ["3 monthly-income milestones ahead of this artist and what each unlocks (e.g. what becomes possible at 2x current monthly, at 5x) — tie to real artist moves like pressing merch, running ads profitably, playing paid shows"],
  "watch_outs": ["2-3 honest risks or patterns that could pull this artist BELOW the steady curve, specific to their genre/trend/release plan — and the early warning sign for each"]
}`
          }
        ],
        max_tokens: 1600
      })
    });

    const data = await response.json();
    if (data.error) return res.status(400).json({ error: data.error.message });

    let content = data.choices[0].message.content.replace(/```json/g, '').replace(/```/g, '').trim();
    const report = JSON.parse(content);

    logGeneration(gate.userId, 'forecast', { stats, scenarios, genre, city, releasesPerYear }, report);

    return res.status(200).json(report);
  } catch (err) {
    console.error('Forecast error:', err);
    res.status(500).json({ error: err.message });
  }
}
