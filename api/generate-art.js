import { checkAndCount, logGeneration } from './_usage.js';

// Version A — tiered engine:
//   free           → gemini-3.1-flash-image (Nano Banana 2)
//   pro / premium  → gemini-3-pro-image (Nano Banana Pro — best-in-class text rendering)
//   safety net     → gemini-2.5-flash-image (known-good fallback)
// Supports photo input (put yourself on the cover) and inspiration input (style reference).

function b64Part(dataUrl) {
  const mimeMatch = dataUrl.match(/^data:(image\/\w+);/);
  const mime = (mimeMatch && mimeMatch[1]) || 'image/png';
  return { inline_data: { mime_type: mime, data: dataUrl.replace(/^data:image\/\w+;base64,/, '') } };
}

async function callModel(model, parts) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GOOGLE_API_KEY}`,
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
    if (imgPart) return imgPart.inlineData.data;
  }
  throw new Error(data.error?.message || 'No image returned');
}

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
    const { prompt, imageData, inspirationData } = req.body;
    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    const parts = [];
    let promptText = prompt;

    if (imageData) {
      parts.push(b64Part(imageData));
      promptText += ' Incorporate the person from the first provided photo as the central subject of the cover art, preserving their likeness naturally within the scene.';
    }
    if (inspirationData) {
      parts.push(b64Part(inspirationData));
      promptText += ' Take style, mood, color palette, typography feel, and compositional inspiration from the provided reference cover — but create a completely ORIGINAL artwork in that spirit. Do NOT copy, recreate, or closely imitate the reference image itself.';
    }
    promptText += ' Square 1:1 album cover composition.';
    parts.push({ text: promptText });

    // Tiered engine: paid plans get the flagship, free gets the fast lane
    const primary = (gate.plan === 'pro' || gate.plan === 'premium')
      ? 'gemini-3-pro-image'
      : 'gemini-3.1-flash-image';

    let b64 = null, used = primary;
    try {
      b64 = await callModel(primary, parts);
    } catch (e1) {
      console.error(primary + ' failed, falling back:', e1.message);
      used = 'gemini-2.5-flash-image';
      b64 = await callModel(used, parts);
    }

    logGeneration(gate.userId, 'cover_art',
      { prompt: prompt, hasPhoto: !!imageData, hasInspiration: !!inspirationData, version: 'A', plan: gate.plan },
      { model: used }
    );

    return res.status(200).json({
      data: [{ url: `data:image/png;base64,${b64}` }]
    });
  } catch (error) {
    console.error('Generate art error:', error);
    return res.status(500).json({
      error: 'Failed to generate image',
      details: error.message
    });
  }
}
