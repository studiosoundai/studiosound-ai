import { checkAndCount, logGeneration } from './_usage.js';

// POST /api/generate-ads
// Builds a ready-to-run ad kit for one release: copy variations, on-image text,
// targeting, budget plan and setup steps. Creatives are drawn in the browser.
// platform: 'meta' today; 'tiktok' and 'google' plug into PLATFORMS below.

const META_CTAS = {
  LISTEN_NOW: 'Listen Now',
  LEARN_MORE: 'Learn More',
  SIGN_UP: 'Sign Up',
  WATCH_MORE: 'Watch More',
  SHOP_NOW: 'Shop Now',
};

const GOALS = {
  streams: 'Get streams on the song (send people to a link with the song on Spotify, Apple Music and other stores)',
  presave: 'Get pre-saves before release day',
  followers: 'Grow followers and profile visits on Instagram',
  views: 'Get as many people as possible to watch the video ad (awareness)',
};

const PLATFORMS = {
  meta: {
    name: 'Meta (Instagram and Facebook)',
    rules: `META ADS RULES you must follow:
- Primary text: lead with the hook in the first 125 characters (that's all that shows before "more"). Max 300 characters total.
- Headline: max 40 characters. Description: max 30 characters.
- On-image text: max 6 words, punchy, readable on a phone in one second.
- CTA button must be one of: ${Object.keys(META_CTAS).join(', ')}.
- Meta policy: never call out personal attributes ("Are you depressed?", "Other Latinos..."), no fake buttons or play icons in the copy, no misleading claims ("#1 song in the country", "Billboard charting") unless provided as fact, no all-caps shouting, max 1-2 emojis per text.
- Objectives available in Ads Manager: Awareness, Traffic, Engagement, Leads. For streams and pre-saves use Traffic (optimize for landing page views) unless the landing page has a Meta pixel, then Leads or Engagement may fit. For followers use Engagement (Instagram profile visits). For views use Awareness or Engagement (ThruPlay).
- Interest targeting: big artists usually exist as interests in Meta; small artists usually don't. Always give the genre-level and platform-level interests (e.g. "Spotify", "Hip hop music") as a fallback.
- Placements: Instagram Reels, Stories, Feed and Facebook Reels perform best for music. Advantage+ placements is acceptable for small budgets.`,
  },
};

const clip = (s, n) => {
  s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s;
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body || {};
  const platform = PLATFORMS[body.platform] ? body.platform : 'meta';
  const P = PLATFORMS[platform];

  const title = clip(body.title, 120);
  const artist = clip(body.artist, 120);
  if (!title || !artist) return res.status(400).json({ error: 'Song title and artist name are required.' });

  // ===== GATE =====
  const gate = await checkAndCount(req, 'ads');
  if (!gate.ok) return res.status(gate.status).json({ error: gate.error, plan: gate.plan || null });
  // ================

  const inputs = {
    platform,
    title,
    artist,
    genre: clip(body.genre, 60),
    city: clip(body.city, 120),
    similar: clip(body.similar, 300),
    goal: GOALS[body.goal] ? body.goal : 'streams',
    status: body.status === 'upcoming' ? 'upcoming' : 'out',
    releaseDate: clip(body.releaseDate, 20),
    hookLine: clip(body.hookLine, 200),
    vibe: clip(body.vibe, 400),
    budget: Math.max(0, Math.min(100000, parseFloat(body.budget) || 0)),
    days: Math.max(1, Math.min(90, parseInt(body.days, 10) || 7)),
    link: clip(body.link, 300),
  };

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + process.env.OPENAI_API_KEY,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        temperature: 0.8,
        max_tokens: 2200,
        messages: [
          {
            role: 'system',
            content: `You are a paid-social media buyer who has run hundreds of small-budget campaigns for independent music artists. You write ad copy that sounds like the artist, not like a brand, and you plan budgets that a $50-$500 artist can actually run. You are honest about what small budgets can and can't do. Never invent facts about the artist (streams, charts, awards, features) — only use what you are given.

${P.rules}`,
          },
          {
            role: 'user',
            content: `Build a ${P.name} ad kit for this release.

RELEASE
- Song: "${inputs.title}" by ${inputs.artist}
- Status: ${inputs.status === 'upcoming' ? 'coming soon' + (inputs.releaseDate ? ' (release date ' + inputs.releaseDate + ')' : '') : 'out now'}
- Genre: ${inputs.genre || 'not specified'}
- Artist's city / where fans are: ${inputs.city || 'not specified'}
- Similar artists: ${inputs.similar || 'not specified'}
- Hook line from the song: ${inputs.hookLine || 'not provided'}
- Vibe / what the song is about: ${inputs.vibe || 'not provided'}
- Goal: ${GOALS[inputs.goal]}
- Total budget: ${inputs.budget ? '$' + inputs.budget : 'not set — recommend a starter budget'} over ${inputs.days} days
- Landing link: ${inputs.link || 'not provided'}

Return ONLY JSON in exactly this shape:
{
  "angle": "one sentence: the creative angle of this campaign and why it fits the song",
  "on_image_text": ["3 options, max 6 words each, for text on the ad image/video"],
  "primary_text": ["3 variations with different angles (hook-first, story, social-proof-free FOMO), each max 300 chars, hook in first 125 chars"],
  "headlines": ["3 options, max 40 chars"],
  "descriptions": ["2 options, max 30 chars"],
  "cta": "one of ${Object.keys(META_CTAS).join(' | ')}",
  "objective": "the Ads Manager objective to pick and the optimization goal, one line",
  "audience": {
    "locations": ["2-5 specific cities/regions/countries to target, starting with the artist's city if given"],
    "age_min": 18,
    "age_max": 34,
    "interests": ["5-8 interests to type into detailed targeting: similar artists first, then genre and platform interests"],
    "note": "one sentence on how to widen or narrow if results are weak"
  },
  "placements": "one line on which placements to use",
  "budget_plan": {
    "daily": "the daily budget in dollars, as a number",
    "summary": "2 sentences: how the money is split and the test-then-scale logic",
    "phases": [ { "days": "e.g. Days 1-3", "action": "what to run and spend", "spend": "$X" } ]
  },
  "setup_steps": ["7-10 short numbered steps to build this exact campaign in Ads Manager, in order, written for someone who has never run an ad"],
  "what_to_watch": ["3 metrics to check after 48 hours with the number that means it's working for a music ad (e.g. link click CTR above 1%, cost per landing page view under $0.40)"],
  "landing_tip": "one sentence about where the ad should send people and why (pixel tracking, smart link, release page)"
}`,
          },
        ],
      }),
    });

    const data = await response.json();
    if (data.error) return res.status(400).json({ error: data.error.message });

    let kit;
    try {
      kit = JSON.parse(String(data.choices[0].message.content).replace(/```json|```/g, '').trim());
    } catch (e) {
      return res.status(502).json({ error: 'The ad kit came back malformed. Please try again.' });
    }

    // Enforce Meta limits even if the model drifts
    const arr = (a, n, len) => (Array.isArray(a) ? a : []).map(x => clip(x, len)).filter(Boolean).slice(0, n);
    kit.on_image_text = arr(kit.on_image_text, 3, 48);
    kit.primary_text = arr(kit.primary_text, 3, 300);
    kit.headlines = arr(kit.headlines, 3, 40);
    kit.descriptions = arr(kit.descriptions, 2, 30);
    if (!META_CTAS[kit.cta]) kit.cta = inputs.goal === 'presave' ? 'SIGN_UP' : (inputs.goal === 'views' ? 'WATCH_MORE' : 'LISTEN_NOW');
    kit.cta_label = META_CTAS[kit.cta];
    kit.platform = platform;

    logGeneration(gate.userId, 'ads', inputs, kit);
    return res.status(200).json(kit);
  } catch (err) {
    console.error('Ads error:', err);
    return res.status(500).json({ error: 'Something went wrong building your ad kit.' });
  }
}
