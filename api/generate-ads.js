import { checkAndCount, logGeneration } from './_usage.js';

// POST /api/generate-ads
// Builds a ready-to-run ad kit for one release: copy variations, on-image text,
// targeting, budget plan and setup steps. Creatives are drawn in the browser.
// platform: 'meta' (Instagram & Facebook), 'tiktok', or 'google' (YouTube through Google Ads).
// Credits: one song = one ad-kit credit a month. Kits for the other platforms for the same song that month are free.

const META_CTAS = {
  LISTEN_NOW: 'Listen Now',
  LEARN_MORE: 'Learn More',
  SIGN_UP: 'Sign Up',
  WATCH_MORE: 'Watch More',
  SHOP_NOW: 'Shop Now',
};
const TIKTOK_CTAS = {
  LISTEN_NOW: 'Listen now',
  LEARN_MORE: 'Learn more',
  SIGN_UP: 'Sign up',
  WATCH_NOW: 'Watch now',
};
const GOOGLE_CTAS = {
  LISTEN_NOW: 'Listen now',
  WATCH_NOW: 'Watch now',
  LEARN_MORE: 'Learn more',
  SUBSCRIBE: 'Subscribe',
  SIGN_UP: 'Sign up',
};

const GOALS = {
  streams: 'Get streams on the song (send people to a link with the song on Spotify, Apple Music and other stores)',
  presave: 'Get pre-saves before release day',
  followers: 'Grow followers and profile visits on Instagram',
  views: 'Get as many people as possible to watch the video ad (awareness)',
};
const GOALS_BY_PLATFORM = {
  tiktok: { followers: 'Grow followers on TikTok (profile visits and follows)' },
  google: { followers: 'Grow subscribers on their YouTube channel', views: 'Get as many YouTube views of the video ad as possible' },
};
const goalText = (platform, goal) => (GOALS_BY_PLATFORM[platform] || {})[goal] || GOALS[goal];

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
    ctas: META_CTAS,
    tiers: [25, 50, 100, 250],
    tierDays: { 25: 5, 50: 7, 100: 7, 250: 14 },
    manager: 'Meta Ads Manager',
    limits: { primary: 300, headlines: 40, descriptions: 30, nPrimary: 3, nHeadlines: 3, nDescriptions: 2 },
    copySpec: `  "primary_text": ["3 variations with different angles (hook-first, story, social-proof-free FOMO), each max 300 chars, hook in first 125 chars"],
  "headlines": ["3 options, max 40 chars"],
  "descriptions": ["2 options, max 30 chars"],`,
    interestsSpec: '5-8 interests to type into detailed targeting: similar artists first, then genre and platform interests',
    extrasSpec: '[]',
    placementsSpec: 'one line on which placements to use',
    extraSpec: '',
  },
  tiktok: {
    name: 'TikTok',
    rules: `TIKTOK ADS RULES you must follow:
- TikTok ads are vertical 9:16 videos that play in the For You feed. They must feel like a TikTok, not an ad: hook in the first 2 seconds, the song's best part, the artist's face if possible.
- Ad text (the caption under the video): max 100 characters, no emojis (TikTok rejects emojis in ad text), no hashtags in ad text, casual and in the artist's own voice.
- Spark Ads (boosting the artist's own TikTok post) usually beat regular ads for music because likes, comments and follows land on the artist's real account. Recommend Spark Ads first, with a regular ad as the fallback.
- Spark Ads: the artist posts the video on their TikTok, then on that post taps ... > Ad settings > turns on Ad authorization > Generate code (choose 30, 60 or 365 days), and pastes the code in TikTok Ads Manager under "Use TikTok account to deliver Spark Ads".
- Minimum budget: $20 a day per ad group (and $50 a day if a campaign-level budget is set, so leave the campaign budget off). Never plan less than $20 a day. If the artist's budget is under $20 a day, say so and suggest TikTok Promote (boost a post straight from the TikTok app) instead.
- CTA button must be one of: ${Object.keys(TIKTOK_CTAS).join(', ')}.
- Objectives in TikTok Ads Manager: Reach, Traffic, Video views, Community interaction (followers and profile visits), Lead generation, Website conversions. For streams and pre-saves use Traffic. For followers use Community interaction. For views use Video views.
- Targeting: TikTok interests (e.g. Music > Hip hop), behaviors (people who watched or liked videos about a music genre, or who followed creators in it), hashtag interactions. Broad targeting often works on TikTok; start with genre interests and behaviors.
- TikTok policy: no misleading claims, no fake buttons, no shock content, the music must be the artist's own.`,
    ctas: TIKTOK_CTAS,
    tiers: [60, 100, 140, 280],
    tierDays: { 60: 3, 100: 5, 140: 7, 280: 14 },
    minDaily: 20,
    manager: 'TikTok Ads Manager',
    limits: { primary: 100, headlines: 0, descriptions: 0, nPrimary: 3, nHeadlines: 0, nDescriptions: 0 },
    copySpec: `  "primary_text": ["3 ad text variations for the caption under the video, each max 100 chars, no emojis, no hashtags, hook first"],
  "headlines": [],
  "descriptions": [],
  "spark_caption": "the caption for the artist's own TikTok post that becomes the Spark Ad: max 150 chars including 3-5 hashtags, in their voice",`,
    interestsSpec: '5-8 TikTok interest categories and behaviors, e.g. Music > Hip hop, Video interactions: hip hop music, Creator interactions: followed rap creators',
    extrasSpec: '[{ "label": "HASHTAGS TO TARGET", "items": ["4-6 hashtags fans of this sound watch"] }]',
    placementsSpec: 'one line: TikTok placement only (turn off Pangle and the other apps for music)',
    extraSpec: `  "spark_steps": ["4-6 short steps to turn the artist's own TikTok post into a Spark Ad, from posting the video to pasting the code in Ads Manager"],
`,
  },
  google: {
    name: 'YouTube (Google Ads)',
    rules: `YOUTUBE ADS RULES you must follow (run through Google Ads):
- The video ad must be on the artist's YouTube channel first (unlisted is fine), then added in Google Ads by its YouTube link.
- Campaign type: a Video campaign. For views and subscribers use the Video views campaign (in-stream, in-feed and Shorts). For streams and pre-saves use a Demand Gen campaign sending people to the smart link or pre-save link.
- Formats: skippable in-stream (plays before other videos, skippable after 5 seconds, so the hook must land in the first 5 seconds), in-feed (a thumbnail in search and suggested videos with a headline), and Shorts (vertical 9:16).
- Headlines: max 40 characters. Long headlines: max 90 characters. Descriptions: max 90 characters. Business name: the artist name.
- CTA button must be one of: ${Object.keys(GOOGLE_CTAS).join(', ')}.
- Targeting that works for music: YouTube channels of similar artists as placements, custom segments of people who searched for similar artists or the genre, keywords, and topics (Arts & Entertainment > Music & Audio > the genre). Add locations and ages.
- Budget: YouTube views are cheap for music (often a few cents a view). $5-$10 a day works. For very small budgets, the Promote button in YouTube Studio is a simpler option.
- Google Ads asks new advertisers to verify their identity, which can take a few days; mention it in the setup steps.
- Policy: no misleading claims, no fake buttons, the artist must own the song.`,
    ctas: GOOGLE_CTAS,
    tiers: [25, 50, 100, 250],
    tierDays: { 25: 5, 50: 7, 100: 7, 250: 14 },
    manager: 'Google Ads',
    limits: { primary: 90, headlines: 40, descriptions: 90, nPrimary: 3, nHeadlines: 3, nDescriptions: 2 },
    copySpec: `  "primary_text": ["3 long headlines, max 90 chars each, hook first"],
  "headlines": ["3 headlines, max 40 chars each"],
  "descriptions": ["2 descriptions, max 90 chars each"],`,
    interestsSpec: '4-6 YouTube topics and audience segments, e.g. Arts & Entertainment > Music & Audio > Rap & Hip-Hop, Custom segment: people who searched for similar artists',
    extrasSpec: '[{ "label": "YOUTUBE CHANNELS TO TARGET", "items": ["4-6 YouTube channels of similar artists to add as placements"] }, { "label": "KEYWORDS", "items": ["6-10 search keywords fans of this sound use"] }]',
    placementsSpec: 'one line on which YouTube formats to run (in-stream, in-feed, Shorts) and to turn off the Display Network and video partners',
    extraSpec: '',
  },
};

const LANGS = {
  en: 'English',
  es: 'Spanish (natural, the way Latin artists talk to fans on Instagram; not formal or translated-sounding)',
  spanglish: 'Spanglish (mix Spanish and English naturally inside sentences, the way bilingual Latin fans actually talk)',
};

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
5. SIMILAR ARTISTS: 5-8 well-known artists their fans also listen to (big enough to target in ads), plus 2-3 peer-level artists at a similar size.

If you can't find the artist, say "ARTIST NOT FOUND ONLINE" and still give genre-appropriate similar artists for ${genre || 'their genre'}. Only report what you actually find; never invent numbers.`
        }]
      })
    });
    const d = await r.json();
    if (d.error) { console.error('ads research error', d.error); return null; }
    return d.choices && d.choices[0] && d.choices[0].message.content;
  } catch (e) { console.error('ads research failed', e); return null; }
}

const songKeyOf = (artist, title) => (String(artist) + '|' + String(title)).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9|]+/g, '');

// A kit for the same song this month, on a different platform, and none yet on this one? Then this one is free, and we reuse its research.
async function findOtherPlatformKit(userId, songKey, month, platform) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !userId || !songKey) return null;
  try {
    const q = `${url}/rest/v1/generations?user_id=eq.${encodeURIComponent(userId)}&tool=eq.ads` +
      `&inputs->>song_key=eq.${encodeURIComponent(songKey)}&inputs->>month=eq.${encodeURIComponent(month)}&select=inputs&limit=10`;
    const r = await fetch(q, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    if (!r.ok) return null;
    const rows = await r.json();
    const list = (Array.isArray(rows) ? rows : []).filter(x => x && x.inputs && x.inputs.platform);
    const other = list.find(x => x.inputs.platform !== platform);
    // free only for the FIRST kit on this platform; remaking the same platform's kit uses a credit
    if (!other || list.some(x => x.inputs.platform === platform)) return null;
    return other.inputs;
  } catch (e) { return null; }
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
  const month = new Date().toISOString().slice(0, 7);
  const songKey = songKeyOf(artist, title);
  let prior = null;
  const gate = await checkAndCount(req, 'ads', { freeIf: async (uid) => { prior = await findOtherPlatformKit(uid, songKey, month, platform); return !!prior; } });
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
    song_key: songKey,
    month,
  };
  const BUDGET_TIERS = P.tiers, TIER_DAYS = P.tierDays;

  if (inputs.budgetMode === 'set' && !inputs.budget) inputs.budgetMode = 'recommend';

  try {
    // same song on another platform this month: reuse that research (faster, and the targeting stays consistent)
    const research = (prior && prior.research) || await researchArtist(inputs.artist, inputs.handle, inputs.genre, inputs.city);
    const researchBlock = research
      ? `LIVE WEB RESEARCH ON THIS ARTIST (gathered just now; build targeting on this, and prefer it over guesses):\n${research}`
      : 'No web research available. Use the details given and genre-level targeting.';
    const budgetLine = inputs.budgetMode === 'recommend'
      ? `Budget: the artist wants you to RECOMMEND one. Pick exactly one of ${BUDGET_TIERS.map(x => '$' + x).join(', ')} based on their goal and audience size (new artists with small followings: one of the two smallest, test first; established local artists or a single with momentum: $${BUDGET_TIERS[2]}; a full release push with an existing fan base: $${BUDGET_TIERS[3]}). Days: ${BUDGET_TIERS.map(x => '$' + x + ' = ' + TIER_DAYS[x] + ' days').join(', ')}.`
      : `Budget: $${inputs.budget} over ${inputs.days} days (the artist set this; plan around it exactly).` +
        (P.minDaily && inputs.budget / inputs.days < P.minDaily ? ` That is under ${P.name}'s $${P.minDaily}/day minimum: say so in budget_plan.summary, plan ${Math.max(1, Math.floor(inputs.budget / P.minDaily))} day(s) at $${P.minDaily}/day instead, and mention TikTok Promote as the in-app option for tiny budgets.` : '');

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
- Goal: ${goalText(platform, inputs.goal)}
- ${budgetLine}
- Landing link: ${inputs.link || 'not provided'}
- AD COPY LANGUAGE: write on_image_text, primary_text, headlines and descriptions in ${LANGS[inputs.lang]}. Write everything else (angle, objective, audience, budget, setup_steps, what_to_watch, landing_tip) in English so the artist can follow the setup.${platform === 'tiktok' ? ' Write spark_caption in the ad copy language too.' : ''}

${researchBlock}

Return ONLY JSON in exactly this shape:
{
  "artist_profile": {
    "found": true,
    "from": "hometown or base city, country (or what the artist told you)",
    "fan_locations": ["2-5 cities or countries where their listeners are, from the research or best inference"],
    "genre": "genre / subgenre",
    "audience": "one line on audience size from the research, or 'Not enough public data found'",
    "similar_big": ["4-6 well-known similar artists big enough to target in ads"],
    "similar_peers": ["2-3 peer-level similar artists, or empty"]
  },
  "budget_recommendation": { "amount": 50, "days": 7, "why": "one sentence on why this budget fits this artist and goal" },
  "angle": "one sentence: the creative angle of this campaign and why it fits the song",
  "on_image_text": ["3 options, max 6 words each, for text on the ad image/video"],
${P.copySpec}
  "cta": "one of ${Object.keys(P.ctas).join(' | ')}",
  "objective": "the ${P.manager} objective (or campaign type) to pick and the optimization goal, one line",
  "audience": {
    "locations": ["2-5 specific cities/regions/countries to target, starting with the artist's city if given"],
    "age_min": 18,
    "age_max": 34,
    "interests": ["${P.interestsSpec}"],
    "extras": ${P.extrasSpec},
    "note": "one sentence on how to widen or narrow if results are weak"
  },
  "placements": "${P.placementsSpec}",
  "budget_plan": {
    "daily": "the daily budget in dollars, as a number",
    "summary": "2 sentences: how the money is split and the test-then-scale logic",
    "phases": [ { "days": "e.g. Days 1-3", "action": "what to run and spend", "spend": "$X" } ]
  },
  "setup_steps": ["7-10 short numbered steps to build this exact campaign in ${P.manager}, in order, written for someone who has never run an ad"],
${P.extraSpec}
  "what_to_watch": ["3 metrics to check after 48 hours with the number that means it's working for a music ad (e.g. link click CTR above 1%, cost per landing page view under $0.40${platform === 'google' ? ', or for YouTube cost per view under $0.05 and view rate above 25%' : platform === 'tiktok' ? ', or for TikTok 6-second view rate above 15% and CTR above 0.8%' : ''})"],
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

    // Enforce each platform's limits even if the model drifts
    const arr = (a, n, len) => (Array.isArray(a) ? a : []).map(x => clip(x, len)).filter(Boolean).slice(0, n);
    const L = P.limits;
    kit.on_image_text = arr(kit.on_image_text, 3, 48);
    if (platform === 'tiktok') kit.primary_text = (Array.isArray(kit.primary_text) ? kit.primary_text : []).map(t => String(t || '').replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '').replace(/#\S+/g, ''));
    kit.primary_text = arr(kit.primary_text, L.nPrimary, L.primary);
    kit.headlines = arr(kit.headlines, L.nHeadlines, L.headlines || 1);
    kit.descriptions = arr(kit.descriptions, L.nDescriptions, L.descriptions || 1);
    if (!P.ctas[kit.cta]) {
      const want = inputs.goal === 'presave' ? 'SIGN_UP' : inputs.goal === 'views' ? (P.ctas.WATCH_NOW ? 'WATCH_NOW' : 'WATCH_MORE') : (inputs.goal === 'followers' && P.ctas.SUBSCRIBE ? 'SUBSCRIBE' : 'LISTEN_NOW');
      kit.cta = P.ctas[want] ? want : Object.keys(P.ctas)[0];
    }
    kit.cta_label = P.ctas[kit.cta];
    kit.platform = platform;
    kit.free_extra = !!gate.free;
    if (platform === 'tiktok') {
      kit.spark_caption = clip(kit.spark_caption, 150);
      kit.spark_steps = arr(kit.spark_steps, 6, 220);
    } else { delete kit.spark_caption; delete kit.spark_steps; }
    const au = kit.audience || {};
    au.extras = (Array.isArray(au.extras) ? au.extras : []).map(x => ({ label: clip(x && x.label, 40).toUpperCase(), items: arr(x && x.items, 10, 60) })).filter(x => x.label && x.items.length).slice(0, 3);
    au.interests = arr(au.interests, 8, 90);
    kit.audience = au;
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
