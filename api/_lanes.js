// api/_lanes.js
// The lane map the A&R Check uses to place a song precisely (not just "hip-hop").
// EDIT FREELY: your engineers and A&R team should own this list. Each lane is:
//   name: what we call it    sound: what it sounds like (production, vocals, tempo, mood)
//   artists: well-known references for that exact lane (the AI may only name artists from the lane it picks,
//            or ones the artist gave us)
// Add lanes, fix artists, or rewrite the "sound" notes in your own words; the A&R Check picks it up on the next deploy.

export const LANES = [
  // ---------- hip-hop ----------
  { name: 'Rage', sound: 'distorted, blown-out synth leads, heavy distorted 808s, high energy, punk-like ad-libs and chant hooks, often 140-160 BPM', artists: ['Playboi Carti', 'Ken Carson', 'Destroy Lonely', 'Yeat'] },
  { name: 'Underground / druggy trap', sound: 'hazy, low-key and moody, sparse dark loops, mumbled or laid-back delivery, introspective and drugged-out themes, not built for radio', artists: ['Lucki', 'Chief Keef', 'Yung Lean'] },
  { name: 'Plugg / pluggnb', sound: 'airy, melodic synth plucks and bells, soft 808s, dreamy and romantic, melodic auto-tuned vocals', artists: ['Summrs', 'Autumn!', 'Kankan'] },
  { name: 'Alternative / experimental rap', sound: 'genre-bending, unusual song structures, psychedelic or noisy production, rap mixed with rock, electronic or indie', artists: ['Lil Yachty', 'JPEGMAFIA', 'Danny Brown', 'Tyler, the Creator'] },
  { name: 'Atlanta trap (mainstream)', sound: 'polished trap, rolling hi-hats, big clean 808s, melodic auto-tuned flows, luxury and street themes, radio-ready', artists: ['Future', 'Gunna', 'Lil Baby', 'Young Thug'] },
  { name: 'Melodic / emo rap', sound: 'sung-rapped hooks, guitar or piano loops, emotional and vulnerable themes', artists: ['Juice WRLD', 'Lil Peep', 'Trippie Redd', 'Rod Wave'] },
  { name: 'Chicago drill', sound: 'dark, sliding 808s, menacing piano or bell melodies, aggressive street delivery', artists: ['Chief Keef', 'King Von', 'Lil Durk'] },
  { name: 'NY / Brooklyn drill', sound: 'UK-style sliding 808 drill beats, gritty New York delivery, chant-like ad-libs', artists: ['Pop Smoke', 'Sheff G', 'Kay Flock'] },
  { name: 'UK drill', sound: 'skippy, sliding 808 drill patterns, British accents, fast flows', artists: ['Central Cee', 'Headie One', 'Digga D'] },
  { name: 'Detroit rap', sound: 'off-beat, choppy flows over sparse, bouncy beats, deadpan humor, punchlines', artists: ['Babyface Ray', 'Veeze', 'BabyTron', 'Sada Baby'] },
  { name: 'Memphis / Southern street rap', sound: 'hard-hitting Southern beats, dark Memphis-style samples and cowbells, aggressive punchy hooks', artists: ['Key Glock', 'Moneybagg Yo', 'GloRilla'] },
  { name: 'Houston / Texas', sound: 'slowed, syrupy or spacey melodic trap, Houston slang and car culture', artists: ['Travis Scott', 'Don Toliver', 'That Mexican OT', 'Sauce Walka'] },
  { name: 'Boom bap / lyrical', sound: 'sample-based drums and loops, dusty soul or jazz samples, bars-first delivery', artists: ['Joey Bada$$', 'Westside Gunn', 'Conway the Machine', 'Benny the Butcher'] },
  { name: 'West Coast', sound: 'bouncy West Coast grooves, synth bass, laid-back or gangsta delivery', artists: ['YG', 'Blxst', 'Larry June'] },
  { name: 'Cloud rap', sound: 'ethereal, washed-out synths, emotional and detached vocals, internet-native sound', artists: ['Bladee', 'Yung Lean'] },
  { name: 'Jersey club / club rap', sound: 'fast bouncy club kicks and bed-squeak samples, dance-driven, built for TikTok', artists: ['Bandmanrill', 'Cookiee Kawaii'] },
  { name: 'Pop rap', sound: 'big catchy hooks, polished mainstream production, crossover appeal', artists: ['Drake', 'Jack Harlow', 'Doja Cat'] },
  // ---------- R&B ----------
  { name: 'Alternative R&B', sound: 'moody, atmospheric production, intimate vocals, modern and experimental R&B', artists: ['Brent Faiyaz', 'PARTYNEXTDOOR', 'SZA', 'The Weeknd'] },
  { name: 'Trap soul / R&B with 808s', sound: 'R&B melodies over trap drums, sung hooks, late-night relationship themes', artists: ['Bryson Tiller', 'Summer Walker', '6LACK'] },
  { name: 'Neo-soul / classic R&B', sound: 'live instruments, warm chords, strong singing', artists: ['Daniel Caesar', 'H.E.R.', 'Lucky Daye'] },
  // ---------- Latin ----------
  { name: 'Reggaeton', sound: 'dembow rhythm, perreo energy, Spanish vocals, club and party focus', artists: ['Bad Bunny', 'Feid', 'Karol G', 'J Balvin'] },
  { name: 'Latin trap', sound: 'trap drums and 808s with Spanish rap or sung vocals, street themes', artists: ['Anuel AA', 'Eladio Carrión', 'Myke Towers'] },
  { name: 'Corridos tumbados / regional Mexican', sound: 'acoustic guitars, tololoche or brass, Mexican regional storytelling, often with trap influences', artists: ['Peso Pluma', 'Natanael Cano', 'Fuerza Regida'] },
  // ---------- other ----------
  { name: 'Afrobeats', sound: 'West African grooves, log drums or percussion, melodic and dance-friendly', artists: ['Burna Boy', 'Wizkid', 'Rema'] },
  { name: 'Amapiano', sound: 'South African log-drum bass, piano chords, slow-building house groove', artists: ['Tyla', 'Uncle Waffles', 'Kabza De Small'] },
  { name: 'Pop', sound: 'big polished hooks, verse-chorus structure, broad appeal', artists: ['Dua Lipa', 'Olivia Rodrigo', 'Sabrina Carpenter'] },
  { name: 'Pop-punk / emo / rock', sound: 'guitars, live drums, angsty or emotional vocals', artists: ['Machine Gun Kelly', 'Paramore', 'Linkin Park'] },
  { name: 'Country / country-rap', sound: 'twangy guitars, country storytelling, sometimes over hip-hop drums', artists: ['Morgan Wallen', 'Jelly Roll', 'Shaboozey'] },
  { name: 'Gospel / Christian hip-hop', sound: 'faith-based themes over gospel, R&B or hip-hop production', artists: ['Kirk Franklin', 'Lecrae', 'Maverick City Music'] },
  { name: 'Electronic / EDM', sound: 'synth-driven, drops and builds, club and festival energy', artists: ['Fred again..', 'Skrillex', 'Calvin Harris'] },
];

export function lanesText() {
  return LANES.map(l => `- ${l.name}: ${l.sound}. Artists: ${l.artists.join(', ')}`).join('\n');
}
