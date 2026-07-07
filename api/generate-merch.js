import { checkAndCount } from './_usage.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ===== GATE: verify user + check/count monthly limit =====
  const gate = await checkAndCount(req, 'merch');
  if (!gate.ok) {
    return res.status(gate.status).json({ error: gate.error, plan: gate.plan || null });
  }
  // ==========================================================

  try {
    const { prompt, imageData, productType, color } = req.body;
    if (!imageData) {
      return res.status(400).json({ error: 'Image is required' });
    }
    const base64Data = imageData.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    const formData = new FormData();
    const blob = new Blob([buffer], { type: 'image/png' });
    formData.append('image', blob, 'design.png');
    formData.append('prompt', `Professional product mockup photography. Place this exact artwork design on the front of a ${color} ${productType}. Clean white background, studio lighting, high quality commercial photography, the design is centered and clearly visible on the product, realistic fabric texture, professional merch mockup.`);
    formData.append('model', 'gpt-image-1');
    formData.append('n', '1');
    formData.append('size', '1024x1024');
    const fetchResponse = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: formData,
    });
    const result = await fetchResponse.json();
    if (result.data && result.data[0]) {
      const img = result.data[0];
      return res.status(200).json({
        data: [{ url: img.b64_json ? `data:image/png;base64,${img.b64_json}` : img.url }]
      });
    } else {
      throw new Error(result.error?.message || 'No image returned');
    }
  } catch (error) {
    console.error('Generate merch error:', error);
    return res.status(500).json({
      error: 'Failed to generate mockup',
      details: error.message
    });
  }
}
