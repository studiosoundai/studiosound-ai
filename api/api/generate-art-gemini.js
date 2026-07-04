export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { prompt } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-001:predict?key=${process.env.GOOGLE_API_KEY}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          instances: [{ prompt: prompt }],
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

    if (data.predictions && data.predictions[0]) {
      const b64 = data.predictions[0].bytesBase64Encoded;
      return res.status(200).json({
        data: [{ url: `data:image/png;base64,${b64}` }]
      });
    } else {
      throw new Error(data.error?.message || 'No image returned from Gemini');
    }

  } catch (error) {
    console.error('Gemini generate error:', error);
    return res.status(500).json({
      error: 'Failed to generate image with Gemini',
      details: error.message
    });
  }
}
