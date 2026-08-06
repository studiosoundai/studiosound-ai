import { checkAndCount, logGeneration } from './_usage.js';

// Drop your song → AI pulls the real lyrics WITH timing for auto-synced lyric videos.
// Audio arrives via a Supabase storage URL (uploaded client-side) to stay under
// serverless body limits; we fetch it here and send it to Whisper.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ===== GATE: verify user + check/count monthly limit =====
  const gate = await checkAndCount(req, 'transcribe');
  if (!gate.ok) {
    return res.status(gate.status).json({ error: gate.error, plan: gate.plan || null });
  }
  // ==========================================================

  const { audioUrl, language } = req.body;
  if (!audioUrl || !audioUrl.startsWith(process.env.SUPABASE_URL)) {
    return res.status(400).json({ error: 'Invalid audio reference' });
  }

  try {
    // Pull the uploaded song from storage
    const audioRes = await fetch(audioUrl);
    if (!audioRes.ok) throw new Error('Could not fetch the uploaded audio');
    const audioBlob = await audioRes.blob();

    // Send to Whisper with segment timestamps
    const form = new FormData();
    form.append('file', audioBlob, 'song.mp3');
    form.append('model', 'whisper-1');
    form.append('response_format', 'verbose_json');
    if (language === 'Spanish') form.append('language', 'es');

    const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form
    });

    const data = await whisperRes.json();
    if (data.error) {
      return res.status(400).json({ error: data.error.message });
    }

    // Map segments to lyric lines with start times
    const lines = (data.segments || [])
      .map(seg => ({ t: Math.max(0, seg.start - 0.15), text: (seg.text || '').trim() }))
      .filter(l => l.text.length > 1);

    if (!lines.length) {
      return res.status(400).json({ error: 'Could not detect vocals in this track — is it an instrumental?' });
    }

    logGeneration(gate.userId, 'transcribe',
      { language: language || 'auto', duration: data.duration || null },
      { lineCount: lines.length }
    );

    return res.status(200).json({ lines: lines, duration: data.duration || null });
  } catch (err) {
    console.error('Transcribe error:', err);
    res.status(500).json({ error: 'Transcription failed — try again or paste lyrics manually.' });
  }
}
