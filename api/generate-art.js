import { checkAndCount, logGeneration } from './_usage.js';

// Version A — Gemini 2.5 Flash Image (fast, high quality, supports photo input)
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ===== GATE: verify user + check/count monthly limit =====
  const gate = await checkAndCount(req, 'cover_art');
  if (!gate.ok) {
    return res.status(gate.status).json({ error: gate.error, plan: gate.plan || null });
  }
  // ==========================================================

  try {
    const { prompt, imageData } = req.body;
    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    const parts = [];
    if (imageData) {
      const mimeMatch = imageData.match(/^data:(image\/\w+);/);
      const mime = (mimeMatch && mimeMatch[1]) || 'image/png';
      const b64 = imageData.replace(/^data:image\/\w+;base64,/, '');
      parts.push({ inline_data: { mime_type: mime, data: b64 } });
      parts.push({ text: prompt + ' Incorporate the person from the provided photo as the central subject of the cover art, preserving their likeness naturally within the scene. Square 1:1 album cover composition.' });
    } else {
      parts.push({ text: prompt + ' Square 1:1 album cover composition.' });
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${process.env.GOOGLE_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: parts }],
          generationConfig: { responseModalities: ['IMAGE', 'TEXT'] }
        }),
      }
    );

    const data = await response.json();
    if (data.candidates?.[0]?.content?.parts) {
      const imgPart = data.candidates[0].content.parts.find(p => p.inlineData);
      if (imgPart) {
        logGeneration(gate.userId, 'cover_art',
          { prompt: prompt, hasPhoto: !!imageData, version: 'A' },
          { model: 'gemini-2.5-flash-image' }
        );
        return res.status(200).json({
          data: [{ url: `data:image/png;base64,${imgPart.inlineData.data}` }]
        });
      }
    }
    throw new Error(data.error?.message || 'No image returned');
  } catch (error) {
    console.error('Generate art error:', error);
    return res.status(500).json({
      error: 'Failed to generate image',
      details: error.message
    });
  }
}
