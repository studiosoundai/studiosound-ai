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

const BUDGET_TIERS = [25, 50, 100, 250];
const LANGS = {
  en: 'English',
  es: 'Spanish (natural, the way Latin artists talk to fans on Instagram; not formal or translated-sounding)',
  spanglish: 'Spanglish (mix Spanish and English naturally inside sentences, the way bilingual Latin fans actually talk)',
};
const TIER_DAYS = { 25: 5, 50: 7, 100: 7, 250: 14 };

// STAGE 1: live web research on the artist, so targeting is built on who they really are
async function researchArtist(artist, handle, genre, city) {
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + process.env.OPENAI_API_KEY },
      body: JSON.stringify({
        model: 'gpt-4o-mini-search-preview',
        web_search_options: { search_context_size: 'medium' },
        messages: [{
          role: 'user',
          content: `Research the independent music artist "${artist}"${handle ? ' (social handle: ' + handle + ')' : ''}${genre ? ', genre: ' + genre : ''}${city ? ', says they are from or based in: ' + city : ''}. Many artists share names, so use the handle to identify the exact person and only report findings about them.

Report concise notes on:
1. WHERE THEY'RE FROM: hometown or base city, and country.
2. WHERE THEIR FANS ARE: cities or countries where their listeners or followers concentrate, if you can find any signal (Spotify "where people listen", tour dates, local press).
3. GENRE: their genre and subgenre as fans would describe it.
4. AUDIENCE SIZE: rough follower or monthly-listener counts you can actually find.
5. SIMILAR ARTISTS: 5-8 well-known artists their fans also listen to (big enough to exist as Meta ad interests), plus 2-3 peer-level artists at a similar size.

If you can't find the artist, say "ARTIST NOT FOUND ONLINE" and still give genre-appropriate similar artists for ${genre || 'their genre'}. Only report what you actually find; never invent numbers.`
        }]
      })
    });
    const d = await r.json();
    if (d.error) { console.error('ads research error', d.error); return null; }
    return d.choices && d.choices[0] && d.choices[0].message.content;
  } catch (e) { console.error('ads research failed', e); return null; }
}

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
    handle: clip(body.handle, 80),
    similar: clip(body.similar, 300),
    goal: GOALS[body.goal] ? body.goal : 'streams',
    status: body.status === 'upcoming' ? 'upcoming' : 'out',
    releaseDate: clip(body.releaseDate, 20),
    hookLine: clip(body.hookLine, 200),
    vibe: clip(body.vibe, 400),
    budgetMode: body.budgetMode === 'recommend' ? 'recommend' : 'set',
    budget: Math.max(0, Math.min(100000, parseFloat(body.budget) || 0)),
    days: Math.max(1, Math.min(90, parseInt(body.days, 10) || 7)),
    link: clip(body.link, 300),
    lang: LANGS[body.lang] ? body.lang : 'en',
  };

  if (inputs.budgetMode === 'set' && !inputs.budget) inputs.budgetMode = 'recommend';

  try {
    const research = await researchArtist(inputs.artist, inputs.handle, inputs.genre, inputs.city);
    const researchBlock = research
      ? `LIVE WEB RESEARCH ON THIS ARTIST (gathered just now; build targeting on this, and prefer it over guesses):\n${research}`
      : 'No web research available. Use the details given and genre-level targeting.';
    const budgetLine = inputs.budgetMode === 'recommend'
      ? `Budget: the artist wants you to RECOMMEND one. Pick exactly one of ${BUDGET_TIERS.map(x => '$' + x).join(', ')} based on their goal and audience size (new artists with small followings: $25-$50 test first; established local artists or a single with momentum: $100; a full release push with an existing fan base: $250). Days: ${BUDGET_TIERS.map(x => '$' + x + ' = ' + TIER_DAYS[x] + ' days').join(', ')}.`
      : `Budget: $${inputs.budget} over ${inputs.days} days (the artist set this; plan around it exactly).`;

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
        max_tokens: 2600,
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
- Artist's social handle: ${inputs.handle || 'not provided'}
- Artist says they're from / fans are in: ${inputs.city || 'not specified (use the research)'}
- Similar artists the artist named: ${inputs.similar || 'none (use the research)'}
- Hook line from the song: ${inputs.hookLine || 'not provided'}
- Vibe / what the song is about: ${inputs.vibe || 'not provided'}
- Goal: ${GOALS[inputs.goal]}
- ${budgetLine}
- Landing link: ${inputs.link || 'not provided'}
- AD COPY LANGUAGE: write on_image_text, primary_text, headlines and descriptions in ${LANGS[inputs.lang]}. Write everything else (angle, objective, audience, budget, setup_steps, what_to_watch, landing_tip) in English so the artist can follow the setup.

${researchBlock}

Return ONLY JSON in exactly this shape:
{
  "artist_profile": {
    "found": true,
    "from": "hometown or base city, country (or what the artist told you)",
    "fan_locations": ["2-5 cities or countries where their listeners are, from the research or best inference"],
    "genre": "genre / subgenre",
    "audience": "one line on audience size from the research, or 'Not enough public data found'",
    "similar_big": ["4-6 well-known similar artists usable as Meta interests"],
    "similar_peers": ["2-3 peer-level similar artists, or empty"]
  },
  "budget_recommendation": { "amount": 50, "days": 7, "why": "one sentence on why this budget fits this artist and goal" },
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
    // budget: snap recommendations to our tiers, echo the artist's own choice otherwise
    const br = kit.budget_recommendation || {};
    if (inputs.budgetMode === 'recommend') {
      let amt = parseFloat(br.amount) || 50;
      amt = BUDGET_TIERS.reduce((a, b) => Math.abs(b - amt) < Math.abs(a - amt) ? b : a);
      kit.budget_recommendation = { amount: amt, days: TIER_DAYS[amt], why: clip(br.why, 240), recommended: true };
    } else {
      kit.budget_recommendation = { amount: inputs.budget, days: inputs.days, why: '', recommended: false };
    }
    const ap = kit.artist_profile || {};
    kit.artist_profile = {
      found: !!research && !/ARTIST NOT FOUND ONLINE/i.test(research) && ap.found !== false,
      from: clip(ap.from, 120), genre: clip(ap.genre, 80), audience: clip(ap.audience, 200),
      fan_locations: arr(ap.fan_locations, 5, 60), similar_big: arr(ap.similar_big, 6, 60), similar_peers: arr(ap.similar_peers, 3, 60)
    };

    logGeneration(gate.userId, 'ads', Object.assign({}, inputs, { research }), kit);
    return res.status(200).json(kit);
  } catch (err) {
    console.error('Ads error:', err);
    return res.status(500).json({ error: 'Something went wrong building your ad kit.' });
  }
}
