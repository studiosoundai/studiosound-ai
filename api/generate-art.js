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
    const { prompt, imageData } = req.body;
    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }
    if (imageData) {
      try {
        const base64Data = imageData.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');
        const formData = new FormData();
        const blob = new Blob([buffer], { type: 'image/png' });
        formData.append('image', blob, 'reference.png');
        formData.append('prompt', prompt);
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
          const imageResult = result.data[0];
          if (imageResult.b64_json) {
            return res.status(200).json({
              data: [{ url: `data:image/png;base64,${imageResult.b64_json}` }]
            });
          } else if (imageResult.url) {
            return res.status(200).json({
              data: [{ url: imageResult.url }]
            });
          }
        } else {
          throw new Error(result.error?.message || 'Edit failed');
        }
      } catch (editError) {
        console.error('Image edit failed, falling back:', editError);
        const fallback = await fetch('https://api.openai.com/v1/images/generations', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          },
          body: JSON.stringify({
            model: 'gpt-image-1',
            prompt: prompt,
            n: 1,
            size: '1024x1024',
          }),
        });
        const fallbackData = await fallback.json();
        if (fallbackData.data && fallbackData.data[0]) {
          const img = fallbackData.data[0];
          return res.status(200).json({
            data: [{ url: img.b64_json ? `data:image/png;base64,${img.b64_json}` : img.url }]
          });
        }
        throw new Error('Both image generation methods failed');
      }
    } else {
      const response = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'gpt-image-1',
          prompt: prompt,
          n: 1,
          size: '1024x1024',
        }),
      });
      const data = await response.json();
      if (data.error) {
        return res.status(400).json({ error: data.error.message });
      }
      if (data.data && data.data[0]) {
        const img = data.data[0];
        return res.status(200).json({
          data: [{ url: img.b64_json ? `data:image/png;base64,${img.b64_json}` : img.url }]
        });
      }
      throw new Error('No image data returned');
    }
  } catch (error) {
    console.error('Generate art error:', error);
    return res.status(500).json({
      error: 'Failed to generate image',
      details: error.message
    });
  }
}
