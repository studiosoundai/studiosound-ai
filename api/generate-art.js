export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const prompt = req.body?.prompt;
  if (!prompt) {
    return res.status(400).json({ error: 'No prompt provided' });
  }
  try {
    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + process.env.OPENAI_API_KEY
      },
      body: JSON.stringify({ 
        model: 'gpt-image-1', 
        prompt: prompt,
        n: 1,
        size: '1024x1024'
      })
    });
    const data = await response.json();
    if (data.error) {
      return res.status(400).json({ error: data.error.message });
    }
    const b64 = data.data[0].b64_json;
    const imageUrl = `data:image/png;base64,${b64}`;
    return res.status(200).json({ data: [{ url: imageUrl }] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}