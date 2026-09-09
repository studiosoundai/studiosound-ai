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
    "steady": "1-2 sentences: what this curve assumes and who ends up on it",
    "growth": "1-2 sentences: what specifically the artist must do to earn this curve (release cadence, content, playlisting)",
    "breakout": "1-2 sentences: honest framing — what a viral moment does to the math and why it can't be counted on"
  },
  "moves": ["4 specific actions, ordered by impact, to push from Steady toward Growth — concrete, doable this quarter"]
}`
          }
        ],
        max_tokens: 900
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
