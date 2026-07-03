import OpenAI from 'openai';

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
      // Image-to-image mode
      try {
        const base64Data = imageData.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');
        
        // Create a Blob-like object from the buffer
        const { Blob } = await import('buffer');
        const blob = new Blob([buffer], { type: 'image/png' });
        
        // Create FormData
        const FormData = (await import('formdata-node')).FormData;
        const formData = new FormData();
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
          throw new Error(result.error?.message || 'No image returned from edit endpoint');
        }
      } catch (editError) {
        console.error('Image edit error, falling back to text generation:', editError);
        // Fall back to text-to-image if edit fails
        response = await openai.images.generate({
          model: 'gpt-image-1',
          prompt: prompt,
          n: 1,
          size: '1024x1024',
        });

        const imageResult = response.data[0];
        if (imageResult.b64_json) {
          return res.status(200).json({
            data: [{ url: `data:image/png;base64,${imageResult.b64_json}` }]
          });
        } else if (imageResult.url) {
          return res.status(200).json({
            data: [{ url: imageResult.url }]
          });
        }
      }
    } else {
      // Text-to-image mode
      response = await openai.images.generate({
        model: 'gpt-image-1',
        prompt: prompt,
        n: 1,
        size: '1024x1024',
      });

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
    }

  } catch (error) {
    console.error('Generate art error:', error);
    return res.status(500).json({ 
      error: 'Failed to generate image',
      details: error.message 
    });
  }
}
