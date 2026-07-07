import { checkAndCount } from './_usage.js';

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
    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Prompt is required' });
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict?key=${process.env.GOOGLE_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instances: [{ prompt }],
          parameters: {
            sampleCount: 1,
            aspectRatio: '1:1',
            safetyFilterLevel: 'block_few',
            personGeneration: 'allow_all',
          }
        }),
      }
    );
    const data = await response.json();
    console.log('Imagen4 response:', JSON.stringify(data).slice(0, 300));
    if (data.predictions?.[0]?.bytesBase64Encoded) {
      return res.status(200).json({
        data: [{ url: `data:image/png;base64,${data.predictions[0].bytesBase64Encoded}` }]
      });
    }
    // Fallback to gemini-2.5-flash-image if Imagen 4 fails
    const fallback = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${process.env.GOOGLE_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseModalities: ['IMAGE', 'TEXT'] }
        }),
      }
    );
    const fallbackData = await fallback.json();
    if (fallbackData.candidates?.[0]?.content?.parts) {
      const imgPart = fallbackData.candidates[0].content.parts.find(p => p.inlineData);
      if (imgPart) {
        return res.status(200).json({
          data: [{ url: `data:image/png;base64,${imgPart.inlineData.data}` }]
        });
      }
    }
    throw new Error(data.error?.message || 'No image returned');
  } catch (error) {
    console.error('Gemini error:', error);
    return res.status(500).json({
      error: 'Gemini generation failed',
      details: error.message
    });
  }
}
