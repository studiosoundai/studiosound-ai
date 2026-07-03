import OpenAI, { toFile } from 'openai';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { prompt, imageData } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    let response;

    if (imageData) {
      // Image-to-image: artist uploaded a reference photo
      // Convert base64 to buffer
      const base64Data = imageData.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');
      const imageFile = await toFile(buffer, 'reference.png', { type: 'image/png' });

      response = await openai.images.edit({
        model: 'gpt-image-1',
        image: imageFile,
        prompt: prompt,
        n: 1,
        size: '1024x1024',
      });
    } else {
      // Text-to-image: no reference photo
      response = await openai.images.generate({
        model: 'gpt-image-1',
        prompt: prompt,
        n: 1,
        size: '1024x1024',
      });
    }

    const imageResult = response.data[0];

    if (imageResult.b64_json) {
      return res.status(200).json({
        data: [{ url: `data:image/png;base64,${imageResult.b64_json}` }]
      });
    } else if (imageResult.url) {
      return res.status(200).json({
        data: [{ url: imageResult.url }]
      });
    } else {
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
