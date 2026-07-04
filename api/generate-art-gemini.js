export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Prompt is required' });

    // Try Imagen 3 first
    const imagen3Res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${process.env.GOOGLE_API_KEY}`,
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

    const imagen3Data = await imagen3Res.json();
    console.log('Imagen3 response:', JSON.stringify(imagen3Data).slice(0, 200));

    if (imagen3Data.predictions?.[0]?.bytesBase64Encoded) {
      return res.status(200).json({
        data: [{ url: `data:image/png;base64,${imagen3Data.predictions[0].bytesBase64Encoded}` }]
      });
    }

    // Try Imagen 3 Fast
    const imagen3FastRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-fast-generate-001:predict?key=${process.env.GOOGLE_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instances: [{ prompt }],
          parameters: {
            sampleCount: 1,
            aspectRatio: '1:1',
          }
        }),
      }
    );

    const imagen3FastData = await imagen3FastRes.json();
    console.log('Imagen3Fast response:', JSON.stringify(imagen3FastData).slice(0, 200));

    if (imagen3FastData.predictions?.[0]?.bytesBase64Encoded) {
      return res.status(200).json({
        data: [{ url: `data:image/png;base64,${imagen3FastData.predictions[0].bytesBase64Encoded}` }]
      });
    }

    // Try Gemini 2.0 Flash image generation
    const geminiFlashRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${process.env.GOOGLE_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `Generate an image: ${prompt}` }] }],
          generationConfig: { responseModalities: ['IMAGE'] }
        }),
      }
    );

    const geminiFlashData = await geminiFlashRes.json();
    console.log('GeminiFlash response:', JSON.stringify(geminiFlashData).slice(0, 200));

    if (geminiFlashData.candidates?.[0]?.content?.parts) {
      const imgPart = geminiFlashData.candidates[0].content.parts.find(p => p.inlineData);
      if (imgPart) {
        return res.status(200).json({
          data: [{ url: `data:image/png;base64,${imgPart.inlineData.data}` }]
        });
      }
    }

    // All failed — return error with details
    return res.status(500).json({
      error: 'All Gemini models failed',
      imagen3: imagen3Data.error?.message || 'no error message',
      imagen3fast: imagen3FastData.error?.message || 'no error message',
      geminiflash: geminiFlashData.error?.message || 'no error message',
    });

  } catch (error) {
    console.error('Gemini error:', error);
    return res.status(500).json({
      error: 'Gemini generation failed',
      details: error.message
    });
  }
}
