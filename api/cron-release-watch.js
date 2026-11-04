import { db, spotifyReady, latestReleases, takeSnapshot, saveSnapshot, sendEmail, releaseEmail, followupEmail } from './_watch.js';

// Daily Release Watch run (Vercel Cron, see vercel.json). For each watched artist, oldest-checked first:
//  1) new release on Spotify (out in the last 14 days, not seen before) -> "congrats, here's your first week" email
//  2) a release we announced 7+ days ago -> "how's it doing? get your Report Card" email
//  3) no snapshot in 7 days -> save this week's free snapshot
// Stops before Vercel's time limit; whoever wasn't reached goes first tomorrow.
// Env: CRON_SECRET (Vercel sends it automatically to cron runs), plus everything _watch.js uses.

const DAY = 86400000;

export default async function handler(req, res) {
  const auth = req.headers.authorization || '';
  if (!process.env.CRON_SECRET || auth !== 'Bearer ' + process.env.CRON_SECRET) return res.status(401).json({ error: 'Not allowed' });
  if (!spotifyReady()) return res.status(200).json({ ok: false, reason: 'Spotify keys missing' });

  const started = Date.now();
  const out = { checked: 0, new_releases: 0, alerts: 0, followups: 0, snapshots: 0, errors: 0 };
  const watches = await db('release_watch?select=user_id,spotify_artist_id,artist_name,email,alerts&order=last_checked_at.asc.nullsfirst&limit=400');

  for (const w of watches || []) {
    if (Date.now() - started > 45000) break;
    out.checked++;
    try {
      const uid = w.user_id;
      // 1) new releases
      const [rels, seen] = await Promise.all([
        latestReleases(w.spotify_artist_id),
        db(`release_seen?user_id=eq.${uid}&select=spotify_id,name,release_date,image,url,alerted_at,followup_at,baseline`),
      ]);
      const seenIds = new Set((seen || []).map(s => s.spotify_id));
      for (const r of rels) {
        if (seenIds.has(r.spotify_id)) continue;
        const d = String(r.release_date || ''), iso = d.length === 4 ? d + '-01-01' : d.length === 7 ? d + '-01' : d;   // Spotify sometimes gives only a year or month
        const age = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? (Date.now() - new Date(iso + 'T00:00:00Z').getTime()) / DAY : null;
        if (age != null && age < -1) continue;            // not out yet: we'll catch it on release day
        const fresh = age != null && age <= 14;
        const row = Object.assign({ user_id: uid, baseline: !fresh }, r);
        if (fresh) {
          out.new_releases++;
          if (w.alerts && w.email) {
            const m = releaseEmail(uid, w.artist_name, r);
            await sendEmail(w.email, m.subject, m.html);
            row.alerted_at = new Date().toISOString(); out.alerts++;
          }
        }
        await db('release_seen?on_conflict=user_id,spotify_id', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: row });
      }

      // 3) weekly snapshot (before follow-ups, so the email can show this week's numbers)
      const snaps = await db(`music_snapshots?user_id=eq.${uid}&select=taken_on,data&order=taken_on.desc&limit=2`) || [];
      let latest = snaps[0] || null, prev = snaps[1] || null;
      if (!latest || Date.now() - new Date(latest.taken_on + 'T12:00:00Z').getTime() >= 7 * DAY - 3600000) {
        const data = await takeSnapshot(w.spotify_artist_id, w.artist_name);
        await saveSnapshot(uid, w.spotify_artist_id, data);
        prev = latest; latest = { taken_on: new Date().toISOString().slice(0, 10), data };
        out.snapshots++;
      }

      // 2) one-week check-ins
      for (const s of seen || []) {
        if (!s.alerted_at || s.followup_at) continue;
        if (Date.now() - new Date(s.alerted_at).getTime() < 7 * DAY) continue;
        if (w.alerts && w.email) {
          const m = followupEmail(uid, w.artist_name, s, latest && latest.data, prev && prev.data);
          await sendEmail(w.email, m.subject, m.html);
          out.followups++;
        }
        await db(`release_seen?user_id=eq.${uid}&spotify_id=eq.${encodeURIComponent(s.spotify_id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: { followup_at: new Date().toISOString() } });
      }
      await db(`release_watch?user_id=eq.${uid}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: { last_checked_at: new Date().toISOString() } });
    } catch (e) {
      out.errors++;
      console.error('release watch', w.user_id, e.message);
      try { await db(`release_watch?user_id=eq.${w.user_id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: { last_checked_at: new Date().toISOString() } }); } catch (x) {}
    }
  }
  return res.status(200).json(Object.assign({ ok: true, watched: (watches || []).length }, out));
}
