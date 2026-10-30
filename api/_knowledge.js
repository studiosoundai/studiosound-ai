// api/_knowledge.js
// What the Studio Assistant knows. Files starting with "_" are private helpers,
// not public routes. UPDATE THIS FILE IN THE SAME UPLOAD WHENEVER A FEATURE SHIPS
// OR A PRICE/LIMIT CHANGES, so the assistant always matches the site.
// Never put costs, margins, API details, other artists' data or unannounced plans here.

export const KNOWLEDGE = {
  platform: `STUDIOSOUND.AI
StudioSound.ai is an all-in-one studio for independent artists: forecast earnings, plan the release, make the cover, cut the lyric video, make merch mockups and ads, and master the song (Mastering, rolling out).
Tool names never include "AI": say Mastering, Lyric Writer, Cover Art, Lyric Videos and so on. Brand line: "Create. Release. Drop like a major." Built by the team behind Stop One Distribution.
Everything an artist makes saves to My Assets (left sidebar) to reopen, replay or re-download.
Artists own everything they make: covers, plans, lyrics, videos and ads are theirs to release, print and promote.`,

  pricing: `PLANS AND LIMITS (limits reset on the 1st of every month; unused ones don't roll over)
- Free, $0, no card: Earnings Forecast preview, 3 cover generations (2 versions each), 1 release plan a month, 3 Lyric Writer sessions, 2 lyric videos with auto-synced lyrics (unlimited if they tap-sync themselves), 2 merch mockups, 2 Meta ad kits, all free tools.
- Pro, $9.99/month, or $6.99/month billed yearly ($83.88/year): 3 full forecasts a month (five-year paths, analyst read, PDF and image export), 100 cover generations on the highest-quality cover engine, unlimited release plans, 200 Lyric Writer sessions, 30 lyric videos with auto-synced lyrics, 50 merch mockups, 30 Meta ad kits.
- Premium, $24.99/month, or $16.99/month billed yearly ($203.88/year): 10 full forecasts a month, 300 cover generations, unlimited release plans, 500 Lyric Writer sessions, 100 lyric videos with auto-synced lyrics, 100 merch mockups, 100 Meta ad kits, priority support.
- Upgrade at studiosound.ai/pricing. Cancel, switch plans or change monthly/yearly from Settings (billing portal); access stays until the end of the paid period.
- Mastering (rolling out, see its section): full 24-bit WAV masters: Free 1 a month, Pro 5 a month, Premium unlimited (fair use). Whole-song previews: Free 10, Pro 100 a month, Premium unlimited.
- Launch promotion until Dec 31, 2026: Pro is $9.99/month (regular $14.99) and Premium $24.99/month (regular $29.99). Say the launch price ends Dec 31; don't promise what happens to existing subscribers after that.
- Watermark: on the Free plan, lyric videos, merch mockup downloads and ad images/videos carry a small "Made with StudioSound.ai" tag in the corner. Pro and Premium exports have no watermark. Cover art never has one.
- Hit a limit: that tool pauses until the 1st, or upgrade to keep going. Other tools keep working.`,

  forecast: `EARNINGS FORECAST
- Upload the royalty report you download from your distributor (DistroKid, TuneCore, Stop One, CD Baby, or any CSV/TSV/Excel with dates and amounts), or type monthly totals by hand, oldest month first.
- Best practice: upload the exact file the distributor gave you. Converted CSVs often round the cents away.
- Several reports stack automatically (e.g. one per month). Each report shows as a chip with an ✕ to remove it. "Start fresh" clears everything.
- Months before the catalog went live are trimmed, and a latest month that looks incomplete (statements lag) is set aside; type it back in if it's real.
- Needs at least 2 months to read a trend.
- Non-USD statements (AUD, EUR, GBP, CAD, NZD) are detected; forecast in USD at today's rate or keep your own currency with the toggle.
- Three paths over 1, 3 and 5 years: coasting (if nothing changes), working the plan (steady releases; the "releases planned this year" field bends this curve), and the plan plus one viral moment.
- Free preview (also public at studiosound.ai/forecast, no account): recent monthly average, trend, months read, next 12 months if nothing changes. Pro/Premium add the five-year paths, the gap, an analyst read with next moves, milestones, watch-outs, PDF and image export.
- The report is read in the browser and never uploaded; only monthly totals, genre and city are sent for the full report.
- It's scenarios from the artist's own history, not a guarantee and not financial advice.`,

  cover: `COVER ART GENERATOR
- Two versions every generation: Version A hyper-photorealistic, Version B stylized/artistic. Pick the one that sounds like the record.
- Options: song title on the artwork (toggle), artist name on the cover, color palette, Parental Advisory sticker, up to 3 photos of people (the AI puts you on the cover), up to 3 reference covers for inspiration (it makes an original in that spirit, not a copy; artists are responsible for rights to what they upload).
- Downloads are exactly 3000×3000 JPEG, the Spotify/Apple/distributor spec. No watermark.
- Pro and Premium use the highest-quality engine (best at rendering text).`,

  plan: `RELEASE PLANNER
- Enter project name, artist name exactly as on Spotify, social handle (so it researches the right artist), release date, genre, career stage, city, budget and details.
- It researches the artist and their lane on the live web, then builds a personalized 30-day rollout: strategy summary, artist snapshot, budget breakdown, tactics working right now in their genre, and a dated timeline from 4 weeks out to 1 week after.
- Export as PDF. Plans save to My Assets and reopen there.`,

  lyrics: `LYRIC WRITER
- Writes from a description in English, Spanish or Spanglish: full song, verse + hook, or hook only; explicit or clean.
- One click sends the lyrics into the Lyric Video Creator.`,

  lyricvideo: `LYRIC VIDEO CREATOR (BETA)
- Drop the song and lyrics. Auto-Lyrics pulls the lyrics timed to the vocal (counts as 1 of the plan's auto-synced lyric videos), or tap along to sync by hand.
- Vertical 9:16 for TikTok, Reels and Shorts. Font styles, colors, background motion with a speed control, cover as background. Full song or 15s/30s hook clips.
- Rendering happens in real time on the device, so a 3-minute song takes about 3 minutes; keep the screen open.
- Saves as MP4 in Chrome, Safari and Edge (Firefox can only record WebM). On phones, "Save to Photos / Share" then "Save Video" puts it in the camera roll. "Download again" is there after export.
- A cloud copy saves to My Assets when the file is under about 45 MB (15s and 30s clips always fit); otherwise the file on the device is the copy.`,

  merch: `MERCH MOCKUPS
- Upload art and see it on real AI-generated product mockups: tees, hoodies, hats, phone cases, posters, tote bags, sweatpants, jackets (8 products, 8 colors).
- Shows a cost breakdown: print-on-demand vs bulk, plus a suggested retail range.`,

  ads: `AD GENERATOR (META: INSTAGRAM AND FACEBOOK)
- Builds a ready-to-run Meta ad kit. The artist runs it in their own Meta Ads Manager with their own card; StudioSound never touches their ad account.
- Steps: about you (artist name, Instagram/TikTok handle, genre, where you're from, similar artists optional), the song (title, out now or coming soon, release date, copy language, hook line, what it's about), goal (Streams, Pre-saves, Followers, Video views), budget, link, cover, song, and a video or photo of the artist (recommended).
- It researches the artist online with the handle to find where they're from, where fans are and which bigger artists their fans also listen to; that becomes the targeting. If nothing is found, it targets by genre and says so.
- Budget options: "Recommend one for me", $25 test (5 days), $50 starter (7 days), $100 push (7 days), $250 release campaign (14 days), or custom. Ballpark US reach: $25 ≈ 1,400–3,300 people, $50 ≈ 2,800–6,700, $100 ≈ 5,600–13,000, $250 ≈ 14,000–33,000. These are estimates, not promises; Latin America is usually cheaper, big US cities pricier.
- The kit: what we found about you, ad images for Feed 4:5, Reels/Stories 9:16 and Square 1:1, a 15-second Reels video (needs the song uploaded; with artist footage the artist fills the frame), 3 primary texts, 3 headlines, 2 descriptions, objective, button, locations, age, interests, placements, budget plan by phase, step-by-step Ads Manager setup, what to check after 48 hours, and where to send people.
- Copy language: English, Spanish or Spanglish. Font, text color and accent color are changeable; "Match my cover" picks the accent from the cover.
- Test-then-scale: run all 3 ads for about 3 days, then put the rest of the budget behind the winner. Don't change anything for the first 48 hours.
- Send ads to a release page or smart link with a Meta pixel rather than straight to Spotify, so clicks can be tracked and retargeted.
- TikTok ad kits are next, then Google/YouTube. An ad manager that launches ads for you is in development.`,

  freetools: `FREE TOOLS (work without an account at studiosound.ai/tools, and inside the Studio)
- Cover Resizer (studiosound.ai/cover-resizer): any image to a 3000×3000 JPEG (or 1080×1080 for Instagram); non-square images are center-cropped; warns if the image is too small.
- MP3 to WAV (studiosound.ai/mp3-to-wav): 16-bit / 44.1 kHz WAV for distributors. It can't restore quality an MP3 already lost; export WAV from the session when possible.
- Audio Trimmer (studiosound.ai/audio-trimmer): cut a clip with a waveform, 15s/30s buttons, download WAV. TikTok sounds work best at 15–30s starting on the hook.
- Split Sheet (studiosound.ai/split-sheet): names, roles, PRO, shares that total 100%, printable for everyone to sign. A record of an agreement, not legal advice.
- Metadata Formatter (studiosound.ai/metadata-formatter): flags common rejections ("feat." in the title, all-caps, missing legal songwriter names, bad ISRC, missing ℗/© line, release date under 4 weeks away) and formats copy-paste metadata.
- Release Checklist (studiosound.ai/release-checklist): 4 weeks out to the week after, with real dates when a release date is added; ticks save on the device; printable.
- All of them run in the browser; files are never uploaded.`,

  distribution: `STOP ONE DISTRIBUTION
- StudioSound is built by the team behind Stop One Distribution, an independent distributor based in Atlanta.
- THE PLAN: free to join, no upfront or yearly fee. The artist keeps 85% of their earnings and Stop One keeps 15%. Every service below comes with that one plan.
- Distribution to Spotify, Apple Music, Amazon, Tidal, Deezer, TikTok, Instagram and 150+ platforms. Artists keep their rights: masters stay with the artist.
- Release timing: releases can go live in as little as 24-48 hours, but Stop One recommends submitting 7-14 days ahead so stores fully ingest the release (for example so it can hit Spotify Release Radar) and there's proper time for playlist pitching.
- Artist portal: real-time analytics and stats from every platform including socials, earnings, playlist pitching and free tools in one dashboard.
- Artist page: every artist gets an artist page they control (artist page consultation and building included), and they can swap their featured releases whenever they want.
- YouTube Content ID: music is registered so YouTube uploads that use it are identified and monetized for the artist.
- Royalty splitting: earnings can be split automatically with producers, writers and collaborators.
- Monthly payments.
- Playlist pitching: editorial and independent playlists.
- Royalty advances: artists who meet certain criteria can get advances against future earnings. Amounts are based on monthly earnings and projected future revenue; for high earners they can reach the millions. To see if they qualify, artists fill out the advance form: https://docs.google.com/forms/d/e/1FAIpQLScE-rz_4SOlTBc6BMclEDg-BNeBNoc45Ro9Adz_5LdlCktTHA/viewform (it's also linked from the Earnings Forecast results). The Earnings Forecast is a good first look at the numbers an advance is based on. Never estimate or promise an advance amount for a specific artist.
- Studio: access to Stop One's platinum, million-dollar studio in Atlanta, with discounted sessions for Stop One artists.
- What makes Stop One different from DistroKid and other upload-only distributors: there's always a real person to reach out to who helps scale the artist's career, a real music staff at their fingertips, a better analytics dashboard, playlist pitching, an artist page, advances and studio access, all in the free plan.
- Be honest about the 85/15 split if an artist compares with distributors that charge a yearly fee and pay 100%: explain that Stop One is free to join and the 15% covers the team, pitching, analytics, artist page and the rest, so the artist can decide what's worth more to them.
- Apply at studiosound.ai/distribution.
- The assistant doesn't have payout dates, advance criteria details, or anything about an existing Stop One account: for those, point them to the distribution page or support. Never quote advance amounts.`,

  mastering: `MASTERING
- Rolling out to accounts in stages. If the artist doesn't see "Mastering" in the sidebar yet, it's coming soon; don't promise a date.
- Upload the final mix (WAV, AIFF or FLAC is best; MP3 works; up to 12 minutes, 200 MB). Leave headroom: the mix should peak around -3 to -6 dB with no limiter on the master bus.
- Pick a sound: Balanced (works for almost anything), Warm (fuller lows, softer highs; R&B, soul, ballads), Punchy (tight kick and bass, more bite; hip-hop, trap, drill), Open (brighter and wider; pop, Latin, afrobeats), Vocal Forward (lyric-led songs).
- "Sound like a song" (the switch right under the upload): upload a released song they love and the master matches its loudness, tone and width. Loudness and strength are taken from that song, so those options hide.
- Pick loudness: Streaming -14 LUFS (most dynamic), Standard -10 LUFS (today's norm, safe pick), Loud -8 LUFS (competitive). Spotify and Apple turn songs to a similar volume, so louder isn't automatically better. Every master peaks under -1 dBTP so stores don't distort it.
- Strength: Light, Gentle, Normal, Strong or Max. Light stays close to the mix; Max adds the most punch, tone and density. Loudness is chosen separately.
- Mastering takes about 30–90 seconds. The artist hears the whole song before and after, starting at the loudest part, and can click the bar to jump anywhere; "Match volume" levels the two so the comparison is fair. Keys: A original, B mastered, Space play/pause.
- If the uploaded file is already loud (above about -12 LUFS) it's probably mastered already or has a limiter on the master bus, so the change will be small. Tell them to bounce the mix again with the master-bus limiter off.
- Previews are free. Downloading a master uses 1 from the monthly allowance (Free 1, Pro 5, Premium unlimited). That one master comes in three formats: WAV 24-bit (for distribution), WAV 16-bit/44.1 (for distributors or CD plants that ask for it) and MP3 320 (for sharing, SoundCloud, DJs). After the first download every format is free, any time: downloaded masters are saved for good in My Assets. Masters that are only previewed, never downloaded, are deleted after 30 days. The artist's original mix and reference song are deleted after 30 days either way.
- Not happy with it: try another sound or loudness; it doesn't re-upload. For a big release that needs a human engineer, Stop One artists get discounted sessions at a platinum studio.
- Mastering finishes a good mix; it can't fix a bad one. If the vocal is buried or the low end is muddy, fix the mix first.`,

  archeck: `A&R CHECK (inside the Studio Assistant)
- The artist taps "Get feedback on my song" (or the music note button) in the assistant and drops a song (WAV, MP3, AIFF, FLAC, M4A; up to 12 minutes). Optional: song title, genre, city.
- If the artist names who they sound like, we pull real listening data on those artists (related artists, the playlists they're on and the genre tags listeners give them, from Deezer and Last.fm) so the lane, comparable artists and playlists match their actual scene. Naming 2-3 artists makes the feedback much more accurate.
- What happens: we measure the actual audio (loudness, peaks, tone balance, stereo, tempo, key, where the chorus hits, how long the intro takes), transcribe the lyrics, an AI listens to the chorus, and we research who listens to that lane and where. Takes about a minute.
- The review: an overall take, release readiness (ready / almost / needs work), what's working, what to fix first and how, the best 15-second clip for TikTok and Reels, lyric themes and standout lines, who the audience is, cities, platforms and playlists, and 5 promotion steps. Then the artist can keep asking questions about the song.
- It's honest and encouraging. It never gives a score or predicts streams or hits; nobody can.
- Limits: Free 1 a month, Pro 10, Premium 30.
- Privacy: the song is deleted right after it's analyzed; the small clips used for the review are deleted when the review is written.`,

  support: `SUPPORT AND COMMUNITY
- Bugs, billing, account or login problems: email support@studiosound.ai.
- Community: Discord at discord.gg/SN6uRybqK.
- In development (not part of any plan yet, no dates promised): song generator, AI video clips, TikTok and Google ad kits, an ad manager that launches ads for you.`,

  playbook: `INDEPENDENT RELEASE PLAYBOOK (give this kind of advice, adapted to the artist)
- Upload to the distributor at least 4 weeks before release; pitch in Spotify for Artists as soon as the song appears (at least 7 days ahead, earlier is better).
- Before uploading: WAV master, 3000×3000 cover, clean metadata with legal songwriter names, signed split sheet if anyone else worked on the song.
- Content: batch-film 10–15 short clips in one session; post 1–2 a day hook-first; the first second decides the scroll. Sped-up/slowed versions and fan pages help on TikTok.
- Pre-save link 3 weeks out; announce the date everywhere and update bios/link-in-bio.
- Release week: confirm it's live everywhere, post everywhere, message day-ones personally, repost every share.
- Weeks 2–4 after release are when most indie songs grow; don't go quiet. Check Spotify for Artists data and double down on what's working.
- Release cadence matters: catalog decays without new music; steady releases (e.g. every 6–8 weeks) bend the earnings curve.
- Ads: start with a small test, keep the winner, cut the rest; ads that show the artist usually beat cover-only ads.
- Splits: agree the day the song is made, use legal names, everyone signs and keeps a copy.`,
};

export const TOOL_NAMES = {
  forecast: 'Earnings Forecast', art: 'Cover Art Generator', plan: 'Release Planner', merch: 'Merch Mockups',
  writer: 'Lyric Writer', lyric: 'Lyric Video Creator', ads: 'Ad Generator', master: 'Mastering', resize: 'Cover Resizer',
  audio: 'MP3 to WAV', trim: 'Audio Trimmer', split: 'Split Sheet', meta: 'Metadata Formatter',
  check: 'Release Checklist', assets: 'My Assets', settings: 'Settings',
};

const TOOL_SECTION = {
  forecast: 'forecast', art: 'cover', plan: 'plan', merch: 'merch', writer: 'lyrics', lyric: 'lyricvideo',
  ads: 'ads', master: 'mastering', resize: 'freetools', audio: 'freetools', trim: 'freetools', split: 'freetools', meta: 'freetools', check: 'freetools',
};

// Everything is small enough to send in full today; the open tool's section goes first.
// When this file grows, switch this to keyword retrieval so only matching sections are sent.
export function buildKnowledge(tool) {
  const first = TOOL_SECTION[tool];
  const keys = Object.keys(KNOWLEDGE);
  const ordered = first ? [first, ...keys.filter(k => k !== first)] : keys;
  return ordered.map(k => KNOWLEDGE[k]).join('\n\n');
}
