export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Prompt is required' });

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${process.env.GOOGLE_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: prompt }]
          }],
          generationConfig: {
            responseModalities: ['IMAGE', 'TEXT'],
          }
        }),
      }
    );

    const data = await response.json();
    console.log('Gemini response status:', response.status);
    console.log('Gemini response:', JSON.stringify(data).slice(0, 300));

    if (data.candidates?.[0]?.content?.parts) {
      const imgPart = data.candidates[0].content.parts.find(p => p.inlineData);
      if (imgPart) {
        return res.status(200).json({
          data: [{ url: `data:image/png;base64,${imgPart.inlineData.data}` }]
        });
      }
    }

    throw new Error(data.error?.message || 'No image in response');

  } catch (error) {
    console.error('Gemini error:', error);
    return res.status(500).json({
      error: 'Gemini generation failed',
      details: error.message
    });
  }
}
