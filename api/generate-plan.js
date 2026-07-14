import { checkAndCount, logGeneration } from './_usage.js';

// STAGE 1 — Research the artist across the live web
async function researchArtist(artistName, genre, city) {
  if (!artistName) return null;
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + process.env.OPENAI_API_KEY
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini-search-preview',
        web_search_options: { search_context_size: 'medium' },
        messages: [
          {
            role: 'user',
            content: `Research the independent music artist "${artistName}" (genre: ${genre}${city ? ', based in ' + city : ''}). If a social handle (@name) is included, use it to identify the EXACT artist — many artists share names, so match the handle across platforms to make sure every finding is about this specific person. Search the web and report concise bullet notes on:

1. DSP PRESENCE: Do they appear on Spotify / Apple Music / SoundCloud / YouTube? Any follower counts, monthly listener numbers, or notable releases you can find.
2. SOCIALS: Instagram / TikTok / X / YouTube handles and rough audience sizes if findable.
3. SIMILAR ARTISTS: 3-5 comparable artists in ${genre} at a similar or slightly bigger level, and specifically WHAT those artists are doing right now to market their music (content formats, posting patterns, campaigns).
4. GENRE TRENDS: What marketing tactics are currently working for independent ${genre} artists (last few months) — short-form content styles, platform features, campaign types.
5. LOCAL SCENE: ${city ? 'Music scene opportunities in ' + city + ' — venues, radio, playlists, press, events an independent artist should target.' : 'Skip.'}

If you can't find the artist at all, say "ARTIST NOT FOUND ONLINE" and still complete items 3-5. Keep it factual — only report what you actually find, never invent numbers.`
          }
        ]
      })
    });
    const data = await res.json();
    if (data.error) { console.error('Research error:', data.error); return null; }
    return data.choices && data.choices[0] && data.choices[0].message.content;
  } catch (e) {
    console.error('Research failed:', e);
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ===== GATE: verify user + check/count monthly limit =====
  const gate = await checkAndCount(req, 'release_plan');
  if (!gate.ok) {
    return res.status(gate.status).json({ error: gate.error, plan: gate.plan || null });
  }
  // ==========================================================

  const { projectName, releaseDate, genre, careerStage, city, details, artistName, budget } = req.body;

  try {
    // STAGE 1: live web research on the artist + their lane
    const research = await researchArtist(artistName, genre, city);

    const researchBlock = research
      ? `LIVE WEB RESEARCH ON THIS ARTIST AND THEIR LANE (gathered just now — build the plan around this):
${research}`
      : `No web research available — build the plan from the details provided, and include a step for claiming Spotify for Artists and Apple Music for Artists profiles.`;

    // STAGE 2: turn research into a personalized plan
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
            content: `You are the release strategist independent artists wish they could afford — a mix of label marketing director, playlist plugger, and short-form content strategist. Your plans are SPECIFIC: exact platforms, exact posting cadences, exact dollar allocations, named tactics. Never generic advice like "post on social media." You know the current independent-artist playbook: dedicated fan pages on TikTok/Reels/Shorts posting 2-3x daily, pre-save campaigns, SubmitHub/Groover playlist pitching, Spotify editorial pitching via Spotify for Artists 4+ weeks out, Discord/broadcast-channel fan communities, content batching days, sped-up/slowed versions for TikTok, local press and radio, collab posts, and paid micro-campaigns on Meta/TikTok when budget allows. When you have real research on the artist, reference their actual numbers, platforms, similar artists, and city by name throughout the plan.`
          },
          {
            role: 'user',
            content: `Build a deeply personalized 30-day release plan.

PROJECT:
- Project Name: ${projectName}
- Release Date: ${releaseDate}
- Genre: ${genre}
- Career Stage: ${careerStage}
- City: ${city}
- Budget: ${budget || 'not specified — assume near-zero and prioritize organic'}
- Artist name: ${artistName || 'not provided'}
- Artist's own description: ${details || 'None provided'}

${researchBlock}

Return ONLY valid JSON (no markdown, no other text) with this exact shape:
{
  "summary": "3-4 sentence strategy overview written directly to the artist, referencing their real situation from the research",
  "artist_snapshot": "2-3 sentences on where they stand right now (cite real findings: platforms, audience sizes, comparable artists) and the single biggest lever for this release",
  "budget_breakdown": [ { "item": "what to spend on", "amount": "$X", "why": "one sentence" } ],
  "trend_tactics": [ "5 specific tactics working RIGHT NOW in their genre at their size — pulled from the research where possible, each concrete enough to start today" ],
  "timeline": [ { "date": "specific date or 'X weeks out'", "task": "short action title", "detail": "specific actionable detail: platform names, exact posting counts, best times for their city timezone, genre-specific angles, similar-artist examples where relevant" } ]
}

Rules: 12-14 timeline items covering 4 weeks pre-release through 1 week post-release. Budget breakdown must sum to their stated budget (or be an empty array if no budget given). Every timeline item must be executable without asking a single follow-up question.`
          }
        ],
        max_tokens: 3000
      })
    });

    const data = await response.json();
    if (data.error) {
      return res.status(400).json({ error: data.error.message });
    }

    let content = data.choices[0].message.content;
    content = content.replace(/```json/g, '').replace(/```/g, '').trim();
    const plan = JSON.parse(content);

    // Log the full generation — inputs, research, and output — to the dataset
    logGeneration(gate.userId, 'release_plan',
      { projectName, releaseDate, genre, careerStage, city, details, artistName, budget, research },
      plan
    );

    return res.status(200).json(plan);
  } catch (err) {
    console.error('Plan error:', err);
    res.status(500).json({ error: err.message });
  }
}
