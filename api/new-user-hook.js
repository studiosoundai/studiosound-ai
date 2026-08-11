// Fired by a Supabase Database Webhook whenever a new profile row is created.
// Sends: (1) a branded welcome email to the artist, (2) a signup alert to hello@.

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Only Supabase (holding our secret) may call this
  if (req.headers['x-webhook-secret'] !== process.env.WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const record = req.body && req.body.record;
  if (!record || !record.email) return res.status(200).json({ ok: true, skipped: 'no email' });

  const firstName = (record.full_name || '').split(' ')[0] || 'artist';

  const welcomeHtml = `
  <div style="background:#05050a;padding:40px 20px;font-family:Arial,sans-serif;">
    <div style="max-width:560px;margin:auto;background:#0b0b14;border:1px solid #1e1e2e;border-radius:16px;padding:36px;">
      <img src="https://raw.githubusercontent.com/studiosoundai/studiosound-ai/main/fox-side-logo.png.png" alt="StudioSound.ai" width="150" style="display:block;margin-bottom:24px;"/>
      <h1 style="color:#ffffff;font-size:22px;margin:0 0 8px;">Welcome to the studio, ${firstName} 🦊</h1>
      <p style="color:#a0a0b8;font-size:14px;line-height:1.7;margin:0 0 22px;">Your account is live. Here's what's waiting for you:</p>
      <p style="color:#e8e8f5;font-size:14px;line-height:2.0;margin:0 0 24px;">
        🎨 <strong>Cover Art Generator</strong> — two versions per prompt, DSP-ready 3000×3000<br/>
        🎬 <strong>Lyric Video Creator</strong> — drop your song, AI pulls your lyrics + timing<br/>
        ✍️ <strong>AI Lyric Writer</strong> — English, Spanish & Spanglish<br/>
        🚀 <strong>Release Planner</strong> — researches you across the web, builds your rollout<br/>
        🆓 <strong>Free tools</strong> — Cover Resizer, MP3→WAV, Trimmer, Split Sheets
      </p>
      <a href="https://studiosound.ai/app" style="display:inline-block;background:#00FFD1;color:#05050a;font-weight:800;font-size:14px;padding:14px 28px;border-radius:10px;text-decoration:none;">Open Your Studio →</a>
      <p style="color:#a0a0b8;font-size:13px;line-height:1.7;margin:26px 0 0;">Join the community — artists sharing covers, strategies, and wins:<br/>
      <a href="https://discord.gg/SN6uRybqK" style="color:#00FFD1;font-weight:700;text-decoration:none;">→ StudioSound Discord</a></p>
      <p style="color:#5a5a72;font-size:12px;margin:26px 0 0;">Create. Release. Elevate.<br/>— The StudioSound.ai Team</p>
    </div>
    <p style="color:#5a5a72;font-size:11px;text-align:center;margin-top:18px;">StudioSound.ai · You're receiving this because you created an account.</p>
  </div>`;

  const send = (payload) => fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + process.env.RESEND_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  try {
    // 1. Welcome email to the artist
    await send({
      from: 'StudioSound.ai <hello@studiosound.ai>',
      to: [record.email],
      subject: 'Welcome to the studio 🦊 — everything is ready',
      html: welcomeHtml
    });

    // 2. Signup alert to you
    await send({
      from: 'StudioSound.ai <hello@studiosound.ai>',
      to: ['hello@studiosound.ai'],
      subject: '🎉 New signup: ' + (record.full_name || record.email),
      html: `<p><strong>New StudioSound.ai user</strong></p>
             <p>Name: ${record.full_name || '—'}<br/>Email: ${record.email}<br/>Time: ${new Date().toUTCString()}</p>`
    });

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('new-user-hook:', e);
    // Never fail the webhook hard — signup itself already succeeded
    return res.status(200).json({ ok: false });
  }
}
